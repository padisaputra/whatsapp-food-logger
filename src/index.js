import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { seedClientsFromAllowedNumbers, listClients } from './clients.js';
import { CLAUDE_BIN } from './ai/claudeCli.js';
import { createFoodExtractor } from './ai/foodExtract.js';
import { startBot } from './whatsapp.js';

const config = loadConfig();
const db = createDb(path.join(config.dataDir, 'food.db'));

// ALLOWED_NUMBERS is only the bootstrap list — fold it into the clients table
// (idempotent) so every number from .env is a real client, then anyone added
// since (via a coach command or the dashboard) counts too.
seedClientsFromAllowedNumbers(db, config.allowedNumbers);

if (listClients(db).length === 0) {
  console.error('No clients configured. Run `npm run setup` or add at least one number in .env, or nobody can use the bot.');
  process.exit(1);
}
const claudeCheck = spawnSync(CLAUDE_BIN, ['--version']);
if (claudeCheck.error) {
  console.error('Could not find the Claude Code CLI. Install it and run `claude` once to log in, then try again — see README.md.');
  process.exit(1);
}

const extractFood = createFoodExtractor({ model: config.claudeModel, timeoutMs: config.claudeTimeoutMs });

console.log(`starting, timezone=${config.tz}, clients=${config.allowedNumbers.length}, model=${config.claudeModel}`);
startBot(config, { db, extractFood }).catch((e) => {
  console.error(`failed to start: ${String(e?.message || e).slice(0, 300)}`);
  process.exit(1);
});
