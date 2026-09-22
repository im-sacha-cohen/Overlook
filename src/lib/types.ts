export type EnvType = "local" | "dev" | "staging" | "prod" | "custom";
export type Engine = "postgres" | "mysql" | "sqlite";

/**
 * disable: plain connection. require: encrypted, server certificate not checked.
 * verify-ca: certificate must be signed by the given (or a system) authority.
 * verify-full: verify-ca, and the certificate must also name the host.
 */
export type SslMode = "disable" | "require" | "verify-ca" | "verify-full";
export const SSL_MODES: SslMode[] = ["disable", "require", "verify-ca", "verify-full"];

export interface SshTunnel {
  host: string;
  port: number;
  user: string;
  auth: "password" | "key";
}

/** Secret material kept encrypted at rest, never sent back to the browser. */
export interface ConnectionSecrets {
  sshPassword?: string;
  sshPrivateKey?: string;
  sshPassphrase?: string;
  sslCa?: string;
  sslCert?: string;
  sslKey?: string;
}

export const SECRET_FIELDS: (keyof ConnectionSecrets)[] = ["sshPassword", "sshPrivateKey", "sshPassphrase", "sslCa", "sslCert", "sslKey"];

export interface Connection {
  id: string;
  name: string;
  envType: EnvType;
  engine: Engine;
  host?: string;
  port?: number;
  database: string;
  user?: string;
  /** true unless sslMode is "disable"; kept for older clients and exports. */
  ssl?: boolean;
  sslMode?: SslMode;
  ssh?: SshTunnel | null;
  /** Which secrets are stored, so the form can say "saved" without seeing them. */
  storedSecrets?: (keyof ConnectionSecrets)[];
  /** The folder it is filed under in the connection list; loose when absent. */
  folder?: string;
  createdAt: string;
}

export const MAX_FOLDER_NAME = 60;

export interface ConnectionInput extends ConnectionSecrets {
  name: string;
  envType: EnvType;
  engine: Engine;
  host?: string;
  port?: number;
  database: string;
  user?: string;
  /** On update: undefined keeps the stored one, "" removes it. Same for every secret. */
  password?: string;
  ssl?: boolean;
  sslMode?: SslMode;
  ssh?: SshTunnel | null;
  /** "" takes the connection out of its folder. */
  folder?: string;
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

/**
 * On a row of the grid, the cells sent as a preview: column name → full length in
 * bytes. A long text holds its first characters, a long binary value is null.
 * Anything that writes or copies a value fetches the full row first.
 */
export const TRUNCATED_KEY = "__overlook_truncated";
export type TruncatedCells = Record<string, number>;

export interface TableMeta {
  name: string;
  columns: ColumnMeta[];
  rowCount: number;
}

export interface RowFilter {
  column: string;
  op: "eq" | "neq" | "in" | "notIn" | "contains" | "notContains" | "gt" | "lt" | "between" | "empty" | "notEmpty";
  value: string;
  /** Upper bound of "between". */
  value2?: string;
  /** The candidates of "in" / "notIn". */
  values?: string[];
  /** Kept on screen but not applied. */
  disabled?: boolean;
  /** Id of the FilterGroup it belongs to; top level when absent. */
  group?: string;
  /**
   * Foreign keys to follow first: with ["dossier_id"], `column` is a column of the
   * table dossier_id points to ("documents whose dossier has this public_id").
   */
  via?: string[];
}

/** Whether rows must match every filter or at least one. */
export type FilterMatch = "all" | "any";

/** Conditions between parentheses, with their own all/any. */
export interface FilterGroup {
  id: string;
  match: FilterMatch;
}

/** What narrows a table's rows: filters (top level and grouped) and the free-text search. */
export interface RowQuery {
  filters?: RowFilter[];
  filterMatch?: FilterMatch;
  filterGroups?: FilterGroup[];
  search?: string;
}

/** Column summaries shown under the table. */
export type AggregateFn = "filled" | "empty" | "unique" | "sum" | "avg" | "min" | "max";
export const AGGREGATE_FNS: AggregateFn[] = ["filled", "empty", "unique", "sum", "avg", "min", "max"];

export interface RowSort {
  column: string;
  dir: "asc" | "desc";
}

export type Row = Record<string, unknown>;

export interface QueryResult {
  columns: string[];
  rows: Row[];
  rowCount: number;
  /** Set when the query changed the database. */
  wrote?: boolean;
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
  | { kind: "dropTables"; tables: string[]; ignoreForeignKeys?: boolean }
  /** Deletes every row, keeping the tables, and restarts their auto-increment counters. */
  | { kind: "emptyTables"; tables: string[]; ignoreForeignKeys?: boolean };

export interface WritePreview {
  /** Readable SQL, parameters inlined (long values cut short). */
  sql: string;
  /** The same statements with every value whole, to run by hand elsewhere. */
  script: string;
  /**
   * Rows concerned: matched by an update/delete, holding the values a column
   * change or drop touches, or held by the dropped or emptied tables. null when unknown.
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
  | "emptyTables"
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
