import { mondayOf, datesBetween } from '../dates.js';

export const DEFAULT_TARGETS = { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 65 };

export function addEntries(db, { clientId, date, time, items, source, mealType = null, photoPath = null }) {
  const insert = db.prepare(`
    INSERT INTO entries (client_id, date, time, name, grams, kcal, protein_g, carbs_g, fat_g, confidence, source, meal_type, photo_path, created_at)
    VALUES (@clientId, @date, @time, @name, @grams, @kcal, @protein_g, @carbs_g, @fat_g, @confidence, @source, @mealType, @photoPath, @createdAt)
  `);
  const createdAt = new Date().toISOString();
  const rows = [];
  const run = db.transaction((list) => {
    for (const item of list) {
      const info = insert.run({
        clientId,
        date,
        time,
        name: item.name,
        grams: item.grams ?? null,
        kcal: item.kcal ?? 0,
        protein_g: item.protein_g ?? 0,
        carbs_g: item.carbs_g ?? 0,
        fat_g: item.fat_g ?? 0,
        confidence: item.confidence ?? null,
        source,
        mealType,
        photoPath,
        createdAt,
      });
      rows.push(getEntry(db, info.lastInsertRowid));
    }
  });
  run(items);
  return rows;
}

export function getEntry(db, id) {
  return db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
}

export function hasAnyEntries(db, clientId) {
  return db.prepare('SELECT 1 FROM entries WHERE client_id = ? LIMIT 1').get(clientId) !== undefined;
}

export function getEntriesForDate(db, clientId, date) {
  return db
    .prepare('SELECT * FROM entries WHERE client_id = ? AND date = ? ORDER BY id ASC')
    .all(clientId, date);
}

export function deleteEntry(db, clientId, date, id) {
  const row = db.prepare('SELECT * FROM entries WHERE id = ? AND client_id = ? AND date = ?').get(id, clientId, date);
  if (!row) return null;
  db.prepare('DELETE FROM entries WHERE id = ?').run(id);
  return row;
}

export function undoLast(db, clientId, date) {
  const row = db
    .prepare('SELECT * FROM entries WHERE client_id = ? AND date = ? ORDER BY id DESC LIMIT 1')
    .get(clientId, date);
  if (!row) return null;
  db.prepare('DELETE FROM entries WHERE id = ?').run(row.id);
  return row;
}

const EDITABLE_FIELDS = new Set(['name', 'grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g']);

export function editEntry(db, clientId, id, fields) {
  const row = db.prepare('SELECT * FROM entries WHERE id = ? AND client_id = ?').get(id, clientId);
  if (!row) return null;
  const sets = [];
  const params = { id };
  for (const [key, value] of Object.entries(fields)) {
    if (!EDITABLE_FIELDS.has(key)) continue;
    sets.push(`${key} = @${key}`);
    params[key] = value;
  }
  if (sets.length === 0) return row;
  db.prepare(`UPDATE entries SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getEntry(db, id);
}

export function totals(entries) {
  const t = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const e of entries) {
    t.kcal += e.kcal || 0;
    t.protein_g += e.protein_g || 0;
    t.carbs_g += e.carbs_g || 0;
    t.fat_g += e.fat_g || 0;
  }
  return {
    kcal: Math.round(t.kcal),
    protein_g: Math.round(t.protein_g * 10) / 10,
    carbs_g: Math.round(t.carbs_g * 10) / 10,
    fat_g: Math.round(t.fat_g * 10) / 10,
  };
}

export function getTargets(db, clientId, defaults = DEFAULT_TARGETS) {
  const row = db.prepare('SELECT * FROM targets WHERE client_id = ?').get(clientId);
  if (!row) return { ...defaults };
  return { kcal: row.kcal, protein_g: row.protein_g, carbs_g: row.carbs_g, fat_g: row.fat_g };
}

export function setTargets(db, clientId, targets, defaults = DEFAULT_TARGETS) {
  const current = getTargets(db, clientId, defaults);
  const next = { ...current, ...targets };
  db.prepare(`
    INSERT INTO targets (client_id, kcal, protein_g, carbs_g, fat_g, updated_at)
    VALUES (@clientId, @kcal, @protein_g, @carbs_g, @fat_g, @updatedAt)
    ON CONFLICT(client_id) DO UPDATE SET
      kcal = excluded.kcal, protein_g = excluded.protein_g,
      carbs_g = excluded.carbs_g, fat_g = excluded.fat_g, updated_at = excluded.updated_at
  `).run({ clientId, ...next, updatedAt: new Date().toISOString() });
  return next;
}

export function dayReport(db, clientId, date, defaults = DEFAULT_TARGETS) {
  const entries = getEntriesForDate(db, clientId, date);
  const eaten = totals(entries);
  const targets = getTargets(db, clientId, defaults);
  const remaining = {
    kcal: Math.round(targets.kcal - eaten.kcal),
    protein_g: Math.round((targets.protein_g - eaten.protein_g) * 10) / 10,
    carbs_g: Math.round((targets.carbs_g - eaten.carbs_g) * 10) / 10,
    fat_g: Math.round((targets.fat_g - eaten.fat_g) * 10) / 10,
  };
  return { date, entries, eaten, targets, remaining };
}

export function weekReport(db, clientId, date, defaults = DEFAULT_TARGETS) {
  const monday = mondayOf(date);
  const days = datesBetween(monday, date);
  let eatenKcal = 0;
  let eatenProtein = 0;
  let targetKcal = 0;
  let targetProtein = 0;
  const loggedDays = [];
  for (const d of days) {
    const entries = getEntriesForDate(db, clientId, d);
    if (entries.length === 0) continue;
    loggedDays.push(d);
    const eaten = totals(entries);
    const targets = getTargets(db, clientId, defaults);
    eatenKcal += eaten.kcal;
    eatenProtein += eaten.protein_g;
    targetKcal += targets.kcal;
    targetProtein += targets.protein_g;
  }
  return {
    weekStart: monday,
    loggedDays,
    eatenKcal: Math.round(eatenKcal),
    targetKcal: Math.round(targetKcal),
    eatenProtein: Math.round(eatenProtein * 10) / 10,
    targetProtein: Math.round(targetProtein * 10) / 10,
    avgKcal: loggedDays.length ? Math.round(eatenKcal / loggedDays.length) : 0,
  };
}
