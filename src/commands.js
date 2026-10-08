import { todayInTz, nowTimeInTz, addDays, mealTypeFromTime } from './dates.js';
import {
  addEntries, deleteEntry, undoLast, editEntry, getEntriesForDate, hasAnyEntries,
  getTargets, setTargets, dayReport, weekReport,
} from './food/store.js';
import { formatLogReply, formatDayReport, formatWeekReport, formatTargets } from './food/format.js';
import { entriesToCsv } from './food/csv.js';
import {
  addClient, removeClient, pauseClient, resumeClient, deleteClientData,
  resolveClientRef, normalizeNumber, listClients, buildInviteText, getClient,
} from './clients.js';

const MAX_TEXT_LEN = 4000;

const HELP = `log food by sending text ("200g chicken breast, 150g rice") or a meal/label photo.

commands:
  today / yesterday / week
  targets show
  targets set <kcal> <protein_g> <carbs_g> <fat_g>
  undo
  delete <id>
  edit <id> <field>=<value> [field=value ...]   (fields: name, grams, kcal, protein_g, carbs_g, fat_g)
  export
  help`;

const ADMIN_HELP = `coach commands (admin number only):
  add client <number> [name] [--welcome]
  clients
  client <name> targets <kcal> <protein_g> <carbs_g> <fat_g>
  pause client <name|number>
  resume client <name|number>
  remove client <name|number>
  delete client data <name|number> [confirm]
  coach summary`;

const COACH_ONLY_REPLY = 'that command is for the coach account only.';

const EDITABLE_FIELDS = new Set(['name', 'grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g']);

function parseEditFields(rest) {
  const fields = {};
  const invalid = [];
  for (const pair of rest.trim().split(/\s+/)) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const key = pair.slice(0, eq);
    const raw = pair.slice(eq + 1);
    if (!EDITABLE_FIELDS.has(key)) { invalid.push(key); continue; }
    if (key === 'name') {
      fields[key] = raw;
      continue;
    }
    const num = Number(raw);
    if (!Number.isFinite(num)) { invalid.push(key); continue; }
    fields[key] = num;
  }
  return { fields, invalid };
}

