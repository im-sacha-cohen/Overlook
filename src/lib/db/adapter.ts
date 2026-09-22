import type { AggregateFn, ColumnMeta, LogicalType, QueryResult, Row, RowQuery, RowSort, TableMeta, WriteOp, WritePreview } from "../types";

export type { WriteOp, WritePreview };
import type { DistinctValue } from "./where";

export interface SelectOptions extends RowQuery {
  sorts?: RowSort[];
  limit?: number;
  offset?: number;
}

/**
 * One connection kept for a whole SQL script, so the SET, BEGIN… a dump starts
 * with still apply to the statements that follow them.
 */
export interface ScriptSession {
  run(sql: string): Promise<void>;
  /**
   * Runs statements in order and says, for each, the error it hit (null when it ran).
   * INSERT/UPDATE/DELETE go several per round trip, which is what counts on a remote
   * database. Throws when the script can't go on (connection lost, batch rolled back).
   */
  runMany(statements: string[]): Promise<unknown[]>;
  /** Commits what the session itself batched and lets go of the connection. */
  close(): Promise<void>;
}

/** The session's connection is gone: the statements after this one can't run either. */
export class ScriptSessionLost extends Error {
  /** `unsaved`: statements of the batch not yet committed, lost with the connection. */
  constructor(cause: unknown, unsaved = 0) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Connexion à la base perdue : ${reason}${unsaved > 0 ? ` (les ${unsaved} dernière(s) instruction(s), pas encore enregistrées, sont perdues)` : ""}`);
  }
}

/**
 * A script's statements are committed in batches: one commit per statement
 * costs a disk sync each, which makes a dump of single-row INSERTs crawl.
 * A batch ends after this many statements or this long, whichever comes first.
 */
export const SCRIPT_BATCH_SIZE = 2000;
export const SCRIPT_BATCH_MS = 2000;

/** Statements sent in one round trip, at most, and their total length. */
const SCRIPT_GROUP_SIZE = 200;
const SCRIPT_GROUP_CHARS = 1_000_000;
const GROUPABLE = new Set(["INSERT", "UPDATE", "DELETE", "REPLACE"]);

/**
 * Cuts statements into runs to send together (plain row changes, which neither
 * commit nor change the transaction) and statements to send alone.
 */
export function groupStatements(statements: string[], keywordOf: (sql: string) => string): { start: number; end: number; together: boolean }[] {
  const runs: { start: number; end: number; together: boolean }[] = [];
  let i = 0;
  while (i < statements.length) {
    if (!GROUPABLE.has(keywordOf(statements[i]))) {
      runs.push({ start: i, end: i + 1, together: false });
      i++;
      continue;
    }
    let j = i;
    let chars = 0;
    while (j < statements.length && j - i < SCRIPT_GROUP_SIZE && GROUPABLE.has(keywordOf(statements[j])) && (j === i || chars + statements[j].length <= SCRIPT_GROUP_CHARS)) {
      chars += statements[j].length;
      j++;
    }
    runs.push({ start: i, end: j, together: j - i > 1 });
    i = j;
  }
  return runs;
}

/** runMany for a session with no faster way: one statement after the other. */
export async function runOneByOne(session: Pick<ScriptSession, "run">, statements: string[]): Promise<unknown[]> {
  const results: unknown[] = [];
  for (const sql of statements) {
    try {
      await session.run(sql);
      results.push(null);
    } catch (err) {
      if (err instanceof ScriptSessionLost) throw err;
      results.push(err);
    }
  }
  return results;
}

export interface SqlStatement {
  sql: string;
  params: unknown[];
}

export interface DatabaseAdapter {
  /** The statements a write would run, without running them. */
  buildWrite(op: WriteOp): Promise<SqlStatement[]>;
  previewWrite(op: WriteOp): Promise<WritePreview>;
  /** The rows whose primary key is in the list (for the journal's "before" values). */
  selectRowsByPk(table: string, pkColumn: string, pkValues: unknown[]): Promise<Row[]>;
  testConnection(): Promise<void>;
  listTables(): Promise<TableMeta[]>;
  getTable(table: string): Promise<TableMeta>;
  createTable(table: string, columns: { name: string; type: LogicalType }[]): Promise<void>;
  selectRows(table: string, opts: SelectOptions): Promise<{ rows: Row[]; total: number }>;
  /** Values of a column for filter suggestions; see buildDistinctValues for via/within. */
  distinctValues(table: string, column: string, query?: string, options?: { via?: string[]; within?: RowQuery }): Promise<DistinctValue[]>;
  /** Summaries of columns over the rows a query keeps, keyed "column:fn". */
  aggregate(table: string, query: RowQuery, specs: { column: string; fn: AggregateFn }[]): Promise<Record<string, string | number | null>>;
  insertRow(table: string, values: Row): Promise<Row>;
  updateRow(table: string, pkColumn: string, pkValue: unknown, values: Row): Promise<void>;
  updateRows(table: string, pkColumn: string, pkValues: unknown[], values: Row): Promise<number>;
  deleteRow(table: string, pkColumn: string, pkValue: unknown): Promise<void>;
  deleteRows(table: string, pkColumn: string, pkValues: unknown[]): Promise<number>;
  addColumn(table: string, name: string, type: LogicalType): Promise<void>;
  renameColumn(table: string, oldName: string, newName: string): Promise<void>;
  changeColumnType(table: string, column: string, type: LogicalType): Promise<void>;
  dropColumn(table: string, column: string): Promise<void>;
  /**
   * Drops the tables in one go, so foreign keys between them don't depend on order.
   * `ignoreForeignKeys` lets tables referenced from elsewhere go too: MySQL and
   * SQLite switch the checks off for the drop, PostgreSQL uses CASCADE (which also
   * removes the referencing constraints and dependent views).
   */
  dropTables(tables: string[], options?: DropTablesOptions): Promise<void>;
  bulkInsert(table: string, rows: Row[]): Promise<number>;
  /**
   * Runs one query from the SQL console. With `readOnly`, the database itself
   * refuses any write (read-only transaction or session) and more than one
   * statement is refused; both throw a ReadOnlyViolation.
   */
  runRawQuery(sql: string, options?: { readOnly?: boolean }): Promise<QueryResult>;
  runStatement(sql: string): Promise<void>;
  openScriptSession(): Promise<ScriptSession>;
  close(): Promise<void>;
}

export interface DropTablesOptions {
  ignoreForeignKeys?: boolean;
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertValidIdentifier(name: string): void {
  if (!IDENT_RE.test(name)) {
    throw new Error(`Invalid identifier: ${JSON.stringify(name)}`);
  }
}

export function assertKnownTable(meta: TableMeta, name: string): void {
  if (meta.name !== name) throw new Error(`Unknown table: ${JSON.stringify(name)}`);
}

export function assertKnownColumn(meta: TableMeta, name: string): ColumnMeta {
  const col = meta.columns.find((c) => c.name === name);
  if (!col) throw new Error(`Unknown column: ${JSON.stringify(name)}`);
  return col;
}

export function primaryKeyOf(meta: TableMeta): ColumnMeta | null {
  return meta.columns.find((c) => c.isPrimaryKey) ?? null;
}

/**
 * Empty strings coming from the grid mean "no value", but MySQL (and Postgres)
 * reject '' for datetime/number/json columns. Turn them into NULL so the row
 * insert/update reaches the database in a shape it accepts.
 */
export function coerceRowValues(meta: TableMeta, values: Row): Row {
  const out: Row = {};
  for (const [name, value] of Object.entries(values)) {
    const col = meta.columns.find((c) => c.name === name);
    out[name] =
      col && value === "" && col.logicalType !== "text" && col.logicalType !== "select"
        ? null
        : // A JSON value read back (a copied row) arrives parsed; drivers can't bind an object or array.
          col?.logicalType === "json" && value !== null && typeof value === "object" && !(value instanceof Date)
          ? JSON.stringify(value)
          : value;
  }
  return out;
}

export interface LiteralOptions {
  /** Keep long values whole, for SQL meant to be run rather than read. */
  full?: boolean;
  /** MySQL reads a backslash in a string as an escape: double it to keep it. */
  backslashEscapes?: boolean;
}

export function sqlLiteral(value: unknown, { full = false, backslashEscapes = false }: LiteralOptions = {}): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  const shown = !full && text.length > 200 ? `${text.slice(0, 200)}…` : text;
  const escaped = backslashEscapes ? shown.replace(/\\/g, "\\\\") : shown;
  return `'${escaped.replace(/'/g, "''")}'`;
}

