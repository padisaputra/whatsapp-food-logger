import test from 'node:test';
import assert from 'node:assert/strict';
import { runStructured, _setRunner, _resetRunner } from '../src/ai/claudeCli.js';

const SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };

function outer(fields) {
  return JSON.stringify({ is_error: false, result: 'done', ...fields });
}

test.afterEach(() => _resetRunner());

test('runStructured returns structured_output on a clean success', async () => {
  _setRunner(async () => ({ code: 0, out: outer({ structured_output: { ok: true } }), err: '', timedOut: false }));
  const { structured } = await runStructured({ prompt: 'hi', systemPrompt: 'sys', jsonSchema: SCHEMA, model: 'sonnet', tools: '' });
  assert.deepEqual(structured, { ok: true });
});

test('runStructured surfaces an AUTH error with a friendly prefix', async () => {
  _setRunner(async () => ({
    code: 1,
    out: JSON.stringify({ is_error: true, result: 'Invalid authentication provided' }),
    err: '',
    timedOut: false,
  }));
  await assert.rejects(
    () => runStructured({ prompt: 'hi', systemPrompt: 'sys', jsonSchema: SCHEMA, model: 'sonnet', tools: '' }),
    /logged out/,
  );
});

test('runStructured reports a timeout distinctly from other failures', async () => {
  _setRunner(async () => ({ code: null, out: '', err: '', timedOut: true }));
  await assert.rejects(
    () => runStructured({ prompt: 'hi', systemPrompt: 'sys', jsonSchema: SCHEMA, model: 'sonnet', tools: '' }),
    /TIMEOUT/,
  );
});

test('runStructured retries once on invalid JSON, then succeeds', async () => {
  let calls = 0;
  _setRunner(async (args, input) => {
    calls++;
    if (calls === 1) {
      assert.doesNotMatch(input, /previous response was not valid JSON/);
      return { code: 0, out: outer({ result: 'not json at all' }), err: '', timedOut: false };
    }
    assert.match(input, /previous response was not valid JSON/);
    return { code: 0, out: outer({ structured_output: { ok: true } }), err: '', timedOut: false };
  });
  const { structured } = await runStructured({ prompt: 'hi', systemPrompt: 'sys', jsonSchema: SCHEMA, model: 'sonnet', tools: '' });
  assert.deepEqual(structured, { ok: true });
  assert.equal(calls, 2);
});

test('runStructured gives up after exhausting the single retry', async () => {
  _setRunner(async () => ({ code: 0, out: outer({ result: 'still not json' }), err: '', timedOut: false }));
  await assert.rejects(
    () => runStructured({ prompt: 'hi', systemPrompt: 'sys', jsonSchema: SCHEMA, model: 'sonnet', tools: '' }),
    /did not return valid structured JSON/,
  );
});

test('runStructured passes cwd through to the runner for photo analysis', async () => {
  let seenOpts = null;
  _setRunner(async (args, input, timeoutMs, opts) => {
    seenOpts = opts;
    return { code: 0, out: outer({ structured_output: { ok: true } }), err: '', timedOut: false };
  });
  await runStructured({ prompt: 'look', systemPrompt: 'sys', jsonSchema: SCHEMA, model: 'sonnet', tools: 'Read', restricted: true, cwd: '/tmp/some-dir' });
  assert.equal(seenOpts.cwd, '/tmp/some-dir');
});
