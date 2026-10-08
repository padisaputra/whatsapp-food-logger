import { todayInTz, addDays, datesBetween, mondayOf } from '../dates.js';
import { getEntriesForDate, totals, getTargets, dayReport } from '../food/store.js';
import { hasColumn } from './dbAccess.js';

const MEAL_ORDER = ['breakfast', 'lunch', 'snack', 'dinner', 'late snack'];

function mealBucket(time) {
  const hour = Number((time || '0').split(':')[0]) || 0;
  if (hour < 11) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 18) return 'snack';
  if (hour < 22) return 'dinner';
  return 'late snack';
}

function withPhoto(db, entry) {
  const photoUrl = hasColumn(db, 'entries', 'photo_path') && entry.photo_path ? `/api/photo/${entry.id}` : null;
  return { ...entry, photoUrl };
}

// Groups by the real meal_type column once the core bot adds it; falls back
// to a time-of-day bucket so the feature works against today's schema too.
export function groupByMeal(db, entries) {
  const hasMealType = hasColumn(db, 'entries', 'meal_type');
  const groups = new Map();
  for (const entry of entries) {
    const meal = (hasMealType && entry.meal_type) || mealBucket(entry.time);
    if (!groups.has(meal)) groups.set(meal, []);
    groups.get(meal).push(withPhoto(db, entry));
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const ai = MEAL_ORDER.indexOf(a);
      const bi = MEAL_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    })
    .map(([meal, items]) => ({ meal, items, totals: totals(items) }));
}

export function todayView(db, clientId, tz, date) {
  const day = date || todayInTz(tz);
  const report = dayReport(db, clientId, day);
  return { ...report, meals: groupByMeal(db, report.entries) };
}

function currentStreak(daily) {
  let streak = 0;
  for (let i = daily.length - 1; i >= 0; i--) {
    if (!daily[i].logged) break;
    streak++;
  }
  return streak;
}

function weeklyAverages(daily) {
  const weeks = new Map();
  for (const day of daily) {
    const weekStart = mondayOf(day.date);
    if (!weeks.has(weekStart)) weeks.set(weekStart, []);
    weeks.get(weekStart).push(day);
  }
  return [...weeks.entries()].map(([weekStart, days]) => {
    const logged = days.filter((d) => d.logged);
    const avg = (key) => (logged.length ? logged.reduce((sum, d) => sum + d.eaten[key], 0) / logged.length : 0);
    return {
      weekStart,
      loggedDays: logged.length,
      avgKcal: Math.round(avg('kcal')),
      avgProtein: Math.round(avg('protein_g') * 10) / 10,
    };
  });
}

export function trendsView(db, clientId, tz, rangeDays) {
  const today = todayInTz(tz);
  const start = addDays(today, -(rangeDays - 1));
  const targets = getTargets(db, clientId);
  const daily = datesBetween(start, today).map((date) => {
    const entries = getEntriesForDate(db, clientId, date);
    return { date, eaten: totals(entries), logged: entries.length > 0 };
  });
  const loggedDays = daily.filter((d) => d.logged);
  const proteinHits = loggedDays.filter((d) => d.eaten.protein_g >= targets.protein_g).length;
  const avg = (key) => (loggedDays.length ? loggedDays.reduce((sum, d) => sum + d.eaten[key], 0) / loggedDays.length : 0);

  return {
    range: rangeDays,
    days: daily,
    targets,
    avgKcal: Math.round(avg('kcal')),
    avgProtein: Math.round(avg('protein_g') * 10) / 10,
    streak: currentStreak(daily),
    adherencePct: daily.length ? Math.round((loggedDays.length / daily.length) * 100) : 0,
    proteinHitRatePct: loggedDays.length ? Math.round((proteinHits / loggedDays.length) * 100) : 0,
    weeks: weeklyAverages(daily),
  };
}

export function foodStats(db, clientId, search) {
  const pattern = `%${(search || '').trim()}%`;
  const rows = db
    .prepare('SELECT * FROM entries WHERE client_id = @clientId AND name LIKE @pattern ORDER BY date DESC, id DESC')
    .all({ clientId, pattern });

  const byName = new Map();
  for (const row of rows) {
    const key = row.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, { name: row.name, count: 0, kcalSum: 0, lastDate: row.date });
    const g = byName.get(key);
    g.count += 1;
    g.kcalSum += row.kcal;
    if (row.date > g.lastDate) g.lastDate = row.date;
  }
  const mostLogged = [...byName.values()]
    .map((g) => ({ name: g.name, count: g.count, avgKcal: Math.round(g.kcalSum / g.count), lastDate: g.lastDate }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return { mostLogged, history: rows.slice(0, 200).map((r) => withPhoto(db, r)) };
}

export function coachOverview(db, allowedNumbers, tz) {
  const today = todayInTz(tz);
  return allowedNumbers.map((clientId) => {
    const report = dayReport(db, clientId, today);
    const last = db
      .prepare('SELECT date, time FROM entries WHERE client_id = ? ORDER BY date DESC, id DESC LIMIT 1')
      .get(clientId);
    const week = trendsView(db, clientId, tz, 7);

    let gap = 0;
    for (let i = week.days.length - 1; i >= 0; i--) {
      if (!week.days[i].logged) gap++;
      else break;
    }
    const loggedDays = week.days.filter((d) => d.logged).length;
    const underProteinDays = week.days.filter((d) => d.logged && d.eaten.protein_g < week.targets.protein_g).length;

    const flags = [];
    if (gap >= 2) flags.push(`no logs ${gap} days`);
    if (loggedDays >= 5 && underProteinDays >= 5) flags.push(`under protein ${underProteinDays}/${loggedDays} days`);

    return {
      clientId,
      today: { eaten: report.eaten, targets: report.targets },
      lastLog: last ? `${last.date} ${last.time}` : null,
      adherencePct: week.adherencePct,
      proteinHitRatePct: week.proteinHitRatePct,
      flags,
    };
  });
}

export function photoPathFor(db, clientId, entryId) {
  if (!hasColumn(db, 'entries', 'photo_path')) return null;
  const row = db.prepare('SELECT photo_path FROM entries WHERE id = ? AND client_id = ?').get(entryId, clientId);
  return row?.photo_path || null;
}

export function exportEntries(db, clientId) {
  return db.prepare('SELECT * FROM entries WHERE client_id = ? ORDER BY date ASC, id ASC').all(clientId);
}
