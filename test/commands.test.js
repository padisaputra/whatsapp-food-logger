import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { handleMessage } from '../src/commands.js';

const CHICKEN = { name: 'chicken breast', grams: 200, kcal: 330, protein_g: 62, carbs_g: 0, fat_g: 7, confidence: 0.9 };

function baseCtx(overrides = {}) {
  return {
    db: createDb(':memory:'),
    extractFood: async () => ({ is_food: true, items: [CHICKEN] }),
    tz: 'UTC',
    clientId: 'alex',
    isAdmin: false,
    allowedNumbers: ['alex'],
    defaultCountryCode: '',
    botNumber: '15550009999',
    text: '',
    image: null,
    ...overrides,
  };
}

test('unrecognized text with no AI configured asks for help', async () => {
  const res = await handleMessage(baseCtx({ text: 'blah', extractFood: null }));
  assert.match(res.reply, /help/);
});

test('free text logs food via the AI extractor and reports day totals', async () => {
  const res = await handleMessage(baseCtx({ text: '200g chicken breast' }));
  assert.match(res.reply, /chicken breast/);
  assert.match(res.reply, /330 kcal/);
  assert.match(res.reply, /\/ 2000 kcal/);
});

test('the very first logged food gets a one-time onboarding tip', async () => {
  const ctx = baseCtx();
  const first = await handleMessage({ ...ctx, text: '200g chicken breast' });
  assert.match(first.reply, /first one logged/);
  const second = await handleMessage({ ...ctx, text: '200g chicken breast' });
  assert.doesNotMatch(second.reply, /first one logged/);
});

test('targets set then targets show round-trips', async () => {
  const ctx = baseCtx();
  await handleMessage({ ...ctx, text: 'targets set 2200 160 220 70' });
  const res = await handleMessage({ ...ctx, text: 'targets show' });
  assert.equal(res.reply, 'targets: 2200 kcal · P160 C220 F70');
});

test('today reports nothing logged before any entry exists', async () => {
  const res = await handleMessage(baseCtx({ text: 'today' }));
  assert.match(res.reply, /nothing logged yet/);
});

test('undo removes the most recent entry', async () => {
  const ctx = baseCtx();
  await handleMessage({ ...ctx, text: '200g chicken breast' });
  const res = await handleMessage({ ...ctx, text: 'undo' });
  assert.match(res.reply, /removed: chicken breast/);
  const after = await handleMessage({ ...ctx, text: 'today' });
  assert.match(after.reply, /nothing logged yet/);
});

test('delete removes a specific entry by id', async () => {
  const ctx = baseCtx();
  await handleMessage({ ...ctx, text: '200g chicken breast' });
  const row = ctx.db.prepare('SELECT id FROM entries LIMIT 1').get();
  const res = await handleMessage({ ...ctx, text: `delete ${row.id}` });
  assert.match(res.reply, /removed: chicken breast/);
});

test('edit updates a field on an existing entry', async () => {
  const ctx = baseCtx();
  await handleMessage({ ...ctx, text: '200g chicken breast' });
  const row = ctx.db.prepare('SELECT id FROM entries LIMIT 1').get();
  const res = await handleMessage({ ...ctx, text: `edit ${row.id} grams=250 kcal=400` });
  assert.match(res.reply, /400 kcal/);
});

test('export returns a CSV file for every logged entry', async () => {
  const ctx = baseCtx();
  await handleMessage({ ...ctx, text: '200g chicken breast' });
  const res = await handleMessage({ ...ctx, text: 'export' });
  assert.ok(res.file);
  assert.match(res.file.content, /chicken breast/);
  assert.equal(res.file.name, 'alex-food-log.csv');
});

test('coach command is rejected for non-admins and allowed for the admin', async () => {
  const ctx = baseCtx({ isAdmin: false });
  const denied = await handleMessage({ ...ctx, text: 'coach summary' });
  assert.match(denied.reply, /coach account only/);

  const allowed = await handleMessage({ ...ctx, isAdmin: true, text: 'coach summary' });
  assert.match(allowed.reply, /coach summary/);
});

