import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createFoodExtractor } from '../src/ai/foodExtract.js';
import { _setRunner, _resetRunner } from '../src/ai/claudeCli.js';

const ITEM = { name: 'chicken breast', grams: 200, kcal: 330, protein_g: 62, carbs_g: 0, fat_g: 7, confidence: 0.9 };

function outer(structured) {
  return JSON.stringify({ is_error: false, result: 'done', structured_output: structured });
}

test.afterEach(() => _resetRunner());

test('text input runs with no tools and returns items', async () => {
  let seenArgs = null;
  _setRunner(async (args) => {
    seenArgs = args;
    return { code: 0, out: outer({ is_food: true, items: [ITEM] }), err: '', timedOut: false };
  });
  const extractFood = createFoodExtractor({ model: 'sonnet' });
  const result = await extractFood({ text: '200g chicken breast' });
  assert.deepEqual(result.items, [ITEM]);
  const toolsIdx = seenArgs.indexOf('--tools');
  assert.equal(seenArgs[toolsIdx + 1], '');
  assert.ok(!seenArgs.includes('--restricted'));
});

test('photo input runs Read-only and restricted, cwd pinned to the image dir', async () => {
  let seenArgs = null;
  let seenOpts = null;
  _setRunner(async (args, input, timeoutMs, opts) => {
    seenArgs = args;
    seenOpts = opts;
    assert.match(input, /\/tmp\/wfl-test\/photo\.jpg/);
    return { code: 0, out: outer({ is_food: true, items: [ITEM] }), err: '', timedOut: false };
  });
  const extractFood = createFoodExtractor({ model: 'sonnet' });
  const imagePath = '/tmp/wfl-test/photo.jpg';
  const result = await extractFood({ imagePath });
  assert.deepEqual(result.items, [ITEM]);
  const toolsIdx = seenArgs.indexOf('--tools');
  assert.equal(seenArgs[toolsIdx + 1], 'Read');
  assert.ok(seenArgs.includes('--restricted'));
  assert.equal(seenOpts.cwd, path.dirname(imagePath));
});

test('non-food input comes back with is_food false and no items', async () => {
  _setRunner(async () => ({ code: 0, out: outer({ is_food: false, items: [] }), err: '', timedOut: false }));
  const extractFood = createFoodExtractor({ model: 'sonnet' });
  const result = await extractFood({ text: 'hey what\'s up' });
  assert.equal(result.is_food, false);
  assert.deepEqual(result.items, []);
});

test('an invalid shape from the CLI throws rather than silently logging garbage', async () => {
  _setRunner(async () => ({ code: 0, out: outer({ is_food: true, items: [{ name: 'rice' }] }), err: '', timedOut: false }));
  const extractFood = createFoodExtractor({ model: 'sonnet' });
  await assert.rejects(() => extractFood({ text: '150g rice' }), /invalid shape/);
});

test('a negative macro value from the CLI is rejected, not stored as a garbage entry', async () => {
  _setRunner(async () => ({ code: 0, out: outer({ is_food: true, items: [{ ...ITEM, kcal: -50 }] }), err: '', timedOut: false }));
  const extractFood = createFoodExtractor({ model: 'sonnet' });
  await assert.rejects(() => extractFood({ text: 'weird input' }), /invalid shape/);
});

test('an absurd exponent value that parses to Infinity is rejected, not stored as a garbage entry', async () => {
  // The CLI's own output is JSON, so a hallucinated huge literal (e.g. "1e400") survives
  // JSON syntax but overflows to Infinity on parse — build the raw string directly since
  // JSON.stringify(Infinity) would just silently serialize it back to null.
  const raw = '{"is_error":false,"result":"done","structured_output":{"is_food":true,"items":[' +
    '{"name":"mystery","grams":200,"kcal":1e400,"protein_g":1,"carbs_g":1,"fat_g":1,"confidence":0.5}]}}';
  _setRunner(async () => ({ code: 0, out: raw, err: '', timedOut: false }));
  const extractFood = createFoodExtractor({ model: 'sonnet' });
  await assert.rejects(() => extractFood({ text: 'mystery food' }), /invalid shape/);
});
