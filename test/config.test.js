import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

function baseEnv(overrides = {}) {
  return {
    ALLOWED_NUMBERS: '15550001111',
    ...overrides,
  };
}

test('loadConfig defaults to UTC when TZ is unset', () => {
  const config = loadConfig(baseEnv());
  assert.equal(config.tz, 'UTC');
});

test('loadConfig keeps a valid IANA TZ as given', () => {
  const config = loadConfig(baseEnv({ TZ: 'Asia/Jakarta' }));
  assert.equal(config.tz, 'Asia/Jakarta');
});

test('loadConfig falls back to UTC instead of poisoning every date lookup with a garbage TZ', () => {
  const config = loadConfig(baseEnv({ TZ: 'Not/AZone' }));
  assert.equal(config.tz, 'UTC');
});
