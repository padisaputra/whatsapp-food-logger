import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidIanaTimeZone } from './dates.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadDotenv(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotenv(path.join(ROOT, '.env'));

function parseNumberList(value) {
  return String(value || '')
    .split(',')
    .map((n) => n.replace(/\D/g, ''))
    .filter(Boolean);
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env = process.env) {
  const allowedNumbers = parseNumberList(env.ALLOWED_NUMBERS);
  const coachNumber = (env.COACH_NUMBER || '').replace(/\D/g, '') || null;
  const dataDir = path.resolve(ROOT, env.DATA_DIR || './data');

  return {
    root: ROOT,
    claudeModel: env.CLAUDE_MODEL || 'sonnet',
    claudeTimeoutMs: numberOr(env.CLAUDE_TIMEOUT_MS, 90_000),
    allowedNumbers,
    coachNumber: coachNumber && allowedNumbers.includes(coachNumber) ? coachNumber : null,
    tz: isValidIanaTimeZone(env.TZ) ? env.TZ : 'UTC',
    authDir: path.resolve(ROOT, env.AUTH_DIR || './auth'),
    dataDir,
    photosDir: path.join(dataDir, 'photos'),
    pairingNumber: (env.PAIRING_NUMBER || '').replace(/\D/g, ''),
    rateLimitPerMinute: numberOr(env.RATE_LIMIT_PER_MINUTE, 20),
    defaultCountryCode: (env.DEFAULT_COUNTRY_CODE || '').replace(/\D/g, ''),
    defaultTargets: {
      kcal: numberOr(env.TARGET_KCAL, 2000),
      protein_g: numberOr(env.TARGET_PROTEIN_G, 150),
      carbs_g: numberOr(env.TARGET_CARBS_G, 200),
      fat_g: numberOr(env.TARGET_FAT_G, 65),
    },
  };
}
