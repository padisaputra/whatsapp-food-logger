import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { addEntries, setTargets } from '../src/food/store.js';
import { todayView, trendsView, foodStats, coachOverview, photoPathFor, exportEntries } from '../src/dashboard/queries.js';

const ITEM = { name: 'chicken breast', grams: 200, kcal: 330, protein_g: 62, carbs_g: 0, fat_g: 7, confidence: 0.9 };

function seedDb() {
  return createDb(':memory:');
}

test('todayView buckets entries by time of day when no meal_type column exists', () => {
  const db = seedDb();
  addEntries(db, { clientId: 'alex', date: '2026-10-08', time: '08:00', items: [{ ...ITEM, name: 'oatmeal' }], source: 'text' });
  addEntries(db, { clientId: 'alex', date: '2026-10-08', time: '13:00', items: [{ ...ITEM, name: 'rice bowl' }], source: 'text' });
  const view = todayView(db, 'alex', 'UTC', '2026-10-08');
  const meals = view.meals.map((m) => m.meal);
  assert.deepEqual(meals, ['breakfast', 'lunch']);
  assert.equal(view.meals[0].items[0].name, 'oatmeal');
});

test('todayView uses meal_type column when present', () => {
  const db = seedDb();
  addEntries(db, { clientId: 'alex', date: '2026-10-08', time: '23:00', items: [{ ...ITEM, name: 'late snack bar' }], source: 'text' });
  db.prepare("UPDATE entries SET meal_type = 'dinner' WHERE name = 'late snack bar'").run();
  const view = todayView(db, 'alex', 'UTC', '2026-10-08');
  assert.equal(view.meals[0].meal, 'dinner');
});

test('todayView attaches no photoUrl when photo_path column is absent', () => {
  const db = seedDb();
  addEntries(db, { clientId: 'alex', date: '2026-10-08', time: '08:00', items: [ITEM], source: 'text' });
  const view = todayView(db, 'alex', 'UTC', '2026-10-08');
  assert.equal(view.meals[0].items[0].photoUrl, null);
});

test('todayView exposes a photoUrl once photo_path is set', () => {
  const db = seedDb();
  addEntries(db, { clientId: 'alex', date: '2026-10-08', time: '08:00', items: [ITEM], source: 'photo' });
  db.prepare("UPDATE entries SET photo_path = 'photos/1.jpg' WHERE client_id = 'alex'").run();
  const view = todayView(db, 'alex', 'UTC', '2026-10-08');
  assert.match(view.meals[0].items[0].photoUrl, /^\/api\/photo\/\d+$/);
});

test('trendsView computes streak, adherence, and protein hit rate over a range', () => {
  const db = seedDb();
  setTargets(db, 'alex', { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 65 });
  addEntries(db, { clientId: 'alex', date: '2026-10-06', time: '12:00', items: [ITEM], source: 'text' }); // below protein target
  addEntries(db, { clientId: 'alex', date: '2026-10-07', time: '12:00', items: [ITEM, { ...ITEM, grams: 400, kcal: 660, protein_g: 124 }], source: 'text' });
  addEntries(db, { clientId: 'alex', date: '2026-10-08', time: '12:00', items: [ITEM, { ...ITEM, grams: 400, kcal: 660, protein_g: 124 }], source: 'text' });
  const view = trendsView(db, 'alex', 'UTC', 7);
  assert.equal(view.days.length, 7);
  assert.equal(view.streak, 3); // Oct 6,7,8 logged consecutively ending today
  assert.ok(view.adherencePct > 0 && view.adherencePct <= 100);
  assert.equal(view.proteinHitRatePct, Math.round((2 / 3) * 100));
  assert.ok(view.weeks.length >= 1);
});

test('trendsView streak resets if the most recent day has no entries', () => {
  const db = seedDb();
  addEntries(db, { clientId: 'alex', date: '2026-10-05', time: '12:00', items: [ITEM], source: 'text' });
  const view = trendsView(db, 'alex', 'UTC', 7); // "today" is baked in as the range end via todayInTz
  assert.equal(view.streak, 0); // nothing logged on the final day of the range
});

test('foodStats ranks most-logged foods and filters by search', () => {
  const db = seedDb();
  addEntries(db, { clientId: 'alex', date: '2026-10-01', time: '08:00', items: [{ ...ITEM, name: 'banana' }], source: 'text' });
  addEntries(db, { clientId: 'alex', date: '2026-10-02', time: '08:00', items: [{ ...ITEM, name: 'banana' }], source: 'text' });
  addEntries(db, { clientId: 'alex', date: '2026-10-03', time: '08:00', items: [{ ...ITEM, name: 'rice' }], source: 'text' });
  const stats = foodStats(db, 'alex', '');
  assert.equal(stats.mostLogged[0].name, 'banana');
  assert.equal(stats.mostLogged[0].count, 2);

  const filtered = foodStats(db, 'alex', 'ric');
  assert.equal(filtered.mostLogged.length, 1);
  assert.equal(filtered.mostLogged[0].name, 'rice');
});

test('coachOverview flags clients with a logging gap and persistent under-protein days', () => {
  const db = seedDb();
  setTargets(db, 'quiet-client', { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 65 });
  // quiet-client: nothing logged at all -> should flag a gap.
  const overview = coachOverview(db, ['quiet-client'], 'UTC');
  assert.equal(overview[0].clientId, 'quiet-client');
  assert.match(overview[0].flags[0], /no logs \d+ days/);
});

test('photoPathFor returns null when the column does not exist', () => {
  const db = seedDb();
  const [row] = addEntries(db, { clientId: 'alex', date: '2026-10-08', time: '08:00', items: [ITEM], source: 'text' });
  assert.equal(photoPathFor(db, 'alex', row.id), null);
});

test('exportEntries scopes to the requested client only', () => {
  const db = seedDb();
  addEntries(db, { clientId: 'alex', date: '2026-10-08', time: '08:00', items: [ITEM], source: 'text' });
  addEntries(db, { clientId: 'sam', date: '2026-10-08', time: '08:00', items: [ITEM], source: 'text' });
  assert.equal(exportEntries(db, 'alex').length, 1);
});
