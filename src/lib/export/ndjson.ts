import type { ColumnMeta, Row } from "../types";

export function ndjsonTableStart(tableName: string, columns: ColumnMeta[]): string {
  return JSON.stringify({ type: "table_start", table: tableName, columns }) + "\n";
}

export function ndjsonRowBatch(tableName: string, rows: Row[]): string {
  if (rows.length === 0) return "";
  return rows.map((row) => JSON.stringify({ type: "row", table: tableName, data: row })).join("\n") + "\n";
}

export function ndjsonTableEnd(tableName: string, rowCount: number): string {
  return JSON.stringify({ type: "table_end", table: tableName, rows: rowCount }) + "\n";
}
