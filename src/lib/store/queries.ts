import crypto from "node:crypto";
import { getDb } from "./metadata";
import type { QueryHistoryEntry, SavedQuery } from "../types";

// Enough to find "that query from last week" without the table growing forever.
const HISTORY_LIMIT_PER_CONNECTION = 200;

export function listSavedQueries(connectionId: string): SavedQuery[] {
  return getDb()
    .prepare("SELECT id, name, sql, createdAt, updatedAt FROM saved_queries WHERE connectionId = ? ORDER BY name COLLATE NOCASE")
    .all(connectionId) as SavedQuery[];
}

function checkQueryInput(name: unknown, sql: unknown): { name: string; sql: string } {
  if (typeof name !== "string" || !name.trim()) throw new Error("Nom de requête requis");
  if (typeof sql !== "string" || !sql.trim()) throw new Error("Requête vide");
  return { name: name.trim(), sql };
}

export function createSavedQuery(connectionId: string, rawName: unknown, rawSql: unknown): SavedQuery {
  const { name, sql } = checkQueryInput(rawName, rawSql);
  const now = new Date().toISOString();
  const query: SavedQuery = { id: crypto.randomUUID(), name, sql, createdAt: now, updatedAt: now };
  getDb()
    .prepare("INSERT INTO saved_queries (id, connectionId, name, sql, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
    .run(query.id, connectionId, name, sql, now, now);
  return query;
}

export function updateSavedQuery(connectionId: string, id: string, rawName: unknown, rawSql: unknown): SavedQuery | null {
  const { name, sql } = checkQueryInput(rawName, rawSql);
  const now = new Date().toISOString();
  const res = getDb()
    .prepare("UPDATE saved_queries SET name = ?, sql = ?, updatedAt = ? WHERE id = ? AND connectionId = ?")
    .run(name, sql, now, id, connectionId);
  if (res.changes === 0) return null;
  return getDb()
    .prepare("SELECT id, name, sql, createdAt, updatedAt FROM saved_queries WHERE id = ?")
    .get(id) as SavedQuery;
}

export function deleteSavedQuery(connectionId: string, id: string): boolean {
  return getDb().prepare("DELETE FROM saved_queries WHERE id = ? AND connectionId = ?").run(id, connectionId).changes > 0;
}

export function listQueryHistory(connectionId: string): QueryHistoryEntry[] {
  return getDb()
    .prepare("SELECT id, sql, ranAt, durationMs, rowCount, error FROM query_history WHERE connectionId = ? ORDER BY id DESC LIMIT ?")
    .all(connectionId, HISTORY_LIMIT_PER_CONNECTION) as QueryHistoryEntry[];
}

export function recordQuery(connectionId: string, entry: Omit<QueryHistoryEntry, "id" | "ranAt">): void {
  const db = getDb();
  db.transaction(() => {
    // Running the same query again moves it to the top instead of piling up duplicates.
    db.prepare("DELETE FROM query_history WHERE connectionId = ? AND sql = ?").run(connectionId, entry.sql);
    db.prepare("INSERT INTO query_history (connectionId, sql, ranAt, durationMs, rowCount, error) VALUES (?, ?, ?, ?, ?, ?)").run(
      connectionId,
      entry.sql,
      new Date().toISOString(),
      entry.durationMs,
      entry.rowCount,
      entry.error,
    );
    db.prepare(
      `DELETE FROM query_history WHERE connectionId = ? AND id NOT IN (
         SELECT id FROM query_history WHERE connectionId = ? ORDER BY id DESC LIMIT ?
       )`,
    ).run(connectionId, connectionId, HISTORY_LIMIT_PER_CONNECTION);
  })();
}
