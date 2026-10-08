import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import {
  addEntries, deleteEntry, undoLast, editEntry, totals, hasAnyEntries,
  getTargets, setTargets, dayReport, weekReport, DEFAULT_TARGETS,
} from '../src/food/store.js';

function seedDb() {
  return createDb(':memory:');
}

const ITEM = { name: 'chicken breast', grams: 200, kcal: 330, protein_g: 62, carbs_g: 0, fat_g: 7, confidence: 0.9 };

test('addEntries inserts rows scoped to a client and date', () => {
  const db = seedDb();
  const rows = addEntries(db, { clientId: 'alex', date: '2026-10-08', time: '12:00', items: [ITEM], source: 'text' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'chicken breast');
  assert.equal(rows[0].client_id, 'alex');
  assert.equal(rows[0].meal_type, null);
  assert.equal(rows[0].photo_path, null);
});

test('hasAnyEntries reflects whether a client has logged anything, ever', () => {
  const db = seedDb();
  assert.equal(hasAnyEntries(db, 'alex'), false);
  addEntries(db, { clientId: 'alex', date: '2026-10-08', time: '12:00', items: [ITEM], source: 'text' });
  assert.equal(hasAnyEntries(db, 'alex'), true);
  assert.equal(hasAnyEntries(db, 'sam'), false);
});

test('addEntries records meal_type and photo_path when given, shared across all items in the batch', () => {
  const db = seedDb();
  const rows = addEntries(db, {
    clientId: 'alex', date: '2026-10-08', time: '12:00', source: 'photo',
    mealType: 'lunch', photoPath: 'photos/abc.jpg',
    items: [ITEM, { ...ITEM, name: 'rice' }],
  });
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.meal_type, 'lunch');
    assert.equal(row.photo_path, 'photos/abc.jpg');
  }
});

test('totals sums kcal and macros across entries', () => {
  const t = totals([
    { kcal: 100, protein_g: 10, carbs_g: 5, fat_g: 2 },
    { kcal: 50.4, protein_g: 5.26, carbs_g: 1, fat_g: 0 },
  ]);
  assert.equal(t.kcal, 150);
  assert.equal(t.protein_g, 15.3);
  assert.equal(t.carbs_g, 6);
  assert.equal(t.fat_g, 2);
});

test('getTargets falls back to defaults when none are set', () => {
  const db = seedDb();
  assert.deepEqual(getTargets(db, 'alex'), DEFAULT_TARGETS);
});

test('getTargets falls back to a custom defaults object when given one', () => {
  const db = seedDb();
  const custom = { kcal: 2500, protein_g: 180, carbs_g: 250, fat_g: 80 };
  assert.deepEqual(getTargets(db, 'alex', custom), custom);
});

test('setTargets persists and partially-updates targets', () => {
  const db = seedDb();
  setTargets(db, 'alex', { kcal: 2200, protein_g: 160, carbs_g: 220, fat_g: 70 });
  setTargets(db, 'alex', { kcal: 2000 });
  const t = getTargets(db, 'alex');
  assert.equal(t.kcal, 2000);
  assert.equal(t.protein_g, 160); // unchanged
});

test('dayReport computes eaten, targets, and remaining', () => {
  const db = seedDb();
  setTargets(db, 'alex', { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 65 });
  addEntries(db, { clientId: 'alex', date: '2026-10-08', time: '12:00', items: [ITEM], source: 'text' });
  const report = dayReport(db, 'alex', '2026-10-08');
  assert.equal(report.eaten.kcal, 330);
  assert.equal(report.remaining.kcal, 1670);
  assert.equal(report.remaining.protein_g, 88);
});

test('undoLast removes the most recently added entry for that day only', () => {
  const db = seedDb();
  addEntries(db, { clientId: 'alex', date: '2026-10-08', time: '12:00', items: [ITEM], source: 'text' });
  addEntries(db, { clientId: 'alex', date: '2026-10-08', time: '12:05', items: [{ ...ITEM, name: 'rice' }], source: 'text' });
  const gone = undoLast(db, 'alex', '2026-10-08');
  assert.equal(gone.name, 'rice');
  const report = dayReport(db, 'alex', '2026-10-08');
  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].name, 'chicken breast');
});

test('deleteEntry only deletes within the matching client and date', () => {
  const db = seedDb();
  const [row] = addEntries(db, { clientId: 'alex', date: '2026-10-08', time: '12:00', items: [ITEM], source: 'text' });
  assert.equal(deleteEntry(db, 'someone-else', '2026-10-08', row.id), null);
  assert.equal(deleteEntry(db, 'alex', '2026-10-07', row.id), null);
  const gone = deleteEntry(db, 'alex', '2026-10-08', row.id);
  assert.equal(gone.id, row.id);
});

test('editEntry updates only whitelisted fields', () => {
  const db = seedDb();
  const [row] = addEntries(db, { clientId: 'alex', date: '2026-10-08', time: '12:00', items: [ITEM], source: 'text' });
  const updated = editEntry(db, 'alex', row.id, { grams: 250, kcal: 400, client_id: 'hacker' });
  assert.equal(updated.grams, 250);
  assert.equal(updated.kcal, 400);
  assert.equal(updated.client_id, 'alex'); // not editable, unchanged
});

test('weekReport only counts days that have at least one entry', () => {
  const db = seedDb();
  setTargets(db, 'alex', { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 65 });
  addEntries(db, { clientId: 'alex', date: '2026-10-05', time: '12:00', items: [ITEM], source: 'text' }); // Monday
  addEntries(db, { clientId: 'alex', date: '2026-10-08', time: '12:00', items: [ITEM], source: 'text' }); // Thursday
  const week = weekReport(db, 'alex', '2026-10-08');
  assert.equal(week.weekStart, '2026-10-05');
  assert.deepEqual(week.loggedDays, ['2026-10-05', '2026-10-08']);
  assert.equal(week.eatenKcal, 660);
  assert.equal(week.targetKcal, 4000);
});
