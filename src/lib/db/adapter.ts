import type { ColumnMeta, LogicalType, QueryResult, Row, RowFilter, RowSort, TableMeta } from "../types";

export interface SelectOptions {
  filters?: RowFilter[];
  sorts?: RowSort[];
  limit?: number;
  offset?: number;
}

export interface ImportReport {
  executed: number;
  failed: { statement: number; sql: string; message: string }[];
}

export interface DatabaseAdapter {
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
  dropTable(table: string): Promise<void>;
  bulkInsert(table: string, rows: Row[]): Promise<number>;
  runRawQuery(sql: string): Promise<QueryResult>;
  runStatement(sql: string): Promise<void>;
  runScript(sql: string): Promise<ImportReport>;
  close(): Promise<void>;
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
