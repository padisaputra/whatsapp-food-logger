import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  name TEXT NOT NULL,
  grams REAL,
  kcal REAL NOT NULL,
  protein_g REAL NOT NULL,
  carbs_g REAL NOT NULL,
  fat_g REAL NOT NULL,
  confidence REAL,
  source TEXT NOT NULL DEFAULT 'text',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_client_date ON entries (client_id, date);

CREATE TABLE IF NOT EXISTS targets (
  client_id TEXT PRIMARY KEY,
  kcal REAL NOT NULL,
  protein_g REAL NOT NULL,
  carbs_g REAL NOT NULL,
  fat_g REAL NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_messages (
  message_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  client_id TEXT PRIMARY KEY,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

// Added after the initial release — guarded so opening an older food.db doesn't break.
const MIGRATIONS = [
  { table: 'entries', column: 'meal_type', ddl: 'ALTER TABLE entries ADD COLUMN meal_type TEXT' },
  { table: 'entries', column: 'photo_path', ddl: 'ALTER TABLE entries ADD COLUMN photo_path TEXT' },
];

function runMigrations(db) {
  for (const { table, column, ddl } of MIGRATIONS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!columns.includes(column)) db.exec(ddl);
  }
}

export function createDb(filePath) {
  if (filePath !== ':memory:') fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  if (filePath !== ':memory:') db.pragma('journal_mode = WAL');
  // The bot and the dashboard are now two separate processes that can both write
  // (dashboard: add/remove/pause client). WAL allows concurrent read+write, but a
  // write landing mid-transaction from the other process would otherwise throw
  // "database is locked" immediately instead of waiting a moment for the lock.
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  runMigrations(db);
  return db;
}

// WhatsApp (Baileys) can redeliver the same message after a reconnect. Call wasProcessed
// first; if false, the caller handles the message and markProcessed is called once done.
export function wasProcessed(db, messageId) {
  return Boolean(db.prepare('SELECT 1 FROM processed_messages WHERE message_id = ?').get(messageId));
}

export function markProcessed(db, messageId) {
  db.prepare('INSERT OR IGNORE INTO processed_messages (message_id, created_at) VALUES (?, ?)')
    .run(messageId, new Date().toISOString());
}

export function pruneProcessed(db, olderThanDays = 7) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM processed_messages WHERE created_at < ?').run(cutoff);
}
