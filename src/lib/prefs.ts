// View preferences, per connection and per table. Stored server-side in the metadata
// database so they survive a browser change, and carried in connection exports.
import { AGGREGATE_FNS, type AggregateFn, type FilterGroup, type FilterMatch, type RowFilter, type RowSort } from "./types";
import { FILTER_OPS } from "./db/where";

export type ViewKind = "table" | "board" | "calendar" | "gallery";
export const VIEW_KINDS: ViewKind[] = ["table", "board", "calendar", "gallery"];

/** A named set of filters/sorts/grouping the user can switch back to. */
export interface SavedView {
  id: string;
  name: string;
  filters: RowFilter[];
  filterMatch: FilterMatch;
  filterGroups: FilterGroup[];
  sorts: RowSort[];
  groupBy: string;
  view: ViewKind;
  hiddenColumns: string[];
}

export interface TablePrefs {
  savedViews: SavedView[];
  /** The saved view last applied, "" when none. */
  activeViewId: string;
  filters: RowFilter[];
  filterMatch: FilterMatch;
  filterGroups: FilterGroup[];
  sorts: RowSort[];
  groupBy: string;
  view: ViewKind;
  columnOrder: string[];
  columnWidths: Record<string, number>;
  hiddenColumns: string[];
  /** Columns kept in view on the left while scrolling sideways. */
  frozenColumns: string[];
  /** The summary shown under each column, if any. */
  columnSummaries: Record<string, AggregateFn>;
}

export const EMPTY_PREFS: TablePrefs = {
  savedViews: [],
  activeViewId: "",
  filterMatch: "all",
  filterGroups: [],
  filters: [],
  sorts: [],
  groupBy: "",
  view: "table",
  columnOrder: [],
  columnWidths: {},
  hiddenColumns: [],
  frozenColumns: [],
  columnSummaries: {},
};

// Generous but bounded: preferences arrive from the client and from imported files.
const MAX_ITEMS = 200;

function str(v: unknown, max = 200): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function names(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX_ITEMS).map((x) => x.slice(0, 200)) : [];
}

function sanitizeFilters(raw: unknown): RowFilter[] {
  return Array.isArray(raw)
    ? raw
        .map((f) => (f ?? {}) as Record<string, unknown>)
        .filter((f) => typeof f.column === "string" && FILTER_OPS.includes(f.op as RowFilter["op"]))
        .slice(0, MAX_ITEMS)
        .map((f): RowFilter => ({ column: str(f.column), op: f.op as RowFilter["op"], value: str(f.value, 1000), ...(typeof f.value2 === "string" ? { value2: str(f.value2, 1000) } : {}), ...(Array.isArray(f.values) ? { values: names(f.values) } : {}), ...(f.disabled === true ? { disabled: true } : {}), ...(typeof f.group === "string" && f.group ? { group: str(f.group, 64) } : {}), ...(Array.isArray(f.via) && f.via.length > 0 ? { via: names(f.via).slice(0, 3) } : {}) }))
    : [];
}

function sanitizeGroups(raw: unknown): FilterGroup[] {
  return Array.isArray(raw)
    ? raw
        .map((g) => (g ?? {}) as Record<string, unknown>)
        .filter((g) => typeof g.id === "string" && g.id)
        .slice(0, MAX_ITEMS)
        .map((g): FilterGroup => ({ id: str(g.id, 64), match: g.match === "any" ? "any" : "all" }))
    : [];
}

function sanitizeSummaries(raw: unknown): Record<string, AggregateFn> {
  const out: Record<string, AggregateFn> = {};
  if (raw && typeof raw === "object") {
    for (const [name, fn] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_ITEMS)) {
      if (AGGREGATE_FNS.includes(fn as AggregateFn)) out[name.slice(0, 200)] = fn as AggregateFn;
    }
  }
  return out;
}

function sanitizeSorts(raw: unknown): RowSort[] {
  return Array.isArray(raw)
    ? raw
        .map((s) => (s ?? {}) as Record<string, unknown>)
        .filter((s) => typeof s.column === "string")
        .slice(0, MAX_ITEMS)
        .map((s): RowSort => ({ column: str(s.column), dir: s.dir === "desc" ? "desc" : "asc" }))
    : [];
}

function sanitizeView(raw: unknown): ViewKind {
  return VIEW_KINDS.includes(raw as ViewKind) ? (raw as ViewKind) : "table";
}

function sanitizeSavedViews(raw: unknown): SavedView[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SavedView[] = [];
  for (const item of raw.slice(0, MAX_ITEMS)) {
    const v = (item ?? {}) as Record<string, unknown>;
    const id = str(v.id, 64);
    const name = str(v.name).trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name,
      filters: sanitizeFilters(v.filters),
      filterMatch: v.filterMatch === "any" ? "any" : "all",
      filterGroups: sanitizeGroups(v.filterGroups),
      sorts: sanitizeSorts(v.sorts),
      groupBy: str(v.groupBy),
      view: sanitizeView(v.view),
      hiddenColumns: names(v.hiddenColumns),
    });
  }
  return out;
}

export function sanitizeTablePrefs(raw: unknown): TablePrefs {
  const p = (raw ?? {}) as Record<string, unknown>;
  const filters = sanitizeFilters(p.filters);
  const sorts = sanitizeSorts(p.sorts);
  const savedViews = sanitizeSavedViews(p.savedViews);
  const activeViewId = str(p.activeViewId, 64);
  const widths: Record<string, number> = {};
  if (p.columnWidths && typeof p.columnWidths === "object") {
    for (const [name, value] of Object.entries(p.columnWidths as Record<string, unknown>).slice(0, MAX_ITEMS)) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) widths[name.slice(0, 200)] = Math.min(2000, Math.round(n));
    }
  }
  return {
    savedViews,
    activeViewId: savedViews.some((v) => v.id === activeViewId) ? activeViewId : "",
    filters,
    filterMatch: p.filterMatch === "any" ? "any" : "all",
    filterGroups: sanitizeGroups(p.filterGroups),
    sorts,
    groupBy: str(p.groupBy),
    view: sanitizeView(p.view),
    columnOrder: names(p.columnOrder),
    columnWidths: widths,
    hiddenColumns: names(p.hiddenColumns),
    frozenColumns: names(p.frozenColumns),
    columnSummaries: sanitizeSummaries(p.columnSummaries),
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
    p.savedViews.length === 0 &&
    p.filters.length === 0 &&
    p.sorts.length === 0 &&
    p.groupBy === "" &&
    p.view === "table" &&
    p.columnOrder.length === 0 &&
    Object.keys(p.columnWidths).length === 0 &&
    p.hiddenColumns.length === 0 &&
    p.filterMatch === "all" &&
    p.filterGroups.length === 0 &&
    p.frozenColumns.length === 0 &&
    Object.keys(p.columnSummaries).length === 0
  );
}
