import { getDb } from "./metadata";
import {
  EMPTY_CONNECTION_PREFS,
  EMPTY_PREFS,
  isEmptyConnectionPrefs,
  isEmptyPrefs,
  sanitizeConnectionPrefs,
  sanitizeTablePrefs,
  type ConnectionPrefs,
  type TablePrefs,
} from "../prefs";

interface PrefsRow {
  tableName: string;
  prefs: string;
}

// Connections filed under the same folder (say prod, staging and local of one app)
// share their table preferences: a table looks the same whichever of them it is opened from.
function prefsPeers(connectionId: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT id FROM connections
       WHERE folder IS NOT NULL AND folder <> '' AND folder = (SELECT folder FROM connections WHERE id = ?)`
    )
    .all(connectionId) as { id: string }[];
  const ids = rows.map((r) => r.id);
  return ids.includes(connectionId) ? ids : [connectionId];
}

export function listTablePrefs(connectionId: string): Record<string, TablePrefs> {
  const peers = prefsPeers(connectionId);
  // Oldest first, so the latest change wins; on a tie the connection's own row does.
  const rows = getDb()
    .prepare(
      `SELECT tableName, prefs FROM table_prefs WHERE connectionId IN (${peers.map(() => "?").join(", ")})
       ORDER BY updatedAt, connectionId = ?`
    )
    .all(...peers, connectionId) as PrefsRow[];
  const out: Record<string, TablePrefs> = {};
  for (const row of rows) {
    try {
      out[row.tableName] = sanitizeTablePrefs(JSON.parse(row.prefs));
    } catch {
      // A corrupted row shouldn't take the whole table list down.
    }
  }
  return out;
}

function writeTablePrefs(connectionIds: string[], tableName: string, raw: unknown, updatedAt: string): TablePrefs {
  const prefs = sanitizeTablePrefs(raw);
  const db = getDb();
  // Don't keep rows for tables back at their defaults.
  const empty = isEmptyPrefs(prefs);
  const remove = db.prepare("DELETE FROM table_prefs WHERE connectionId = ? AND tableName = ?");
  const upsert = db.prepare(
    `INSERT INTO table_prefs (connectionId, tableName, prefs, updatedAt) VALUES (?, ?, ?, ?)
     ON CONFLICT (connectionId, tableName) DO UPDATE SET prefs = excluded.prefs, updatedAt = excluded.updatedAt`
  );
  const json = JSON.stringify(prefs);
  db.transaction(() => {
    for (const id of connectionIds) {
      if (empty) remove.run(id, tableName);
      else upsert.run(id, tableName, json, updatedAt);
    }
  })();
  return empty ? EMPTY_PREFS : prefs;
}

/** Saves a table's preferences for the connection and the others in its folder. */
export function saveTablePrefs(connectionId: string, tableName: string, raw: unknown): TablePrefs {
  return writeTablePrefs(prefsPeers(connectionId), tableName, raw, new Date().toISOString());
}

/** Restores imported preferences. They stay with that connection and, dated as old, give way
 *  to what the other connections of its folder already share. */
export function replaceTablePrefs(connectionId: string, byTable: Record<string, unknown>): void {
  for (const [tableName, prefs] of Object.entries(byTable)) writeTablePrefs([connectionId], tableName, prefs, new Date(0).toISOString());
}

export function getConnectionPrefs(connectionId: string): ConnectionPrefs {
  const row = getDb().prepare("SELECT prefs FROM connection_prefs WHERE connectionId = ?").get(connectionId) as { prefs: string } | undefined;
  if (!row) return EMPTY_CONNECTION_PREFS;
  try {
    return sanitizeConnectionPrefs(JSON.parse(row.prefs));
  } catch {
    return EMPTY_CONNECTION_PREFS;
  }
}

export function saveConnectionPrefs(connectionId: string, raw: unknown): ConnectionPrefs {
  const prefs = sanitizeConnectionPrefs(raw);
  if (isEmptyConnectionPrefs(prefs)) {
    getDb().prepare("DELETE FROM connection_prefs WHERE connectionId = ?").run(connectionId);
    return EMPTY_CONNECTION_PREFS;
  }
  getDb()
    .prepare(
      `INSERT INTO connection_prefs (connectionId, prefs, updatedAt) VALUES (?, ?, ?)
       ON CONFLICT (connectionId) DO UPDATE SET prefs = excluded.prefs, updatedAt = excluded.updatedAt`
    )
    .run(connectionId, JSON.stringify(prefs), new Date().toISOString());
  return prefs;
}
