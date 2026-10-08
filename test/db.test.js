import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createDb, wasProcessed, markProcessed, pruneProcessed } from '../src/db.js';

test('markProcessed then wasProcessed reports a message as seen, dedupe survives re-insert', () => {
  const db = createDb(':memory:');
  assert.equal(wasProcessed(db, 'ABC123'), false);
  markProcessed(db, 'ABC123');
  assert.equal(wasProcessed(db, 'ABC123'), true);
  markProcessed(db, 'ABC123'); // redelivery of the same id must not throw
  assert.equal(wasProcessed(db, 'ABC123'), true);
});

test('pruneProcessed removes only entries older than the cutoff', () => {
  const db = createDb(':memory:');
  db.prepare('INSERT INTO processed_messages (message_id, created_at) VALUES (?, ?)')
    .run('old', new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString());
  markProcessed(db, 'recent');
  pruneProcessed(db, 7);
  assert.equal(wasProcessed(db, 'old'), false);
  assert.equal(wasProcessed(db, 'recent'), true);
});

test('createDb migrates an older entries table (no meal_type/photo_path) without touching existing rows', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wfl-db-')), 'food.db');
  const old = new Database(file);
  old.exec(`
    CREATE TABLE entries (
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
  `);
  old.prepare(`
    INSERT INTO entries (client_id, date, time, name, kcal, protein_g, carbs_g, fat_g, created_at)
    VALUES ('alex', '2026-10-08', '12:00', 'rice', 195, 4, 42, 0.5, '2026-10-08T12:00:00.000Z')
  `).run();
  old.close();

  const db = createDb(file);
  const columns = db.prepare('PRAGMA table_info(entries)').all().map((c) => c.name);
  assert.ok(columns.includes('meal_type'));
  assert.ok(columns.includes('photo_path'));
  const row = db.prepare('SELECT * FROM entries WHERE name = ?').get('rice');
  assert.equal(row.kcal, 195);
  assert.equal(row.meal_type, null);
});
