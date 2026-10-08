import test from 'node:test';
import assert from 'node:assert/strict';
import { entriesToCsv } from '../src/food/csv.js';

test('entriesToCsv writes a header and one row per entry', () => {
  const csv = entriesToCsv([
    { id: 1, date: '2026-10-08', time: '12:00', name: 'rice', grams: 150, kcal: 195, protein_g: 4, carbs_g: 42, fat_g: 0.5, confidence: 0.9, source: 'text', meal_type: 'lunch', photo_path: null },
  ]);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'id,date,time,name,grams,kcal,protein_g,carbs_g,fat_g,confidence,source,meal_type,photo_path');
  assert.equal(lines[1], '1,2026-10-08,12:00,rice,150,195,4,42,0.5,0.9,text,lunch,');
});

test('entriesToCsv quotes fields containing commas', () => {
  const csv = entriesToCsv([
    { id: 1, date: '2026-10-08', time: '12:00', name: 'rice, white', grams: 150, kcal: 195, protein_g: 4, carbs_g: 42, fat_g: 0.5, confidence: 0.9, source: 'text', meal_type: 'lunch', photo_path: null },
  ]);
  assert.match(csv, /"rice, white"/);
});
