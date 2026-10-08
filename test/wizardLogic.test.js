import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTargetsFromProfile, parseAllowedNumbers, renderEnv, isAuthError } from '../scripts/lib/wizardLogic.js';

test('computeTargetsFromProfile applies Mifflin-St Jeor and a goal adjustment', () => {
  const maintain = computeTargetsFromProfile({ weightKg: 80, heightCm: 180, age: 30, sex: 'male', activity: 'moderate', goal: 'maintain' });
  const cut = computeTargetsFromProfile({ weightKg: 80, heightCm: 180, age: 30, sex: 'male', activity: 'moderate', goal: 'cut' });
  assert.ok(cut.kcal < maintain.kcal, 'cutting should land under maintenance calories');
  assert.equal(cut.kcal, maintain.kcal - 500);
  assert.equal(maintain.protein_g, 160); // 2g/kg * 80kg
});

test('computeTargetsFromProfile never returns negative carbs', () => {
  const t = computeTargetsFromProfile({ weightKg: 40, heightCm: 150, age: 70, sex: 'female', activity: 'sedentary', goal: 'cut' });
  assert.ok(t.carbs_g >= 0);
});

test('parseAllowedNumbers strips non-digits, dedupes, drops empties', () => {
  assert.deepEqual(parseAllowedNumbers('+1 234, 1234, , 555-000'), ['1234', '555000']);
});

test('renderEnv replaces only the keys given, leaving comments and unknown keys untouched', () => {
  const template = '# comment\nTZ=UTC\nALLOWED_NUMBERS=0\nCLAUDE_MODEL=sonnet\n';
  const out = renderEnv(template, { TZ: 'Asia/Bangkok', ALLOWED_NUMBERS: '620000000' });
  assert.equal(out, '# comment\nTZ=Asia/Bangkok\nALLOWED_NUMBERS=620000000\nCLAUDE_MODEL=sonnet\n');
});

test('isAuthError recognizes common CLI auth failure phrasings', () => {
  assert.ok(isAuthError('401: Invalid authentication provided'));
  assert.ok(isAuthError('please run /login to continue'));
  assert.ok(!isAuthError('rate limited, try again later'));
});
