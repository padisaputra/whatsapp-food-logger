// Shared "show a pairing code and wait for WhatsApp to connect" flow, used by
// both `npm run setup` (first link) and `npm run relink` (re-pairing).
import path from 'node:path';
import { loadConfig } from '../../src/config.js';
import { createDb } from '../../src/db.js';
import { startBot } from '../../src/whatsapp.js';

// WhatsApp pairing codes are valid for about 60 seconds — verified live against
// WhatsApp's own servers, not guessed. Request a fresh one automatically once a
// code is old enough that it has almost certainly expired, instead of leaving
// the person stuck entering a dead code.
const CODE_VALID_MS = 55_000;

function printPairingCode(code) {
  const bar = '='.repeat(44);
  console.log(`\n${bar}`);
  console.log(`   PAIRING CODE:  ${code}`);
  console.log(bar);
  console.log('\nOn the phone with this WhatsApp number:');
  console.log('  1. Open WhatsApp');
  console.log('  2. Settings -> Linked Devices -> Link a Device');
  console.log('  3. Tap "Link with phone number instead"');
  console.log(`  4. Enter the code above\n`);
  console.log('Valid for about a minute. If it expires, a fresh code prints automatically.\n');
}

export async function linkWhatsApp() {
  const config = loadConfig();
  const db = createDb(path.join(config.dataDir, 'food.db'));

  return new Promise((resolve) => {
    let expiryTimer = null;

    startBot(config, {
      db,
      extractFood: null, // no AI needed just to pair — messages during linking get a harmless fallback reply
      onPairingCode: (code, requestNew, err) => {
        if (expiryTimer) clearTimeout(expiryTimer);
        if (!code) {
          console.error(`\nCouldn't get a pairing code: ${err?.message || String(err)}`);
          console.error('Double-check PAIRING_NUMBER in .env is a real WhatsApp number, then run this again.\n');
          return;
        }
        printPairingCode(code);
        expiryTimer = setTimeout(() => {
          console.log("That code has likely expired — requesting a new one...");
          requestNew();
        }, CODE_VALID_MS);
      },
      onOpen: (sock) => {
        if (expiryTimer) clearTimeout(expiryTimer);
        console.log(`\n✓ Linked as ${sock.user?.id || 'this device'}.`);
        console.log('Run `npm start` (see README for pm2/launchd so it stays running 24/7).\n');
        setTimeout(() => { resolve(); process.exit(0); }, 1000);
      },
    });
  });
}
