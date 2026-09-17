export type EnvType = "local" | "dev" | "staging" | "prod" | "custom";
export type Engine = "postgres" | "mysql" | "sqlite";

export interface Connection {
  id: string;
  name: string;
  envType: EnvType;
  engine: Engine;
  host?: string;
  port?: number;
  database: string;
  user?: string;
  ssl?: boolean;
  createdAt: string;
}

export interface ConnectionInput {
  name: string;
  envType: EnvType;
  engine: Engine;
  host?: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
  ssl?: boolean;
}

export type LogicalType =
  | "text"
  | "number"
  | "select"
  | "date"
  | "checkbox"
  | "relation"
  | "json"
  | "unknown";

export interface ColumnMeta {
  name: string;
  logicalType: LogicalType;
  nativeType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  options?: string[];
  references?: { table: string; column: string };
  hidden?: boolean;
}

export interface TableMeta {
  name: string;
  columns: ColumnMeta[];
  rowCount: number;
}

export interface RowFilter {
  column: string;
  op: "eq" | "neq" | "contains";
  value: string;
}

export interface RowSort {
  column: string;
  dir: "asc" | "desc";
}

export type Row = Record<string, unknown>;

export interface QueryResult {
  columns: string[];
  rows: Row[];
  rowCount: number;
}

export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  createdAt: string;
  updatedAt: string;
}

export interface QueryHistoryEntry {
  id: number;
  sql: string;
  ranAt: string;
  durationMs: number;
  /** null when the query failed. */
  rowCount: number | null;
  error: string | null;
}

export const ENV_LABELS: Record<EnvType, string> = {
  local: "LOCAL",
  dev: "DEV",
  staging: "STAGING",
  prod: "PROD",
  custom: "CUSTOM",
};

export const ENGINE_LABELS: Record<Engine, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
};

export const ENGINE_DEFAULT_PORT: Record<Engine, number | null> = {
  postgres: 5432,
  mysql: 3306,
  sqlite: null,
};

/** A write the UI can preview before running (and that the journal describes after). */
export type WriteOp =
  | { kind: "updateRows"; table: string; pkColumn: string; pkValues: unknown[]; values: Row }
  | { kind: "deleteRows"; table: string; pkColumn: string; pkValues: unknown[] }
  | { kind: "addColumn"; table: string; name: string; type: LogicalType }
  | { kind: "renameColumn"; table: string; oldName: string; newName: string }
  | { kind: "changeColumnType"; table: string; column: string; type: LogicalType }
  | { kind: "dropColumn"; table: string; column: string }
  | { kind: "dropTables"; tables: string[]; ignoreForeignKeys?: boolean };

export interface WritePreview {
  /** Readable SQL, parameters inlined. */
  sql: string;
  /**
   * Rows concerned: matched by an update/delete, holding the values a column
   * change or drop touches, or held by the dropped tables. null when unknown.
   */
  rows: number | null;
}


export type JournalAction =
  | "insertRow"
  | "updateRow"
  | "updateRows"
  | "deleteRows"
  | "importRows"
  | "createTable"
  | "dropTables"
  | "addColumn"
  | "renameColumn"
  | "changeColumnType"
  | "dropColumn"
  | "query"
  | "sqlScript"
  | "dropDatabase";

/** What a journal entry keeps to show a change and, when possible, undo it. */
export interface JournalDetails {
  pkColumn?: string;
  /** Rows as they were before (updates: only the changed columns and the key). */
  before?: Row[];
  /** Values written (inserts: the row, updates: the new values). */
  after?: Row[];
  /** Before/after were cut to keep the journal small. */
  truncated?: boolean;
}

export interface JournalEntry {
  id: number;
  connectionId: string;
  connectionName: string;
  envType: EnvType;
  at: string;
  actor: string | null;
  ip: string | null;
  action: JournalAction;
  tableName: string | null;
  sql: string | null;
  rows: number | null;
  details: JournalDetails | null;
  error: string | null;
}