// ctx: { db, extractFood, tz, clientId, isAdmin, allowedNumbers, defaultTargets, text, image }
// image: { tempPath, photoPath } | null — tempPath is read by the AI, photoPath is the persisted
// relative path (under DATA_DIR) stored on the entry rows for the dashboard.
export async function handleMessage(ctx) {
  const { db, tz, clientId, defaultTargets } = ctx;
  const text = (ctx.text || '').trim();
  const today = todayInTz(tz);

  if (/^help$/i.test(text)) return { reply: ctx.isAdmin ? `${HELP}\n\n${ADMIN_HELP}` : HELP };

  if (/^today$/i.test(text)) return { reply: formatDayReport(dayReport(db, clientId, today, defaultTargets)) };

  if (/^yesterday$/i.test(text)) {
    const y = addDays(today, -1);
    return { reply: formatDayReport(dayReport(db, clientId, y, defaultTargets)) };
  }

  if (/^week$/i.test(text)) return { reply: formatWeekReport(weekReport(db, clientId, today, defaultTargets)) };

  if (/^targets?$/i.test(text) || /^targets?\s+show$/i.test(text)) {
    return { reply: formatTargets(getTargets(db, clientId, defaultTargets)) };
  }

  const targetsSet = text.match(/^targets?\s+set\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/i);
  if (targetsSet) {
    const [, kcal, protein_g, carbs_g, fat_g] = targetsSet;
    const t = setTargets(db, clientId, {
      kcal: Number(kcal), protein_g: Number(protein_g), carbs_g: Number(carbs_g), fat_g: Number(fat_g),
    }, defaultTargets);
    return { reply: `updated ${formatTargets(t)}` };
  }
  if (/^targets?\s+set\b/i.test(text)) {
    return { reply: 'usage: targets set <kcal> <protein_g> <carbs_g> <fat_g>, e.g. "targets set 2200 160 220 70"' };
  }

  if (/^undo$/i.test(text)) {
    const gone = undoLast(db, clientId, today);
    if (!gone) return { reply: 'nothing to undo today.' };
    return { reply: `removed: ${gone.name}\n${formatDayLineSafe(db, clientId, today, defaultTargets)}` };
  }

  const del = text.match(/^(?:delete|del)\s+(\d+)$/i);
  if (del) {
    const id = Number(del[1]);
    const gone = deleteEntry(db, clientId, today, id);
    if (!gone) return { reply: `no entry #${id} today.` };
    return { reply: `removed: ${gone.name}\n${formatDayLineSafe(db, clientId, today, defaultTargets)}` };
  }

  const edit = text.match(/^edit\s+(\d+)\s+(.+)$/i);
  if (edit) {
    const id = Number(edit[1]);
    const { fields, invalid } = parseEditFields(edit[2]);
    if (invalid.length) return { reply: `couldn't understand field(s): ${invalid.join(', ')}. valid fields: name, grams, kcal, protein_g, carbs_g, fat_g` };
    if (Object.keys(fields).length === 0) return { reply: 'usage: edit <id> field=value [field=value ...]' };
    const row = editEntry(db, clientId, id, fields);
    if (!row) return { reply: `no entry #${id}.` };
    return { reply: `updated #${id}: ${row.name} · ${row.kcal} kcal · P${row.protein_g} C${row.carbs_g} F${row.fat_g}` };
  }

  if (/^export$/i.test(text)) {
    const allEntries = exportAllEntries(db, clientId);
    return { reply: `exporting ${allEntries.length} entries.`, file: { name: `${clientId}-food-log.csv`, content: entriesToCsv(allEntries) } };
  }

  if (/^coach(\s+summary)?$/i.test(text)) {
    if (!ctx.isAdmin) return { reply: COACH_ONLY_REPLY };
    return { reply: coachSummary(ctx) };
  }

  const addClientMatch = text.match(/^add\s+client\s+(.+)$/i);
  if (addClientMatch) {
    if (!ctx.isAdmin) return { reply: COACH_ONLY_REPLY };
    return handleAddClient(ctx, addClientMatch[1]);
  }

  if (/^clients$/i.test(text)) {
    if (!ctx.isAdmin) return { reply: COACH_ONLY_REPLY };
    return { reply: clientsList(ctx) };
  }

  const clientTargetsMatch = text.match(/^client\s+(.+?)\s+targets\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/i);
  if (clientTargetsMatch) {
    if (!ctx.isAdmin) return { reply: COACH_ONLY_REPLY };
    return handleClientTargets(ctx, clientTargetsMatch);
  }

  const pauseMatch = text.match(/^pause\s+client\s+(.+)$/i);
  if (pauseMatch) {
    if (!ctx.isAdmin) return { reply: COACH_ONLY_REPLY };
    return handleClientStatusChange(ctx.db, pauseClient, pauseMatch[1], 'paused');
  }

  const resumeMatch = text.match(/^resume\s+client\s+(.+)$/i);
  if (resumeMatch) {
    if (!ctx.isAdmin) return { reply: COACH_ONLY_REPLY };
    return handleClientStatusChange(ctx.db, resumeClient, resumeMatch[1], 'active');
  }

  const removeMatch = text.match(/^remove\s+client\s+(.+)$/i);
  if (removeMatch) {
    if (!ctx.isAdmin) return { reply: COACH_ONLY_REPLY };
    return handleClientStatusChange(ctx.db, removeClient, removeMatch[1], 'removed');
  }

  const deleteDataMatch = text.match(/^delete\s+client\s+data\s+(.+)$/i);
  if (deleteDataMatch) {
    if (!ctx.isAdmin) return { reply: COACH_ONLY_REPLY };
    return handleDeleteClientData(ctx.db, deleteDataMatch[1]);
  }

  if (text.length > MAX_TEXT_LEN) {
    return { reply: `that message is pretty long (${text.length} characters) — try describing your meal in a shorter message, or send a photo instead.` };
  }

  // Anything else is a candidate food log: text description, a photo, or both.
  if (!ctx.extractFood) return { reply: "couldn't understand that. send 'help' for commands." };

  const result = await ctx.extractFood({ text, imagePath: ctx.image?.tempPath });
  if (!result.is_food || result.items.length === 0) {
    return { reply: "that doesn't look like food to me. send a description (\"200g chicken breast\") or a photo of a meal, or 'help' for commands." };
  }

  const isFirstEverLog = !hasAnyEntries(db, clientId);
  const time = nowTimeInTz(tz);
  const source = ctx.image ? 'photo' : 'text';
  const entries = addEntries(db, {
    clientId, date: today, time, items: result.items, source,
    mealType: mealTypeFromTime(time),
    photoPath: ctx.image?.photoPath || null,
  });
  const report = dayReport(db, clientId, today, defaultTargets);
  const reply = formatLogReply(entries, report);
  if (isFirstEverLog) {
    return { reply: `${reply}\n\n(first one logged — send "today", "week", or "help" anytime)` };
  }
  return { reply };
}

function formatDayLineSafe(db, clientId, date, defaultTargets) {
  return formatDayReport(dayReport(db, clientId, date, defaultTargets)).split('\n').slice(-1)[0];
}

function exportAllEntries(db, clientId) {
  return db.prepare('SELECT * FROM entries WHERE client_id = ? ORDER BY date ASC, id ASC').all(clientId);
}

// Splits "+44 7700 900123 Alex --welcome" into its number (which may itself
// contain spaces/dashes), optional trailing name, and the --welcome flag.
// Consumes tokens made only of digits/+/- as the number; whatever's left
// (minus the flag) is the name.
function splitNumberAndName(rest) {
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && /^\+?\d[\d-]*$/.test(tokens[i])) i++;
  if (i === 0 && tokens.length > 0) i = 1; // always try the first token as the number, even if malformed
  const numberRaw = tokens.slice(0, i).join(' ');
  const remainder = tokens.slice(i);
  const welcome = remainder.some((t) => /^--welcome$/i.test(t));
  const name = remainder.filter((t) => !/^--welcome$/i.test(t)).join(' ').trim() || null;
  return { numberRaw, name, welcome };
}

