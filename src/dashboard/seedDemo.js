import path from 'node:path';
import { createDb } from '../db.js';
import { addEntries, setTargets } from '../food/store.js';
import { addClient } from '../clients.js';

// Fake client + generic foods, for dashboard screenshots and manual testing
// only. Never commit the db file this produces.
const FOODS = [
  { name: 'grilled chicken breast', grams: 200, kcal: 330, protein_g: 62, carbs_g: 0, fat_g: 7 },
  { name: 'white rice', grams: 150, kcal: 195, protein_g: 4, carbs_g: 42, fat_g: 0.5 },
  { name: 'scrambled eggs', grams: 120, kcal: 190, protein_g: 16, carbs_g: 1, fat_g: 14 },
  { name: 'oatmeal', grams: 80, kcal: 300, protein_g: 10, carbs_g: 54, fat_g: 5 },
  { name: 'greek yogurt', grams: 170, kcal: 140, protein_g: 18, carbs_g: 8, fat_g: 3 },
  { name: 'salmon fillet', grams: 180, kcal: 360, protein_g: 40, carbs_g: 0, fat_g: 22 },
  { name: 'mixed salad', grams: 150, kcal: 60, protein_g: 3, carbs_g: 8, fat_g: 2 },
  { name: 'banana', grams: 120, kcal: 105, protein_g: 1, carbs_g: 27, fat_g: 0 },
  { name: 'protein shake', grams: 40, kcal: 160, protein_g: 25, carbs_g: 6, fat_g: 3 },
  { name: 'sweet potato', grams: 200, kcal: 180, protein_g: 4, carbs_g: 41, fat_g: 0.2 },
  { name: 'whole wheat toast', grams: 60, kcal: 150, protein_g: 7, carbs_g: 26, fat_g: 2 },
  { name: 'granola', grams: 50, kcal: 230, protein_g: 5, carbs_g: 32, fat_g: 9 },
  { name: 'blueberries', grams: 100, kcal: 57, protein_g: 1, carbs_g: 14, fat_g: 0.3 },
  { name: 'turkey sandwich', grams: 220, kcal: 420, protein_g: 30, carbs_g: 45, fat_g: 12 },
  { name: 'apple', grams: 180, kcal: 95, protein_g: 0.5, carbs_g: 25, fat_g: 0.3 },
  { name: 'chicken burrito bowl', grams: 450, kcal: 650, protein_g: 45, carbs_g: 70, fat_g: 18 },
  { name: 'almonds', grams: 30, kcal: 175, protein_g: 6, carbs_g: 6, fat_g: 15 },
  { name: 'cottage cheese', grams: 200, kcal: 180, protein_g: 24, carbs_g: 8, fat_g: 5 },
  { name: 'steamed broccoli', grams: 150, kcal: 50, protein_g: 4, carbs_g: 10, fat_g: 0.5 },
  { name: 'beef stir fry', grams: 300, kcal: 480, protein_g: 38, carbs_g: 20, fat_g: 26 },
  { name: 'pasta with tomato sauce', grams: 350, kcal: 520, protein_g: 18, carbs_g: 92, fat_g: 9 },
];

const MEALS = [
  { time: '07:45', options: [['oatmeal', 'banana', 'greek yogurt'], ['scrambled eggs', 'whole wheat toast'], ['greek yogurt', 'granola', 'blueberries']] },
  { time: '12:30', options: [['grilled chicken breast', 'white rice', 'mixed salad'], ['turkey sandwich', 'apple'], ['chicken burrito bowl']] },
  { time: '16:15', options: [['protein shake', 'banana'], ['almonds', 'apple'], ['cottage cheese', 'blueberries']] },
  { time: '19:30', options: [['salmon fillet', 'sweet potato', 'steamed broccoli'], ['beef stir fry', 'white rice'], ['pasta with tomato sauce', 'mixed salad']] },
];

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEMO_TARGETS = { kcal: 2100, protein_g: 160, carbs_g: 220, fat_g: 60 };

