import { getDb } from "./metadata";
import type { JournalAction, JournalDetails, JournalEntry } from "../types";

export const DEFAULT_JOURNAL_RETENTION_DAYS = 90;
const RETENTION_KEY = "journalRetentionDays";

export function getJournalRetentionDays(): number {
  const row = getDb().prepare("SELECT value FROM app_settings WHERE key = ?").get(RETENTION_KEY) as { value: string } | undefined;
  const n = Number(row?.value);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_JOURNAL_RETENTION_DAYS;
}

export function setJournalRetentionDays(days: unknown): number {
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > 3650) throw new Error("La durée de conservation doit être un nombre de jours entre 1 et 3650");
  getDb()
    .prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .run(RETENTION_KEY, String(n));
  purgeJournal();
  return n;
}

function purgeJournal(): void {
  const cutoff = new Date(Date.now() - getJournalRetentionDays() * 86_400_000).toISOString();
  getDb().prepare("DELETE FROM journal WHERE at < ?").run(cutoff);
}

let lastPurge = 0;

export interface NewJournalEntry {
  connectionId: string;
  connectionName: string;
  envType: string;
  actor: string | null;
  ip: string | null;
  action: JournalAction;
  tableName: string | null;
  sql: string | null;
  rows: number | null;
  details: JournalDetails | null;
  error: string | null;
}

export function recordJournal(entry: NewJournalEntry): void {
  getDb()
    .prepare(
      `INSERT INTO journal (connectionId, connectionName, envType, at, actor, ip, action, tableName, sql, rows, details, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.connectionId,
      entry.connectionName,
      entry.envType,
      new Date().toISOString(),
      entry.actor,
      entry.ip,
      entry.action,
      entry.tableName,
      entry.sql,
      entry.rows,
      entry.details ? JSON.stringify(entry.details) : null,
      entry.error,
    );
  // Old entries go at most once an hour, not on every write.
  if (Date.now() - lastPurge > 3_600_000) {
    lastPurge = Date.now();
    purgeJournal();
  }
}

export interface JournalQuery {
  /** Omitted: every connection, including deleted ones. */
  connectionId?: string;
  tableName?: string;
  action?: string;
  /** ISO date-times, inclusive. */
  from?: string;
  to?: string;
  /** Matched against the SQL, table name and author. */
  search?: string;
  /** Entries older than this id (paging). */
  beforeId?: number;
  limit?: number;
}

interface JournalRow extends Omit<JournalEntry, "details"> {
  details: string | null;
}

export function listJournal(query: JournalQuery): JournalEntry[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.connectionId) {
    where.push("connectionId = ?");
    params.push(query.connectionId);
  }
  if (query.tableName) {
    where.push("tableName = ?");
    params.push(query.tableName);
  }
  if (query.action) {
    where.push("action = ?");
    params.push(query.action);
  }
  if (query.from) {
    where.push("at >= ?");
    params.push(query.from);
  }
  if (query.to) {
    where.push("at <= ?");
    params.push(query.to);
  }
  if (query.search) {
    where.push("(sql LIKE ? OR tableName LIKE ? OR actor LIKE ? OR connectionName LIKE ?)");
    const like = `%${query.search}%`;
    params.push(like, like, like, like);
  }
  if (query.beforeId) {
    where.push("id < ?");
    params.push(query.beforeId);
  }
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 5000);
  const rows = getDb()
    .prepare(`SELECT * FROM journal ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`)
    .all(...params, limit) as JournalRow[];
  return rows.map((r) => {
    let details: JournalDetails | null = null;
    try {
      details = r.details ? (JSON.parse(r.details) as JournalDetails) : null;
    } catch {
      // Keep the entry even if its details can't be read.
    }
    return { ...r, details };
  });
}
