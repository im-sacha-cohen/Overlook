import type { ColumnMeta, Row } from "../types";

// RFC 4180: fields with a comma, quote or line break are quoted, quotes doubled.
function field(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvHeader(columns: ColumnMeta[]): string {
  // A BOM so spreadsheet apps read accents as UTF-8.
  return "﻿" + columns.map((c) => field(c.name)).join(",") + "\r\n";
}

export function csvRows(columns: ColumnMeta[], rows: Row[]): string {
  return rows.map((row) => columns.map((c) => field(row[c.name])).join(",") + "\r\n").join("");
}
