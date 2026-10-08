// Client registry: who's allowed to talk to the bot, backed by the `clients`
// SQLite table (see src/db.js). This is the single place that knows how to
// parse/validate a WhatsApp number, add/remove/pause a client, and resolve a
// coach's "<name|number>" reference back to a client row. Used by the
// WhatsApp command handler, the dashboard's coach actions, and the setup
// wizard's "add your first clients" step.

function now() {
  return new Date().toISOString();
}

// Accepts loosely-formatted input ("+44 7700 900123", "0812-3456-7890") and
// returns digits-only E.164-ish output. A bare leading "0" (common in local
// formatting) is expanded using defaultCountryCode, since a trainer typing a
// client's number as saved in their phone will often omit the country code.
export function normalizeNumber(raw, defaultCountryCode = '') {
  const trimmed = String(raw ?? '').trim();
  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!hasPlus && digits.startsWith('0') && defaultCountryCode) {
    digits = String(defaultCountryCode).replace(/\D/g, '') + digits.slice(1);
  }
  if (digits.length < 8 || digits.length > 15) {
    return { ok: false, reason: `"${trimmed}" doesn't look like a full number with country code (expected 8-15 digits)` };
  }
  return { ok: true, digits };
}

export function getClient(db, clientId) {
  return db.prepare('SELECT * FROM clients WHERE client_id = ?').get(clientId);
}

// Non-removed clients only — the day-to-day roster for "clients", coach
// summary/overview, and the dashboard's client picker.
export function listClients(db) {
  return db.prepare("SELECT * FROM clients WHERE status != 'removed' ORDER BY created_at ASC").all();
}

export function isActiveClient(db, clientId) {
  const row = db.prepare('SELECT status FROM clients WHERE client_id = ?').get(clientId);
  return Boolean(row && row.status === 'active');
}

// Looks up a client by exact client_id (digits extracted from ref) or, failing
// that, an exact case-insensitive name match. Returns { client } on a single
// match, { error: 'ambiguous', matches } on more than one name match, or
// { error: 'not_found' }.
export function resolveClientRef(db, ref) {
  const raw = String(ref ?? '').trim();
  if (!raw) return { error: 'not_found' };

  const digits = raw.replace(/\D/g, '');
  if (digits) {
    const byId = getClient(db, digits);
    if (byId) return { client: byId };
  }

  const matches = db.prepare('SELECT * FROM clients WHERE LOWER(name) = LOWER(?)').all(raw);
  if (matches.length === 1) return { client: matches[0] };
  if (matches.length > 1) return { error: 'ambiguous', matches };
  return { error: 'not_found' };
}

// Adding a previously-removed number reactivates it (and refreshes the name,
// if one was given) rather than rejecting it as a duplicate — a coach bringing
// a client back shouldn't be stuck.
export function addClient(db, { clientId, name = null }) {
  const existing = getClient(db, clientId);
  if (existing && existing.status !== 'removed') {
    return { error: 'duplicate', client: existing };
  }
  if (existing) {
    db.prepare('UPDATE clients SET status = ?, name = COALESCE(?, name), updated_at = ? WHERE client_id = ?')
      .run('active', name, now(), clientId);
    return { client: getClient(db, clientId), reactivated: true };
  }
  db.prepare('INSERT INTO clients (client_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(clientId, name, 'active', now(), now());
  return { client: getClient(db, clientId), reactivated: false };
}

function setStatus(db, ref, status) {
  const found = resolveClientRef(db, ref);
  if (!found.client) return found;
  db.prepare('UPDATE clients SET status = ?, updated_at = ? WHERE client_id = ?').run(status, now(), found.client.client_id);
  return { client: getClient(db, found.client.client_id) };
}

export const removeClient = (db, ref) => setStatus(db, ref, 'removed');
export const pauseClient = (db, ref) => setStatus(db, ref, 'paused');
export const resumeClient = (db, ref) => setStatus(db, ref, 'active');

// Hard delete: entries, targets, and the client row itself. Separate from
// removeClient (which just blocks access and keeps history) — this is the
// "delete client data" command/action, meant to be used rarely and only after
// an explicit confirm step from the caller.
export function deleteClientData(db, ref) {
  const found = resolveClientRef(db, ref);
  if (!found.client) return found;
  const clientId = found.client.client_id;
  db.transaction(() => {
    db.prepare('DELETE FROM entries WHERE client_id = ?').run(clientId);
    db.prepare('DELETE FROM targets WHERE client_id = ?').run(clientId);
    db.prepare('DELETE FROM clients WHERE client_id = ?').run(clientId);
  })();
  return { client: found.client };
}

// One-time (idempotent) migration: numbers from the .env ALLOWED_NUMBERS list
// predate the clients table, so every startup folds them in as active clients
// if they aren't already there. Never overwrites a client someone already
// paused/removed through a command.
export function seedClientsFromAllowedNumbers(db, allowedNumbers) {
  const insert = db.prepare('INSERT OR IGNORE INTO clients (client_id, name, status, created_at, updated_at) VALUES (?, NULL, \'active\', ?, ?)');
  db.transaction((numbers) => {
    const ts = now();
    for (const clientId of numbers) insert.run(clientId, ts, ts);
  })(allowedNumbers);
}

// Text handed to a coach to forward to a new client (or sent directly to the
// client when they opt into --welcome). Kept in one place so both say the
// same thing.
export function buildInviteText(botNumber) {
  const how = 'just text what you eat (e.g. "200g chicken breast, 150g rice") or send a photo of your meal.';
  if (!botNumber) return `you're set up on the food logging bot — message it to start. ${how}`;
  return `you're set up on the food logging bot — message this number to start: https://wa.me/${botNumber}\n${how}`;
}
