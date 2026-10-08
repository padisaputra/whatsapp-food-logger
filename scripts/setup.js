#!/usr/bin/env node
// Interactive first-time setup: checks prerequisites, asks a few questions,
// writes .env, then links the bot's WhatsApp number.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeTargetsFromProfile, parseAllowedNumbers, renderEnv, isAuthError } from './lib/wizardLogic.js';
import { isValidIanaTimeZone } from '../src/dates.js';
import { CLAUDE_BIN } from '../src/ai/claudeCli.js';
import { linkWhatsApp } from './lib/link.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { addClient, seedClientsFromAllowedNumbers, normalizeNumber } from '../src/clients.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENV_PATH = path.join(ROOT, '.env');
const ENV_EXAMPLE_PATH = path.join(ROOT, '.env.example');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// Plain rl.question() chaining drops answers when more than one line is
// already sitting in the input buffer by the time a question resolves
// (e.g. a user pasting all their answers at once, or just typing ahead of
// the prompts) — rl.question() only ever listens for the single next 'line'
// event, so any lines that arrive before the following question() call is
// made are silently discarded. Queue every line as it arrives instead, so
// ask() always hands back answers in the order they were entered.
const lineQueue = [];
const waiters = [];
rl.on('line', (line) => {
  const waiter = waiters.shift();
  if (waiter) waiter(line);
  else lineQueue.push(line);
});
const ask = (q) => {
  rl.output.write(q);
  if (lineQueue.length) return Promise.resolve(lineQueue.shift());
  return new Promise((resolve) => waiters.push(resolve));
};

function checkNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) {
    console.error(`Node ${process.versions.node} found, but this bot needs Node 22 or newer (better-sqlite3's native binary requires it). Install a newer Node (nodejs.org) and run \`npm run setup\` again.`);
    process.exit(1);
  }
  console.log(`✓ Node ${process.versions.node}`);
}

function checkClaudeCli() {
  const probe = spawnSync(CLAUDE_BIN, [
    '-p', '--output-format', 'json', '--setting-sources', '', '--tools', '', '--permission-prompts', 'none', 'reply with the single word OK',
  ], { encoding: 'utf8', timeout: 30_000 });

  if (probe.error) {
    console.error('Could not find the Claude Code CLI (`claude`). Install it from https://claude.com/claude-code, then run `npm run setup` again.');
    process.exit(1);
  }

  let parsed = null;
  try { parsed = JSON.parse(probe.stdout); } catch {}

  if (probe.status !== 0 || !parsed || parsed.is_error) {
    const msg = (parsed && parsed.result) || probe.stderr || '';
    if (isAuthError(msg)) {
      console.error('The Claude Code CLI is installed but not logged in. Run `claude` in this terminal, follow the login prompt (needs a Claude Pro or Max subscription), then run `npm run setup` again.');
    } else {
      console.error(`The Claude Code CLI didn't respond as expected: ${String(msg).slice(0, 300)}`);
    }
    process.exit(1);
  }
  console.log('✓ Claude Code CLI installed and logged in');
}

async function askAllowedNumbers() {
  while (true) {
    const raw = await ask('WhatsApp number(s) allowed to use the bot — digits only, country code, no "+", comma-separated for multiple clients\n> ');
    const numbers = parseAllowedNumbers(raw);
    if (numbers.length === 0) { console.log('Enter at least one number.'); continue; }
    // Real WhatsApp numbers (E.164, country code + subscriber number) run 8-15
    // digits. Catches the easy mistake of pasting a local number without the
    // country code, or a stray extra/missing digit, before it goes in .env.
    const suspicious = numbers.filter((n) => n.length < 8 || n.length > 15);
    if (suspicious.length > 0) {
      const confirm = (await ask(`${suspicious.join(', ')} ${suspicious.length > 1 ? "don't" : "doesn't"} look like a full number with country code (expected 8-15 digits). Use ${suspicious.length > 1 ? 'them' : 'it'} anyway? [y/N]\n> `)).trim().toLowerCase();
      if (confirm !== 'y' && confirm !== 'yes') continue;
    }
    return numbers;
  }
}

async function askTimezone() {
  const guess = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  while (true) {
    const raw = await ask(`Timezone for day boundaries, IANA format (e.g. America/New_York) [${guess}]\n> `);
    const tz = raw.trim() || guess;
    if (isValidIanaTimeZone(tz)) return tz;
    console.log(`"${tz}" isn't a recognized timezone. Try something like "Asia/Bangkok" or "Europe/London".`);
  }
}

async function askCoachNumber(numbers) {
  if (numbers.length < 2) return '';
  const on = (await ask('Multiple numbers detected. Enable coach mode (one admin number sees everyone\'s daily totals)? [y/N]\n> ')).trim().toLowerCase();
  if (on !== 'y' && on !== 'yes') return '';
  const raw = await ask(`Which number is the coach/admin? [${numbers[0]}]\n> `);
  const coach = raw.trim().replace(/\D/g, '') || numbers[0];
  return numbers.includes(coach) ? coach : numbers[0];
}