test('a non-food message gets a polite redirect instead of being logged', async () => {
  const ctx = baseCtx({ text: "hey what's up", extractFood: async () => ({ is_food: false, items: [] }) });
  const res = await handleMessage(ctx);
  assert.match(res.reply, /doesn't look like food/);
  const after = await handleMessage({ ...ctx, text: 'today' });
  assert.match(after.reply, /nothing logged yet/);
});

test('edit rejects an unknown or non-numeric field instead of writing garbage', async () => {
  const ctx = baseCtx();
  await handleMessage({ ...ctx, text: '200g chicken breast' });
  const row = ctx.db.prepare('SELECT id FROM entries LIMIT 1').get();

  const badField = await handleMessage({ ...ctx, text: `edit ${row.id} client_id=hacker` });
  assert.match(badField.reply, /couldn't understand field/);

  const badNumber = await handleMessage({ ...ctx, text: `edit ${row.id} kcal=notanumber` });
  assert.match(badNumber.reply, /couldn't understand field/);

  const unchanged = ctx.db.prepare('SELECT * FROM entries WHERE id = ?').get(row.id);
  assert.equal(unchanged.kcal, 330);
});

test('a very long message is rejected before calling the AI', async () => {
  let called = false;
  const ctx = baseCtx({ text: 'a'.repeat(5000), extractFood: async () => { called = true; return { is_food: true, items: [] }; } });
  const res = await handleMessage(ctx);
  assert.match(res.reply, /pretty long/);
  assert.equal(called, false);
});

test('a logged photo entry carries meal_type and photo_path onto every item', async () => {
  const ctx = baseCtx({ image: { tempPath: '/tmp/x/photo.jpg', photoPath: 'photos/x.jpg' } });
  await handleMessage({ ...ctx, text: '' });
  const row = ctx.db.prepare('SELECT * FROM entries LIMIT 1').get();
  assert.equal(row.source, 'photo');
  assert.equal(row.photo_path, 'photos/x.jpg');
  assert.ok(['breakfast', 'lunch', 'dinner', 'snack'].includes(row.meal_type));
});

test('custom defaultTargets flow through to today/targets replies', async () => {
  const ctx = baseCtx({ defaultTargets: { kcal: 2500, protein_g: 180, carbs_g: 250, fat_g: 80 } });
  const res = await handleMessage({ ...ctx, text: 'targets show' });
  assert.equal(res.reply, 'targets: 2500 kcal · P180 C250 F80');
});

test('add client is rejected for non-admins and allowed for the admin', async () => {
  const ctx = baseCtx({ isAdmin: false });
  const denied = await handleMessage({ ...ctx, text: 'add client 447700900123 Sam' });
  assert.match(denied.reply, /coach account only/);

  const allowed = await handleMessage({ ...ctx, isAdmin: true, text: 'add client 447700900123 Sam' });
  assert.match(allowed.reply, /added Sam \(447700900123\)/);
  assert.match(allowed.reply, /wa\.me\/15550009999/);
  assert.equal(allowed.welcomeTo, undefined);

  const dup = await handleMessage({ ...ctx, isAdmin: true, text: 'add client 447700900123 Sam again' });
  assert.match(dup.reply, /already a client/);
});

test('add client accepts a number containing spaces and an optional --welcome flag', async () => {
  const ctx = baseCtx({ isAdmin: true });
  const res = await handleMessage({ ...ctx, text: 'add client +44 7700 900123 Sam --welcome' });
  assert.match(res.reply, /added Sam \(447700900123\)/);
  assert.match(res.reply, /welcome message/);
  assert.equal(res.welcomeTo.clientId, '447700900123');
  assert.match(res.welcomeTo.text, /wa\.me\/15550009999/);
});

test('add client expands a leading 0 using defaultCountryCode', async () => {
  const ctx = baseCtx({ isAdmin: true, defaultCountryCode: '62' });
  const res = await handleMessage({ ...ctx, text: 'add client 0812-3456-7890 Budi' });
  assert.match(res.reply, /added Budi \(6281234567890\)/);
});

test('add client without a name still works, and rejects an implausible number', async () => {
  const ctx = baseCtx({ isAdmin: true });
  const ok = await handleMessage({ ...ctx, text: 'add client 447700900123' });
  assert.match(ok.reply, /added 447700900123/);

  const bad = await handleMessage({ ...ctx, text: 'add client 12345' });
  assert.match(bad.reply, /doesn't look like a full number/);
});

test('clients command lists the roster with today totals, admin only', async () => {
  const ctx = baseCtx({ isAdmin: true });
  await handleMessage({ ...ctx, text: 'add client 15550001111 Sam' });
  const res = await handleMessage({ ...ctx, text: 'clients' });
  assert.match(res.reply, /Sam \(15550001111\)/);
  assert.match(res.reply, /0\/2000 kcal/);

  const denied = await handleMessage({ ...ctx, isAdmin: false, text: 'clients' });
  assert.match(denied.reply, /coach account only/);
});

test('client <name> targets sets another client\'s targets, not the caller\'s own', async () => {
  const ctx = baseCtx({ isAdmin: true });
  await handleMessage({ ...ctx, text: 'add client 15550001111 Sam' });
  const res = await handleMessage({ ...ctx, text: 'client Sam targets 2100 160 220 60' });
  assert.match(res.reply, /updated targets for Sam/);
  assert.match(res.reply, /2100 kcal/);

  const samTargets = await handleMessage({ ...ctx, clientId: '15550001111', text: 'targets show' });
  assert.equal(samTargets.reply, 'targets: 2100 kcal · P160 C220 F60');
  const ownTargets = await handleMessage({ ...ctx, text: 'targets show' });
  assert.equal(ownTargets.reply, 'targets: 2000 kcal · P150 C200 F65'); // unchanged
});

test('pause client then resume client toggles whether they show as paused', async () => {
  const ctx = baseCtx({ isAdmin: true });
  await handleMessage({ ...ctx, text: 'add client 15550001111 Sam' });
  const paused = await handleMessage({ ...ctx, text: 'pause client Sam' });
  assert.match(paused.reply, /paused Sam/);
  const list = await handleMessage({ ...ctx, text: 'clients' });
  assert.match(list.reply, /\[paused\]/);

  const resumed = await handleMessage({ ...ctx, text: 'resume client Sam' });
  assert.match(resumed.reply, /resumed Sam/);
  const listAfter = await handleMessage({ ...ctx, text: 'clients' });
  assert.doesNotMatch(listAfter.reply, /\[paused\]/);
});

test('remove client by number, then re-adding reactivates instead of duplicating', async () => {
  const ctx = baseCtx({ isAdmin: true });
  await handleMessage({ ...ctx, text: 'add client 15550001111 Sam' });
  const removed = await handleMessage({ ...ctx, text: 'remove client 15550001111' });
  assert.match(removed.reply, /removed Sam/);
  assert.doesNotMatch((await handleMessage({ ...ctx, text: 'clients' })).reply, /Sam/);

  const readded = await handleMessage({ ...ctx, text: 'add client 15550001111' });
  assert.match(readded.reply, /re-added/);
});

test('an unknown client reference gives a clear error instead of a crash', async () => {
  const ctx = baseCtx({ isAdmin: true });
  const res = await handleMessage({ ...ctx, text: 'pause client nobody' });
  assert.match(res.reply, /no client matching/);
});

test('an ambiguous client name asks the coach to use the number instead', async () => {
  const ctx = baseCtx({ isAdmin: true });
  await handleMessage({ ...ctx, text: 'add client 15550001111 Sam' });
  await handleMessage({ ...ctx, text: 'add client 15550002222 Sam' });
  const res = await handleMessage({ ...ctx, text: 'pause client Sam' });
  assert.match(res.reply, /more than one client matches/);
});

test('delete client data requires a confirm step before it actually deletes anything', async () => {
  const ctx = baseCtx({ isAdmin: true });
  await handleMessage({ ...ctx, text: 'add client 15550001111 Sam' });
  const warn = await handleMessage({ ...ctx, text: 'delete client data Sam' });
  assert.match(warn.reply, /permanently deletes/);
  assert.match((await handleMessage({ ...ctx, text: 'clients' })).reply, /Sam/); // still there

  const confirmed = await handleMessage({ ...ctx, text: 'delete client data Sam confirm' });
  assert.match(confirmed.reply, /deleted all data for Sam/);
  assert.doesNotMatch((await handleMessage({ ...ctx, text: 'clients' })).reply, /Sam/);
});

test('coach summary shows client names, same as the clients command, instead of raw numbers', async () => {
  const ctx = baseCtx({ isAdmin: true });
  await handleMessage({ ...ctx, text: 'add client 15550001111 Sam' });
  const res = await handleMessage({ ...ctx, allowedNumbers: ['alex', '15550001111'], text: 'coach summary' });
  assert.match(res.reply, /Sam \(15550001111\): nothing logged today/);
  assert.doesNotMatch(res.reply, /^15550001111:/m);
});

test('help includes coach commands only for the admin', async () => {
  const ctx = baseCtx({ isAdmin: false });
  const plain = await handleMessage({ ...ctx, text: 'help' });
  assert.doesNotMatch(plain.reply, /add client/);

  const admin = await handleMessage({ ...ctx, isAdmin: true, text: 'help' });
  assert.match(admin.reply, /add client/);
});
