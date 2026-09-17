import { getConnection } from "../store/metadata";
import { recordJournal } from "../store/journal";
import { getAdapter } from "../db/registry";
import { formatStatements, sqlLiteral } from "../db/adapter";
import type { JournalAction, JournalDetails, Row, WriteOp } from "../types";

// Before/after values are kept for undo, but a huge bulk change shouldn't bloat the journal.
const MAX_DETAIL_ROWS = 500;
const MAX_SQL_LENGTH = 20_000;

export interface JournalInfo {
  action: JournalAction;
  tableName?: string | null;
  sql?: string | null;
  details?: JournalDetails | null;
}

function actorOf(request: Request): { actor: string | null; ip: string | null } {
  const raw = request.headers.get("x-overlook-user");
  let actor: string | null = null;
  if (raw) {
    try {
      actor = decodeURIComponent(raw).trim().slice(0, 100) || null;
    } catch {
      actor = null;
    }
  }
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { actor, ip: forwarded || request.headers.get("x-real-ip") || null };
}

function clip(sql: string | null | undefined): string | null {
  if (!sql) return null;
  return sql.length > MAX_SQL_LENGTH ? `${sql.slice(0, MAX_SQL_LENGTH)}\n-- …` : sql;
}

export function limitRows(rows: Row[] | undefined): { rows?: Row[]; truncated: boolean } {
  if (!rows) return { truncated: false };
  return rows.length > MAX_DETAIL_ROWS ? { rows: rows.slice(0, MAX_DETAIL_ROWS), truncated: true } : { rows, truncated: false };
}

/** Records a write that ran outside `journaled` (e.g. a streamed script). */
export function recordWrite(request: Request, connectionId: string, info: JournalInfo, rows: number | null, error: string | null): void {
  const conn = getConnection(connectionId);
  if (!conn) return;
  try {
    recordJournal({
      connectionId,
      connectionName: conn.name,
      envType: conn.envType,
      ...actorOf(request),
      action: info.action,
      tableName: info.tableName ?? null,
      sql: clip(info.sql),
      rows,
      details: info.details ?? null,
      error,
    });
  } catch {
    // Best effort, like `journaled`.
  }
}

/**
 * Runs a write and records it in the journal, whether it succeeds or fails.
 * `rowsOf` turns the result into the number of rows it changed.
 */
export async function journaled<T>(
  request: Request,
  connectionId: string,
  info: JournalInfo | (() => Promise<JournalInfo>),
  run: () => Promise<T>,
  rowsOf: (result: T) => number | null = () => null,
  /** Details only known once the write ran (e.g. an inserted row's generated key). */
  detailsOf?: (result: T) => Promise<JournalDetails | null>,
): Promise<T> {
  const conn = getConnection(connectionId);
  // Describing the change must never block it.
  let described: JournalInfo | null = null;
  try {
    described = typeof info === "function" ? await info() : info;
  } catch {
    described = null;
  }
  const record = (rows: number | null, error: string | null, extra?: JournalDetails | null) => {
    if (!conn || !described) return;
    try {
      recordJournal({
        connectionId,
        connectionName: conn.name,
        envType: conn.envType,
        ...actorOf(request),
        action: described.action,
        tableName: described.tableName ?? null,
        sql: clip(described.sql),
        rows,
        details: extra ?? described.details ?? null,
        error,
      });
    } catch {
      // The journal is best effort: a failure to write it doesn't undo the change.
    }
  };
  try {
    const result = await run();
    let extra: JournalDetails | null = null;
    if (detailsOf) {
      try {
        extra = await detailsOf(result);
      } catch {
        extra = null;
      }
    }
    record(rowsOf(result), null, extra);
    return result;
  } catch (err) {
    record(null, err instanceof Error ? err.message || String(err) : String(err));
    throw err;
  }
}

/** The SQL a WriteOp runs, formatted like the preview. */
export async function describeOp(connectionId: string, op: WriteOp): Promise<string> {
  const adapter = getAdapter(connectionId);
  const statements = await adapter.buildWrite(op);
  const engine = getConnection(connectionId)?.engine;
  return formatStatements(statements, engine === "postgres" ? "dollar" : "question");
}

export function describeInsert(table: string, row: Row): string {
  const cols = Object.keys(row);
  return `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => sqlLiteral(row[c])).join(", ")});`;
}

/** Current values of the given rows, restricted to `columns` (plus the key), for undo. */
export async function beforeRows(connectionId: string, table: string, pkColumn: string, pkValues: unknown[], columns?: string[]): Promise<JournalDetails> {
  const limited = pkValues.slice(0, MAX_DETAIL_ROWS);
  const rows = await getAdapter(connectionId).selectRowsByPk(table, pkColumn, limited);
  const picked = columns ? rows.map((r) => Object.fromEntries([pkColumn, ...columns].filter((c) => c in r).map((c) => [c, r[c]]))) : rows;
  return { pkColumn, before: picked, truncated: pkValues.length > limited.length || undefined };
}
