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

export function listTablePrefs(connectionId: string): Record<string, TablePrefs> {
  const rows = getDb().prepare("SELECT tableName, prefs FROM table_prefs WHERE connectionId = ?").all(connectionId) as PrefsRow[];
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

export function saveTablePrefs(connectionId: string, tableName: string, raw: unknown): TablePrefs {
  const prefs = sanitizeTablePrefs(raw);
  // Don't keep rows for tables back at their defaults.
  if (isEmptyPrefs(prefs)) {
    getDb().prepare("DELETE FROM table_prefs WHERE connectionId = ? AND tableName = ?").run(connectionId, tableName);
    return EMPTY_PREFS;
  }
  getDb()
    .prepare(
      `INSERT INTO table_prefs (connectionId, tableName, prefs, updatedAt) VALUES (?, ?, ?, ?)
       ON CONFLICT (connectionId, tableName) DO UPDATE SET prefs = excluded.prefs, updatedAt = excluded.updatedAt`
    )
    .run(connectionId, tableName, JSON.stringify(prefs), new Date().toISOString());
  return prefs;
}

export function replaceTablePrefs(connectionId: string, byTable: Record<string, unknown>): void {
  for (const [tableName, prefs] of Object.entries(byTable)) saveTablePrefs(connectionId, tableName, prefs);
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
