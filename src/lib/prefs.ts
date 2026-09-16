// View preferences, per connection and per table. Stored server-side in the metadata
// database so they survive a browser change, and carried in connection exports.
import type { RowFilter, RowSort } from "./types";

export type ViewKind = "table" | "board" | "calendar" | "gallery";
export const VIEW_KINDS: ViewKind[] = ["table", "board", "calendar", "gallery"];

export interface TablePrefs {
  filters: RowFilter[];
  sorts: RowSort[];
  groupBy: string;
  view: ViewKind;
  columnOrder: string[];
  columnWidths: Record<string, number>;
  hiddenColumns: string[];
}

export const EMPTY_PREFS: TablePrefs = {
  filters: [],
  sorts: [],
  groupBy: "",
  view: "table",
  columnOrder: [],
  columnWidths: {},
  hiddenColumns: [],
};

const FILTER_OPS: RowFilter["op"][] = ["eq", "neq", "contains"];
// Generous but bounded: preferences arrive from the client and from imported files.
const MAX_ITEMS = 200;

function str(v: unknown, max = 200): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function names(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX_ITEMS).map((x) => x.slice(0, 200)) : [];
}

export function sanitizeTablePrefs(raw: unknown): TablePrefs {
  const p = (raw ?? {}) as Record<string, unknown>;
  const filters = Array.isArray(p.filters)
    ? p.filters
        .map((f) => (f ?? {}) as Record<string, unknown>)
        .filter((f) => typeof f.column === "string" && FILTER_OPS.includes(f.op as RowFilter["op"]))
        .slice(0, MAX_ITEMS)
        .map((f): RowFilter => ({ column: str(f.column), op: f.op as RowFilter["op"], value: str(f.value, 1000) }))
    : [];
  const sorts = Array.isArray(p.sorts)
    ? p.sorts
        .map((s) => (s ?? {}) as Record<string, unknown>)
        .filter((s) => typeof s.column === "string")
        .slice(0, MAX_ITEMS)
        .map((s): RowSort => ({ column: str(s.column), dir: s.dir === "desc" ? "desc" : "asc" }))
    : [];
  const widths: Record<string, number> = {};
  if (p.columnWidths && typeof p.columnWidths === "object") {
    for (const [name, value] of Object.entries(p.columnWidths as Record<string, unknown>).slice(0, MAX_ITEMS)) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) widths[name.slice(0, 200)] = Math.min(2000, Math.round(n));
    }
  }
  return {
    filters,
    sorts,
    groupBy: str(p.groupBy),
    view: VIEW_KINDS.includes(p.view as ViewKind) ? (p.view as ViewKind) : "table",
    columnOrder: names(p.columnOrder),
    columnWidths: widths,
    hiddenColumns: names(p.hiddenColumns),
  };
}

// Connection-level preferences, shared by every table of that connection.
export interface ConnectionPrefs {
  autoRefresh: boolean;
}

export const EMPTY_CONNECTION_PREFS: ConnectionPrefs = { autoRefresh: false };

export function sanitizeConnectionPrefs(raw: unknown): ConnectionPrefs {
  const p = (raw ?? {}) as Record<string, unknown>;
  return { autoRefresh: p.autoRefresh === true };
}

export function isEmptyConnectionPrefs(p: ConnectionPrefs): boolean {
  return p.autoRefresh === false;
}

export function isEmptyPrefs(p: TablePrefs): boolean {
  return (
    p.filters.length === 0 &&
    p.sorts.length === 0 &&
    p.groupBy === "" &&
    p.view === "table" &&
    p.columnOrder.length === 0 &&
    Object.keys(p.columnWidths).length === 0 &&
    p.hiddenColumns.length === 0
  );
}