/**
 * Inlines parameters into a statement, for display only: `?` placeholders
 * (MySQL, SQLite) or `$n` ones (PostgreSQL). Placeholders inside quoted
 * identifiers can't occur since identifiers are validated.
 */
export function inlineParams(statement: SqlStatement, style: "question" | "dollar", options?: LiteralOptions): string {
  if (statement.params.length === 0) return statement.sql;
  const literal = (value: unknown) => sqlLiteral(value, options);
  if (style === "dollar") return statement.sql.replace(/\$(\d+)/g, (m, n) => (Number(n) <= statement.params.length ? literal(statement.params[Number(n) - 1]) : m));
  let i = 0;
  return statement.sql.replace(/\?/g, (m) => (i < statement.params.length ? literal(statement.params[i++]) : m));
}

export function formatStatements(statements: SqlStatement[], style: "question" | "dollar", options?: LiteralOptions): string {
  return statements.map((st) => `${inlineParams(st, style, options)};`).join("\n");
}

/** Shared by the adapters: build the statements, then say how many rows they concern. */
export async function previewWithAdapter(
  adapter: DatabaseAdapter,
  op: WriteOp,
  style: "question" | "dollar",
  countByPk: (table: string, pkColumn: string, pkValues: unknown[]) => Promise<number>,
  { backslashEscapes = false }: { backslashEscapes?: boolean } = {},
): Promise<WritePreview> {
  const statements = await adapter.buildWrite(op);
  let rows: number | null = null;
  if (op.kind === "updateRows" || op.kind === "deleteRows") {
    rows = op.pkValues.length === 0 ? 0 : await countByPk(op.table, op.pkColumn, op.pkValues);
  } else if (op.kind === "changeColumnType" || op.kind === "dropColumn") {
    rows = (await adapter.getTable(op.table)).rowCount ?? null;
  } else if (op.kind === "dropTables") {
    const metas = await Promise.all(op.tables.map((t) => adapter.getTable(t)));
    rows = metas.reduce((sum, m) => sum + (m.rowCount ?? 0), 0);
  }
  return { sql: formatStatements(statements, style), script: formatStatements(statements, style, { full: true, backslashEscapes }), rows };
}

export function assertCreatableType(type: LogicalType): asserts type is Exclude<LogicalType, "relation" | "unknown"> {
  if (type === "relation" || type === "unknown") throw new Error(`Cannot use a column of type ${type}`);
}

/** A query run as read-only turned out to write, or held several statements. */
export class ReadOnlyViolation extends Error {
  constructor(message = "Cette requête modifie la base, ou en contient plusieurs.") {
    super(message);
    this.name = "ReadOnlyViolation";
  }
}

export function isReadOnlyViolation(err: unknown): boolean {
  return err instanceof Error && err.name === "ReadOnlyViolation";
}