function clientLabel(client) {
  return client.name ? `${client.name} (${client.client_id})` : client.client_id;
}

function ambiguousReply(ref, matches) {
  const names = matches.map(clientLabel).join(', ');
  return { reply: `more than one client matches "${ref.trim()}": ${names}. use the number instead.` };
}

function handleAddClient(ctx, rest) {
  const { db, defaultCountryCode, botNumber } = ctx;
  const { numberRaw, name, welcome } = splitNumberAndName(rest);
  if (!numberRaw) return { reply: 'usage: add client <number> [name] [--welcome]' };

  const norm = normalizeNumber(numberRaw, defaultCountryCode);
  if (!norm.ok) return { reply: norm.reason };

  const result = addClient(db, { clientId: norm.digits, name });
  if (result.error === 'duplicate') return { reply: `${clientLabel(result.client)} is already a client.` };

  const label = name || norm.digits;
  const verb = result.reactivated ? 're-added' : 'added';
  const inviteText = buildInviteText(botNumber);

  if (welcome) {
    return {
      reply: `${verb} ${label} (${norm.digits}) and sent them a welcome message.`,
      welcomeTo: { clientId: norm.digits, text: inviteText },
    };
  }
  return { reply: `${verb} ${label} (${norm.digits}).\nforward them this to get started:\n\n${inviteText}` };
}

function handleClientStatusChange(db, fn, ref, status) {
  const result = fn(db, ref);
  if (result.error === 'not_found') return { reply: `no client matching "${ref.trim()}".` };
  if (result.error === 'ambiguous') return ambiguousReply(ref, result.matches);
  const verb = status === 'removed' ? 'removed' : status === 'paused' ? 'paused' : 'resumed';
  return { reply: `${verb} ${clientLabel(result.client)}.` };
}

function handleDeleteClientData(db, rest) {
  const trimmed = rest.trim();
  const confirmed = /\s+confirm$/i.test(trimmed);
  const ref = confirmed ? trimmed.replace(/\s+confirm$/i, '').trim() : trimmed;

  const found = resolveClientRef(db, ref);
  if (found.error === 'not_found') return { reply: `no client matching "${ref}".` };
  if (found.error === 'ambiguous') return ambiguousReply(ref, found.matches);

  const label = clientLabel(found.client);
  if (!confirmed) {
    return { reply: `this permanently deletes all of ${label}'s logged food and targets. send "delete client data ${ref} confirm" to go ahead.` };
  }
  deleteClientData(db, found.client.client_id);
  return { reply: `deleted all data for ${label}.` };
}

function handleClientTargets(ctx, match) {
  const [, ref, kcal, protein_g, carbs_g, fat_g] = match;
  const found = resolveClientRef(ctx.db, ref);
  if (found.error === 'not_found') return { reply: `no client matching "${ref.trim()}".` };
  if (found.error === 'ambiguous') return ambiguousReply(ref, found.matches);

  const t = setTargets(ctx.db, found.client.client_id, {
    kcal: Number(kcal), protein_g: Number(protein_g), carbs_g: Number(carbs_g), fat_g: Number(fat_g),
  }, ctx.defaultTargets);
  return { reply: `updated targets for ${clientLabel(found.client)}: ${formatTargets(t)}` };
}

function clientsList(ctx) {
  const { db, tz, defaultTargets } = ctx;
  const roster = listClients(db);
  if (roster.length === 0) return 'no clients yet. add one with "add client <number> [name]".';

  const today = todayInTz(tz);
  const lines = roster.map((c) => {
    const tag = c.status === 'paused' ? ' [paused]' : '';
    const report = dayReport(db, c.client_id, today, defaultTargets);
    return `${clientLabel(c)}${tag}: ${report.eaten.kcal}/${report.targets.kcal} kcal · P${report.eaten.protein_g}/${report.targets.protein_g}g`;
  });
  return `clients (${roster.length})\n${lines.join('\n')}`;
}

function coachSummary(ctx) {
  const { db, tz, allowedNumbers, defaultTargets } = ctx;
  const today = todayInTz(tz);
  const lines = allowedNumbers.map((number) => {
    const client = getClient(db, number);
    const label = client ? clientLabel(client) : number;
    const entries = getEntriesForDate(db, number, today);
    if (entries.length === 0) return `${label}: nothing logged today`;
    const report = dayReport(db, number, today, defaultTargets);
    return `${label}: ${report.eaten.kcal}/${report.targets.kcal} kcal · P${report.eaten.protein_g}/${report.targets.protein_g}g`;
  });
  return `coach summary · ${today}\n${lines.join('\n')}`;
}
