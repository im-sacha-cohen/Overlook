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