export function seedDemoDb(
  db,
  { clientId = 'alex', name = 'Alex', targets = DEMO_TARGETS, days = 45, today = new Date(), seed = 42, forceGapDays = 0, skipRate = 0.12 } = {}
) {
  addClient(db, { clientId, name });
  setTargets(db, clientId, targets);
  const rand = mulberry32(seed);

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);

    // forceGapDays guarantees a logging gap in the most recent days, so demo
    // data can show a coach "no logs" flag deterministically.
    if (i < forceGapDays) continue;
    // Skip some days so adherence/streak/heatmap have realistic gaps.
    if (rand() < skipRate) continue;

    // Each day aims for the kcal target give or take ~15%, built from a few
    // realistic meals, so averages and adherence look like a real log. Today
    // stops after the afternoon snack, like a day still in progress.
    const dayGoal = targets.kcal * (0.82 + rand() * 0.36);
    const meals = MEALS.slice(0, i === 0 ? 3 : MEALS.length).map((meal) => ({
      ...meal,
      items: meal.options[Math.floor(rand() * meal.options.length)].map((n) => FOODS.find((f) => f.name === n)),
    }));
    const rawKcal = meals.reduce((sum, meal) => sum + meal.items.reduce((s2, f) => s2 + f.kcal, 0), 0);
    const scale = dayGoal / (i === 0 ? rawKcal * (MEALS.length / 3) : rawKcal);
    for (const meal of meals) {
      const jitter = scale * (0.92 + rand() * 0.16);
      const round1 = (v) => Math.round(v * jitter * 10) / 10;
      addEntries(db, {
        clientId,
        date,
        time: meal.time,
        items: meal.items.map((f) => ({
          ...f,
          grams: Math.round((f.grams * jitter) / 5) * 5,
          kcal: Math.round(f.kcal * jitter),
          protein_g: round1(f.protein_g),
          carbs_g: round1(f.carbs_g),
          fat_g: round1(f.fat_g),
          confidence: 0.8 + rand() * 0.2,
        })),
        source: rand() < 0.3 ? 'photo' : 'text',
      });
    }
  }
  return db;
}

// Coach-mode demo: the coach logs their own food too, plus three clients
// with different habits so the roster shows each kind of flag. Numbers are
// in the reserved 555-01xx fictional range.
export const DEMO_COACH_NUMBER = '15555550100';

export function seedCoachDemoDb(db, { today = new Date() } = {}) {
  seedDemoDb(db, { clientId: DEMO_COACH_NUMBER, name: 'Alex', today, seed: 42 });
  seedDemoDb(db, { clientId: '15555550101', name: 'Priya', today, seed: 7, skipRate: 0.02, targets: { kcal: 1900, protein_g: 140, carbs_g: 200, fat_g: 60 } });
  seedDemoDb(db, { clientId: '15555550102', name: 'Jordan', today, seed: 19, skipRate: 0.15, targets: { kcal: 2600, protein_g: 180, carbs_g: 290, fat_g: 75 } });
  seedDemoDb(db, { clientId: '15555550103', name: 'Sam', today, seed: 23, skipRate: 0.3, forceGapDays: 3, targets: { kcal: 2300, protein_g: 155, carbs_g: 250, fat_g: 70 } });
  return db;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outPath = process.argv[2];
  const coach = process.argv.includes('--coach');
  if (!outPath) {
    console.error('usage: node src/dashboard/seedDemo.js <path-to-sqlite-file> [--coach]');
    process.exit(1);
  }
  const db = createDb(path.resolve(outPath));
  if (coach) seedCoachDemoDb(db);
  else seedDemoDb(db);
  console.log(`seeded demo data at ${path.resolve(outPath)}`);
  if (coach) {
    console.log(`run it with: DASHBOARD_DB=${outPath} ALLOWED_NUMBERS=${DEMO_COACH_NUMBER} COACH_NUMBER=${DEMO_COACH_NUMBER} npm run dashboard`);
  }
}
