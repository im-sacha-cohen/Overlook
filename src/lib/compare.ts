// Schema and data comparison between two connections (e.g. dev and prod).
import type { ColumnMeta, Row, TableMeta } from "./types";

export interface ColumnDiff {
  name: string;
  change: "onlyLeft" | "onlyRight" | "changed";
  left?: ColumnMeta;
  right?: ColumnMeta;
  /** What differs, for "changed": type, nullable, primaryKey, references. */
  fields?: string[];
}

export interface SchemaDiff {
  onlyLeft: string[];
  onlyRight: string[];
  changed: { table: string; columns: ColumnDiff[] }[];
  identical: string[];
}

function referenceText(c: ColumnMeta): string {
  return c.references ? `${c.references.table}.${c.references.column}` : "";
}

/**
 * Between two engines native type names never match (integer vs int), so types
 * are then compared by kind (number, text, date…) rather than by name.
 */
export function diffSchemas(left: TableMeta[], right: TableMeta[], sameEngine = true): SchemaDiff {
  const leftByName = new Map(left.map((t) => [t.name, t]));
  const rightByName = new Map(right.map((t) => [t.name, t]));
  const out: SchemaDiff = { onlyLeft: [], onlyRight: [], changed: [], identical: [] };
  for (const t of left) if (!rightByName.has(t.name)) out.onlyLeft.push(t.name);
  for (const t of right) if (!leftByName.has(t.name)) out.onlyRight.push(t.name);
  for (const l of left) {
    const r = rightByName.get(l.name);
    if (!r) continue;
    const rightCols = new Map(r.columns.map((c) => [c.name, c]));
    const leftCols = new Map(l.columns.map((c) => [c.name, c]));
    const columns: ColumnDiff[] = [];
    for (const lc of l.columns) {
      const rc = rightCols.get(lc.name);
      if (!rc) {
        columns.push({ name: lc.name, change: "onlyLeft", left: lc });
        continue;
      }
      const fields: string[] = [];
      const typeDiffers = sameEngine ? lc.nativeType.toLowerCase() !== rc.nativeType.toLowerCase() : lc.logicalType !== rc.logicalType;
      if (typeDiffers) fields.push("type");
      if (lc.nullable !== rc.nullable) fields.push("nullable");
      if (lc.isPrimaryKey !== rc.isPrimaryKey) fields.push("primaryKey");
      if (referenceText(lc) !== referenceText(rc)) fields.push("references");
      if (fields.length > 0) columns.push({ name: lc.name, change: "changed", left: lc, right: rc, fields });
    }
    for (const rc of r.columns) if (!leftCols.has(rc.name)) columns.push({ name: rc.name, change: "onlyRight", right: rc });
    if (columns.length > 0) out.changed.push({ table: l.name, columns });
    else out.identical.push(l.name);
  }
  const byName = (a: string, b: string) => a.localeCompare(b);
  out.onlyLeft.sort(byName);
  out.onlyRight.sort(byName);
  out.identical.sort(byName);
  out.changed.sort((a, b) => byName(a.table, b.table));
  return out;
}

export interface DataDiff {
  pkColumn: string;
  columns: string[];
  leftRows: number;
  rightRows: number;
  /** Rows were only read up to a limit on at least one side. */
  truncated: boolean;
  onlyLeft: Row[];
  onlyRight: Row[];
  changed: { key: string; left: Row; right: Row; columns: string[] }[];
  counts: { onlyLeft: number; onlyRight: number; changed: number; same: number };
}

/**
 * Engines don't hand values back the same way (true vs 1, "1.50" vs 1.5, Date vs
 * string), so compare a normalised text form.
 */
export function comparable(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number" || typeof value === "bigint") return String(Number(value));
  if (value instanceof Date) return normalizeDateText(value.toISOString());
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  if (/^-?\d+(\.\d+)?$/.test(text)) return String(Number(text));
  if (DATE_TEXT.test(text)) return normalizeDateText(text);
  return text;
}

const DATE_TEXT = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}(:?\d{2})?)?$/;

/** "2026-01-04T00:00:00.000Z" and "2026-01-04" read the same. */
function normalizeDateText(text: string): string {
  return text
    .replace("T", " ")
    .replace(/(Z|[+-]00(:?00)?)$/, "")
    .replace(/\.0+$/, "")
    .replace(/ 00:00(:00)?$/, "");
}

const MAX_LISTED = 200;

export function diffRows(pkColumn: string, columns: string[], left: Row[], right: Row[], truncated: boolean): DataDiff {
  const rightByKey = new Map(right.map((r) => [String(r[pkColumn]), r]));
  const leftKeys = new Set(left.map((r) => String(r[pkColumn])));
  const out: DataDiff = {
    pkColumn,
    columns,
    leftRows: left.length,
    rightRows: right.length,
    truncated,
    onlyLeft: [],
    onlyRight: [],
    changed: [],
    counts: { onlyLeft: 0, onlyRight: 0, changed: 0, same: 0 },
  };
  for (const l of left) {
    const key = String(l[pkColumn]);
    const r = rightByKey.get(key);
    if (!r) {
      out.counts.onlyLeft++;
      if (out.onlyLeft.length < MAX_LISTED) out.onlyLeft.push(l);
      continue;
    }
    const differing = columns.filter((c) => comparable(l[c]) !== comparable(r[c]));
    if (differing.length === 0) {
      out.counts.same++;
    } else {
      out.counts.changed++;
      if (out.changed.length < MAX_LISTED) out.changed.push({ key, left: l, right: r, columns: differing });
    }
  }
  for (const r of right) {
    if (leftKeys.has(String(r[pkColumn]))) continue;
    out.counts.onlyRight++;
    if (out.onlyRight.length < MAX_LISTED) out.onlyRight.push(r);
  }
  return out;
}
