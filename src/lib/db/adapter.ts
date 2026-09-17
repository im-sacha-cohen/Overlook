import type { ColumnMeta, LogicalType, QueryResult, Row, RowFilter, RowSort, TableMeta, WriteOp, WritePreview } from "../types";

export type { WriteOp, WritePreview };

export interface SelectOptions {
  filters?: RowFilter[];
  sorts?: RowSort[];
  /** Free text matched against every column (as text), case-insensitively. */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ImportReport {
  executed: number;
  failed: { statement: number; sql: string; message: string }[];
}

export interface SqlStatement {
  sql: string;
  params: unknown[];
}

export interface DatabaseAdapter {
  /** The statements a write would run, without running them. */
  buildWrite(op: WriteOp): Promise<SqlStatement[]>;
  previewWrite(op: WriteOp): Promise<WritePreview>;
  testConnection(): Promise<void>;
  listTables(): Promise<TableMeta[]>;
  getTable(table: string): Promise<TableMeta>;
  createTable(table: string, columns: { name: string; type: LogicalType }[]): Promise<void>;
  selectRows(table: string, opts: SelectOptions): Promise<{ rows: Row[]; total: number }>;
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
  runRawQuery(sql: string): Promise<QueryResult>;
  runStatement(sql: string): Promise<void>;
  runScript(sql: string): Promise<ImportReport>;
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

export function filterOpToSql(op: RowFilter["op"]): string {
  if (op === "eq") return "=";
  if (op === "neq") return "<>";
  return "LIKE";
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
      col && value === "" && col.logicalType !== "text" && col.logicalType !== "select" ? null : value;
  }
  return out;
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  const shown = text.length > 200 ? `${text.slice(0, 200)}…` : text;
  return `'${shown.replace(/'/g, "''")}'`;
}

/**
 * Inlines parameters into a statement, for display only: `?` placeholders
 * (MySQL, SQLite) or `$n` ones (PostgreSQL). Placeholders inside quoted
 * identifiers can't occur since identifiers are validated.
 */
export function inlineParams(statement: SqlStatement, style: "question" | "dollar"): string {
  if (statement.params.length === 0) return statement.sql;
  if (style === "dollar") return statement.sql.replace(/\$(\d+)/g, (m, n) => (Number(n) <= statement.params.length ? sqlLiteral(statement.params[Number(n) - 1]) : m));
  let i = 0;
  return statement.sql.replace(/\?/g, (m) => (i < statement.params.length ? sqlLiteral(statement.params[i++]) : m));
}

export function formatStatements(statements: SqlStatement[], style: "question" | "dollar"): string {
  return statements.map((st) => `${inlineParams(st, style)};`).join("\n");
}

/** Shared by the adapters: build the statements, then say how many rows they concern. */
export async function previewWithAdapter(
  adapter: DatabaseAdapter,
  op: WriteOp,
  style: "question" | "dollar",
  countByPk: (table: string, pkColumn: string, pkValues: unknown[]) => Promise<number>,
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
  return { sql: formatStatements(statements, style), rows };
}

export function assertCreatableType(type: LogicalType): asserts type is Exclude<LogicalType, "relation" | "unknown"> {
  if (type === "relation" || type === "unknown") throw new Error(`Cannot use a column of type ${type}`);
}
