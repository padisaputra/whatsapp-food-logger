#!/usr/bin/env node
// Re-pairs WhatsApp after a logout (or to move the bot to a new phone/number).
// Deletes the saved session and runs the same pairing-code flow as setup.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { normalizeNumber } from '../src/clients.js';
import { renderEnv } from './lib/wizardLogic.js';
import { linkWhatsApp } from './lib/link.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENV_PATH = path.join(ROOT, '.env');

async function askPairingNumber(rl, currentNumber) {
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  if (currentNumber) {
    const keep = (await ask(`Keep pairing as +${currentNumber}? [Y/n]\n> `)).trim().toLowerCase();
    if (keep !== 'n' && keep !== 'no') return currentNumber;
  }
  while (true) {
    const raw = await ask('This bot\'s own WhatsApp number — the one it will link as a device, digits only, country code, no "+"\n> ');
    const norm = normalizeNumber(raw);
    if (!norm.ok) { console.log(norm.reason); continue; }
    const confirm = (await ask(`Pairing with +${norm.digits} — correct? [Y/n]\n> `)).trim().toLowerCase();
    if (confirm === 'n' || confirm === 'no') continue;
    return norm.digits;
  }
}

async function main() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error('No .env found. Run `npm run setup` first.');
    process.exit(1);
  }

  const config = loadConfig();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  if (fs.existsSync(config.authDir)) {
    const answer = await new Promise((resolve) => {
      rl.question(`This deletes the saved WhatsApp session at ${config.authDir} and re-links from scratch. Continue? [y/N]\n> `, resolve);
    });
    if (!/^y(es)?$/i.test(answer.trim())) {
      rl.close();
      console.log('Cancelled.');
      process.exit(0);
    }
    fs.rmSync(config.authDir, { recursive: true, force: true });
  }

  const pairingNumber = await askPairingNumber(rl, config.pairingNumber);
  rl.close();

  if (pairingNumber !== config.pairingNumber) {
    fs.writeFileSync(ENV_PATH, renderEnv(fs.readFileSync(ENV_PATH, 'utf8'), { PAIRING_NUMBER: pairingNumber }));
  }
  process.env.PAIRING_NUMBER = pairingNumber;

  console.log('\nLinking WhatsApp — enter the pairing code below.\n');
  await linkWhatsApp();
}

main().catch((e) => {
  console.error('Relink failed:', e.message);
  process.exit(1);
});
