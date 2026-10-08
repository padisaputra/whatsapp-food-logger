import { createDb } from '../db.js';

// The dashboard now writes too (coach actions: add/remove/pause/resume
// client), so it opens the same way the bot does — read-write, WAL, creating
// the file if it doesn't exist yet. Safe to run concurrently with the bot:
// WAL supports multiple readers plus one writer across processes, and
// createDb sets a busy_timeout so a rare write-write collision waits briefly
// instead of throwing "database is locked".
export function openDashboardDb(filePath) {
  return createDb(filePath);
}

// Core worker may add columns (photo_path, meal_type) later. Check at query
// time rather than caching, since tests open multiple db schemas per process.
export function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

// Union of the clients table (the registry — includes clients with no entries
// yet) with entries/targets (older rows predating the clients table, or a
// removed client's retained history) so nothing silently disappears from the
// picker either way.
export function listClientIds(db) {
  return db
    .prepare(
      `SELECT DISTINCT client_id FROM (
        SELECT client_id FROM entries
        UNION
        SELECT client_id FROM targets
        UNION
        SELECT client_id FROM clients
      ) ORDER BY client_id`
    )
    .all()
    .map((r) => r.client_id);
}