async function offerInitialClients(coachNumber, db, defaultCountryCode) {
  if (!coachNumber) return;
  const on = (await ask('Coach mode is on. Add your first client(s) now by WhatsApp number? [y/N]\n> ')).trim().toLowerCase();
  if (on !== 'y' && on !== 'yes') return;

  while (true) {
    const raw = (await ask('Client WhatsApp number — digits only, country code, no "+" (blank to finish)\n> ')).trim();
    if (!raw) return;
    const norm = normalizeNumber(raw, defaultCountryCode);
    if (!norm.ok) { console.log(norm.reason); continue; }
    const name = (await ask('Client name (optional)\n> ')).trim() || null;
    const result = addClient(db, { clientId: norm.digits, name });
    if (result.error === 'duplicate') { console.log('already added.'); continue; }
    console.log(`✓ added ${name || norm.digits} (${norm.digits})`);
  }
}

async function askPairingNumber() {
  while (true) {
    const raw = await ask('This bot\'s own WhatsApp number — the one it will link as a device (use a spare number, not your main one), digits only, country code, no "+"\n> ');
    const norm = normalizeNumber(raw);
    if (!norm.ok) { console.log(norm.reason); continue; }
    const confirm = (await ask(`Pairing with +${norm.digits} — correct? [Y/n]\n> `)).trim().toLowerCase();
    if (confirm === 'n' || confirm === 'no') continue;
    return norm.digits;
  }
}

async function askTargets() {
  const mode = (await ask('Daily targets — enter them directly, or compute from a profile (weight/height/age/goal)? [direct/compute] (direct)\n> ')).trim().toLowerCase();
  if (mode.startsWith('c')) {
    const weightKg = Number(await ask('Weight (kg)\n> '));
    const heightCm = Number(await ask('Height (cm)\n> '));
    const age = Number(await ask('Age\n> '));
    const sex = (await ask('Sex, for the BMR formula [male/female]\n> ')).trim().toLowerCase().startsWith('f') ? 'female' : 'male';
    const activity = (await ask('Activity level [sedentary/light/moderate/active/very_active] (moderate)\n> ')).trim().toLowerCase() || 'moderate';
    const goal = (await ask('Goal [cut/maintain/bulk] (maintain)\n> ')).trim().toLowerCase() || 'maintain';
    if ([weightKg, heightCm, age].some((n) => !Number.isFinite(n) || n <= 0)) {
      console.log('That profile didn\'t look right — falling back to defaults (2000 kcal).');
      return { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 65 };
    }
    const targets = computeTargetsFromProfile({ weightKg, heightCm, age, sex, activity, goal });
    console.log(`Computed targets: ${targets.kcal} kcal · P${targets.protein_g} C${targets.carbs_g} F${targets.fat_g}`);
    return targets;
  }

  const kcal = await askPositiveNumber('Daily kcal target (2000)\n> ', 2000);
  const protein_g = await askPositiveNumber('Daily protein target, g (150)\n> ', 150);
  const carbs_g = await askPositiveNumber('Daily carbs target, g (200)\n> ', 200);
  const fat_g = await askPositiveNumber('Daily fat target, g (65)\n> ', 65);
  return { kcal, protein_g, carbs_g, fat_g };
}

// Re-prompts on anything that isn't blank (use the shown default) or a positive
// number — typos used to silently become NaN/0 and then get quietly swapped for
// the hardcoded 2000/150/200/65 fallback deep in config.js, with no warning.
async function askPositiveNumber(question, fallback) {
  while (true) {
    const raw = (await ask(question)).trim();
    if (!raw) return fallback;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
    console.log(`"${raw}" isn't a positive number. Enter a number, or leave blank for ${fallback}.`);
  }
}

async function main() {
  console.log('whatsapp-food-logger setup\n');
  checkNodeVersion();
  checkClaudeCli();

  const allowedNumbers = await askAllowedNumbers();
  const tz = await askTimezone();
  const coachNumber = await askCoachNumber(allowedNumbers);
  const targets = await askTargets();
  const pairingNumber = await askPairingNumber();

  const template = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');
  const rendered = renderEnv(template, {
    ALLOWED_NUMBERS: allowedNumbers.join(','),
    COACH_NUMBER: coachNumber,
    TZ: tz,
    TARGET_KCAL: targets.kcal,
    TARGET_PROTEIN_G: targets.protein_g,
    TARGET_CARBS_G: targets.carbs_g,
    TARGET_FAT_G: targets.fat_g,
    PAIRING_NUMBER: pairingNumber,
  });
  fs.writeFileSync(ENV_PATH, rendered);
  console.log(`\n✓ wrote ${ENV_PATH}`);

  // config.js reads .env once, at import time — which already happened before this
  // file existed. Mirror the choices straight into process.env so this same run of
  // the wizard links with them, instead of requiring a second invocation.
  process.env.ALLOWED_NUMBERS = allowedNumbers.join(',');
  process.env.COACH_NUMBER = coachNumber;
  process.env.TZ = tz;
  process.env.TARGET_KCAL = String(targets.kcal);
  process.env.TARGET_PROTEIN_G = String(targets.protein_g);
  process.env.TARGET_CARBS_G = String(targets.carbs_g);
  process.env.TARGET_FAT_G = String(targets.fat_g);
  process.env.PAIRING_NUMBER = pairingNumber;

  const config = loadConfig(process.env);
  const db = createDb(path.join(config.dataDir, 'food.db'));
  seedClientsFromAllowedNumbers(db, allowedNumbers);
  await offerInitialClients(coachNumber, db, config.defaultCountryCode);

  rl.close();
  console.log('\nNow let\'s link your WhatsApp number.\n');
  await linkWhatsApp();
}

main().catch((e) => {
  console.error('Setup failed:', e.message);
  process.exit(1);
});
