import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLoggedItems, formatDayLine, formatWeekReport, formatTargets } from '../src/food/format.js';

test('formatLoggedItems renders one line per item with grams and macros', () => {
  const out = formatLoggedItems([
    { name: 'rice', grams: 150, kcal: 195, protein_g: 4, carbs_g: 42, fat_g: 0.5 },
  ]);
  assert.equal(out, '• rice · 150g · 195 kcal · P4 C42 F0.5');
});

test('formatLoggedItems omits grams when not recorded', () => {
  const out = formatLoggedItems([{ name: 'mystery shake', grams: null, kcal: 200, protein_g: 20, carbs_g: 10, fat_g: 5 }]);
  assert.equal(out, '• mystery shake · 200 kcal · P20 C10 F5');
});

test('formatDayLine shows "left" when under target', () => {
  const line = formatDayLine({
    eaten: { kcal: 500, protein_g: 40, carbs_g: 50, fat_g: 10 },
    targets: { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 65 },
    remaining: { kcal: 1500, protein_g: 110, carbs_g: 150, fat_g: 55 },
  });
  assert.equal(line, '500 / 2000 kcal (1500 left) · P 40/150g (110g left) · C 50/200g · F 10/65g');
});

test('formatDayLine shows "over" when past target', () => {
  const line = formatDayLine({
    eaten: { kcal: 2500, protein_g: 150, carbs_g: 200, fat_g: 65 },
    targets: { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 65 },
    remaining: { kcal: -500, protein_g: 0, carbs_g: 0, fat_g: 0 },
  });
  assert.match(line, /500 over/);
});

test('formatDayLine omits the protein "left" hint once the target is met', () => {
  const line = formatDayLine({
    eaten: { kcal: 1800, protein_g: 160, carbs_g: 200, fat_g: 60 },
    targets: { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 65 },
    remaining: { kcal: 200, protein_g: -10, carbs_g: 0, fat_g: 5 },
  });
  assert.equal(line, '1800 / 2000 kcal (200 left) · P 160/150g · C 200/200g · F 60/65g');
});

test('formatWeekReport includes average only when there are logged days', () => {
  const withDays = formatWeekReport({
    weekStart: '2026-10-05', loggedDays: ['2026-10-05', '2026-10-06'],
    eatenKcal: 3000, targetKcal: 4000, eatenProtein: 200, targetProtein: 300, avgKcal: 1500,
  });
  assert.match(withDays, /avg 1500 kcal\/day/);

  const noDays = formatWeekReport({
    weekStart: '2026-10-05', loggedDays: [], eatenKcal: 0, targetKcal: 0, eatenProtein: 0, targetProtein: 0, avgKcal: 0,
  });
  assert.doesNotMatch(noDays, /avg/);
});

test('formatTargets renders a one-line summary', () => {
  assert.equal(formatTargets({ kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 65 }), 'targets: 2000 kcal · P150 C200 F65');
});
