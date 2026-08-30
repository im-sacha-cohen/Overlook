import type { ColumnMeta, Row } from "../types";

export interface RowGroup {
  key: string;
  rows: Row[];
}

export function groupRows(rows: Row[], column: ColumnMeta | undefined): RowGroup[] {
  if (!column) return [{ key: "", rows }];
  const keys = [...(column.options ?? [])];
  for (const r of rows) {
    const v = String(r[column.name] ?? "—");
    if (!keys.includes(v)) keys.push(v);
  }
  return keys
    .map((k) => ({ key: k, rows: rows.filter((r) => String(r[column.name] ?? "—") === k) }))
    .filter((g) => g.rows.length > 0);
}

export function primaryKeyValue(row: Row, pkColumn: string): string {
  return String(row[pkColumn]);
}
