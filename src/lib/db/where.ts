import { TRUNCATED_KEY, type AggregateFn, type ColumnMeta, type Engine, type FilterMatch, type LogicalType, type Row, type RowFilter, type RowQuery, type RowSort, type TableMeta, type TruncatedCells } from "../types";
import { assertKnownColumn, assertValidIdentifier, inlineParams } from "./adapter";

/*
 * WHERE / ORDER BY building shared by the adapters and by the browser, which
 * shows the exact statement a table view runs. Pure: no driver imports.
 */

export const FILTER_OPS: RowFilter["op"][] = ["eq", "neq", "in", "notIn", "contains", "notContains", "gt", "lt", "between", "empty", "notEmpty"];

/** Operators that make sense for a column, in menu order. */
export function opsFor(type: LogicalType | undefined): RowFilter["op"][] {
  if (type === "date") return ["eq", "neq", "gt", "lt", "between", "empty", "notEmpty"];
  if (type === "number") return ["eq", "neq", "in", "notIn", "gt", "lt", "between", "empty", "notEmpty"];
  if (type === "checkbox") return ["eq", "neq", "empty", "notEmpty"];
  if (type === "select" || type === "relation") return ["eq", "neq", "in", "notIn", "empty", "notEmpty"];
  return ["eq", "neq", "in", "notIn", "contains", "notContains", "empty", "notEmpty"];
}

export function opNeedsValue(op: RowFilter["op"]): boolean {
  return op !== "empty" && op !== "notEmpty";
}

/** A filter still being typed changes nothing rather than emptying the grid. */
export function isActiveFilter(f: RowFilter): boolean {
  if (!opNeedsValue(f.op)) return true;
  if (f.op === "in" || f.op === "notIn") return (f.values ?? []).some((v) => v !== "");
  if (f.op === "between") return f.value !== "" || (f.value2 ?? "") !== "";
  return f.value !== "";
}

export function quoteIdent(engine: Engine, ident: string): string {
  assertValidIdentifier(ident);
  return engine === "mysql" ? `\`${ident}\`` : `"${ident}"`;
}

function asText(engine: Engine, col: string): string {
  if (engine === "postgres") return `${col}::text`;
  return `CAST(${col} AS ${engine === "mysql" ? "CHAR" : "TEXT"})`;
}

const DAY_OR_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(.*))?$/;

/**
 * A date filter value names a span, not an instant: a day ("2026-09-17") or a
 * minute ("2026-09-17 14:05"). Returns where that span ends, so "is the 17th"
 * or "up to 14:05" keep rows stamped 14:05:42. Null when the value isn't a date.
 */
export function dateSpanEnd(value: string): string | null {
  const m = DAY_OR_TIME.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, sec, suffix = ""] = m;
  const hasTime = h !== undefined;
  const t = new Date(Date.UTC(+y, +mo - 1, +d, hasTime ? +h : 0, hasTime ? +mi : 0, sec ? +sec : 0));
  if (!hasTime) t.setUTCDate(t.getUTCDate() + 1);
  else if (sec && +sec !== 0) t.setUTCSeconds(t.getUTCSeconds() + 1);
  else t.setUTCMinutes(t.getUTCMinutes() + 1);
  const iso = t.toISOString();
  return hasTime ? `${iso.slice(0, 10)} ${iso.slice(11, 19)}${suffix}` : iso.slice(0, 10);
}

// A JSON column may hold a list (["ROLE_ADMIN","ROLE_USER"]): "is one of" then also
// matches a list containing the value, as suggestions offer its elements.
function holdsLists(col: ColumnMeta): boolean {
  return col.logicalType === "json";
}

/**
 * LIKE treats % and _ as wildcards: "100%" or "user_id" must match literally.
 * "!" is the escape character, the same on every engine (a backslash depends on
 * MySQL's sql_mode and doubles up in string literals).
 */
export function likeContains(value: string): string {
  return `%${value.replace(/[!%_]/g, (c) => `!${c}`)}%`;
}
const ESCAPE = ` ESCAPE '!'`;

/** Table metadata by name, for filters that follow foreign keys. */
export type TableLookup = (name: string) => TableMeta | undefined;

const MAX_HOPS = 3;

/**
 * The column a filter tests and the foreign keys leading to it. Every hop must be
 * a foreign key of the table reached so far; unknown names throw.
 */
export function resolveFilterColumn(meta: TableMeta, f: RowFilter, lookup?: TableLookup): { col: ColumnMeta; hops: { fk: string; table: string; refColumn: string }[] } {
  const hops: { fk: string; table: string; refColumn: string }[] = [];
  let current = meta;
  for (const fk of (f.via ?? []).slice(0, MAX_HOPS + 1)) {
    if (hops.length === MAX_HOPS) throw new Error("Too many relations in one filter");
    const fkCol = assertKnownColumn(current, fk);
    if (!fkCol.references) throw new Error(`Not a foreign key: ${JSON.stringify(fk)}`);
    const next = lookup?.(fkCol.references.table);
    if (!next) throw new Error(`Unknown table: ${JSON.stringify(fkCol.references.table)}`);
    hops.push({ fk, table: next.name, refColumn: fkCol.references.column });
    current = next;
  }
  return { col: assertKnownColumn(current, f.column), hops };
}

/** Loads the tables that filters reach through foreign keys, for buildWhere. */
export async function loadRelatedTables(meta: TableMeta, query: RowQuery, getTable: (name: string) => Promise<TableMeta>): Promise<TableLookup> {
  const tables = new Map<string, TableMeta>([[meta.name, meta]]);
  for (const f of query.filters ?? []) {
    let current = meta;
    for (const fk of (f.via ?? []).slice(0, MAX_HOPS)) {
      const ref = current.columns.find((c) => c.name === fk)?.references?.table;
      if (!ref) break;
      if (!tables.has(ref)) tables.set(ref, await getTable(ref));
      current = tables.get(ref)!;
    }
  }
  return (name) => tables.get(name);
}

/** A filter applies when it is switched on and filled in. */
export function isAppliedFilter(f: RowFilter): boolean {
  return !f.disabled && isActiveFilter(f);
}

function filterClause(engine: Engine, colMeta: ColumnMeta, f: RowFilter, p: (v: unknown) => string): string | null {
  const col = quoteIdent(engine, f.column);
  const text = asText(engine, col);
  const like = engine === "postgres" ? "ILIKE" : "LIKE";
  const spanEnd = (v: string) => (colMeta.logicalType === "date" ? dateSpanEnd(v) : null);
  const oneOf = () => {
    const values = [...new Set((f.values ?? []).filter((v) => v !== ""))];
    const parts = [`${text} IN (${values.map((v) => p(v)).join(", ")})`];
    if (holdsLists(colMeta)) for (const v of values) parts.push(`${text} LIKE ${p(likeContains(JSON.stringify(v)))}${ESCAPE}`);
    return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
  };
  switch (f.op) {
    case "eq": {
      const end = spanEnd(f.value);
      return end ? `(${col} >= ${p(f.value)} AND ${col} < ${p(end)})` : `${text} = ${p(f.value)}`;
    }
    case "neq": {
      const end = spanEnd(f.value);
      return end ? `(${col} < ${p(f.value)} OR ${col} >= ${p(end)})` : `${text} <> ${p(f.value)}`;
    }
    case "in":
      return oneOf();
    case "notIn":
      return `(${col} IS NULL OR NOT ${oneOf()})`;
    case "contains":
      return `${text} ${like} ${p(likeContains(f.value))}${ESCAPE}`;
    case "notContains":
      return `(${col} IS NULL OR ${text} NOT ${like} ${p(likeContains(f.value))}${ESCAPE})`;
    case "gt": {
      const end = spanEnd(f.value);
      return end ? `${col} >= ${p(end)}` : `${col} > ${p(f.value)}`;
    }
    case "lt":
      return `${col} < ${p(f.value)}`;
    case "between": {
      const parts: string[] = [];
      const to = f.value2 ?? "";
      if (f.value !== "") parts.push(`${col} >= ${p(f.value)}`);
      if (to !== "") {
        const end = spanEnd(to);
        parts.push(end ? `${col} < ${p(end)}` : `${col} <= ${p(to)}`);
      }
      return parts.length === 1 ? parts[0] : `(${parts.join(" AND ")})`;
    }
    case "empty":
      return `(${col} IS NULL OR ${text} = '')`;
    case "notEmpty":
      return `(${col} IS NOT NULL AND ${text} <> '')`;
  }
  return null;
}

function join(clauses: string[], match: FilterMatch): string {
  if (clauses.length === 1) return clauses[0];
  return `(${clauses.join(match === "any" ? " OR " : " AND ")})`;
}

/**
 * WHERE for a query: top-level filters and groups (each between parentheses with
 * its own all/any) joined by the query's all/any, then AND the search.
 */
export function buildWhere(engine: Engine, meta: TableMeta, query: RowQuery = {}, lookup?: TableLookup): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return engine === "postgres" ? `$${params.length}` : "?";
  };
  // Placeholders are numbered as they are written, so the SQL is built in reading
  // order: a group sits where its first filter is, with all its filters inside.
  const groupMatch = new Map((query.filterGroups ?? []).map((g) => [g.id, g.match]));
  type Resolved = { f: RowFilter; col: ColumnMeta; hops: { fk: string; table: string; refColumn: string }[] };
  const items: { group?: string; filters: Resolved[] }[] = [];
  const byGroup = new Map<string, Resolved[]>();
  for (const f of query.filters ?? []) {
    const { col, hops } = resolveFilterColumn(meta, f, lookup);
    if (!isAppliedFilter(f)) continue;
    if (f.group && groupMatch.has(f.group)) {
      let list = byGroup.get(f.group);
      if (!list) {
        list = [];
        byGroup.set(f.group, list);
        items.push({ group: f.group, filters: list });
      }
      list.push({ f, col, hops });
    } else {
      items.push({ filters: [{ f, col, hops }] });
    }
  }
  const filterClauses = items
    .map((item) => {
      const parts = item.filters
        .map(({ f, col, hops }) => {
          const clause = filterClause(engine, col, f, p);
          // Through foreign keys: keep rows whose key points at a row matching the condition.
          return clause && hops.reduceRight((inner, h) => `${quoteIdent(engine, h.fk)} IN (SELECT ${quoteIdent(engine, h.refColumn)} FROM ${quoteIdent(engine, h.table)} WHERE ${inner})`, clause);
        })
        .filter((c): c is string => !!c);
      if (parts.length === 0) return null;
      return item.group ? join(parts, groupMatch.get(item.group)!) : parts[0];
    })
    .filter((c): c is string => !!c);

  const clauses: string[] = [];
  if (filterClauses.length === 1) clauses.push(filterClauses[0]);
  else if (filterClauses.length > 1) {
    if (query.filterMatch === "any") clauses.push(join(filterClauses, "any"));
    else clauses.push(...filterClauses);
  }

  const term = query.search?.trim();
  if (term && meta.columns.length > 0) {
    const cols = meta.columns.map((c) => asText(engine, quoteIdent(engine, c.name)));
    if (engine === "postgres") {
      const ph = p(likeContains(term));
      clauses.push(`(${cols.map((c) => `${c} ILIKE ${ph}${ESCAPE}`).join(" OR ")})`);
    } else if (engine === "mysql") {
      clauses.push(`(${cols.map((c) => `LOWER(${c}) LIKE ${p(likeContains(term.toLowerCase()))}${ESCAPE}`).join(" OR ")})`);
    } else {
      clauses.push(`(${cols.map((c) => `${c} LIKE ${p(likeContains(term))}${ESCAPE}`).join(" OR ")})`);
    }
  }

  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

// ---------- grid previews ----------
// A page of 100 rows holding long texts or files would weigh tens of MB. The grid
// gets values over PREVIEW_THRESHOLD bytes cut to PREVIEW_CHARS characters (binary
// ones as null), and the full length to say so; small values come as they are.
const PREVIEW_THRESHOLD = 1000;
const PREVIEW_CHARS = 500;
const PREVIEW_PREFIX = "__overlook_preview_";
const LENGTH_PREFIX = "__overlook_length_";

/** How a column may hold long values: text, binary, or either (SQLite stores anything anywhere). */
function heavyKind(engine: Engine, col: ColumnMeta): "text" | "binary" | "any" | null {
  if (engine === "sqlite") return "any";
  const t = col.nativeType.toLowerCase();
  if (engine === "mysql") {
    if (/^(text|mediumtext|longtext)$/.test(t)) return "text";
    if (/^(blob|mediumblob|longblob)$/.test(t)) return "binary";
    return null;
  }
  if (t === "text" || t === "character varying") return "text";
  if (t === "bytea") return "binary";
  return null;
}

/**
 * The select list for a page of the grid, with long values cut. Previews get their
 * own names, so an ORDER BY on the column still sorts by the full value.
 */
export function previewSelectList(engine: Engine, meta: TableMeta, { text = true }: { text?: boolean } = {}): string {
  const T = PREVIEW_THRESHOLD;
  return meta.columns
    .map((c) => {
      const kind = heavyKind(engine, c);
      const col = quoteIdent(engine, c.name);
      // Without `text`, only files are left out (the detail panel shows texts whole).
      if (!kind || (!text && kind === "text")) return col;
      const preview = quoteIdent(engine, PREVIEW_PREFIX + c.name);
      const length = quoteIdent(engine, LENGTH_PREFIX + c.name);
      if (engine === "sqlite") {
        const cutTypes = text ? "('blob', 'text')" : "('blob')";
        return (
          `CASE WHEN typeof(${col}) = 'blob' AND length(${col}) > ${T} THEN NULL WHEN ${text ? "" : "0 AND "}typeof(${col}) = 'text' AND length(CAST(${col} AS BLOB)) > ${T} THEN substr(${col}, 1, ${PREVIEW_CHARS}) ELSE ${col} END AS ${preview}, ` +
          `CASE WHEN typeof(${col}) IN ${cutTypes} AND length(CAST(${col} AS BLOB)) > ${T} THEN length(CAST(${col} AS BLOB)) END AS ${length}`
        );
      }
      const bytes = engine === "mysql" ? `LENGTH(${col})` : `octet_length(${col})`;
      const cut = kind === "binary" ? "NULL" : engine === "mysql" ? `LEFT(${col}, ${PREVIEW_CHARS})` : `left(${col}, ${PREVIEW_CHARS})`;
      return `CASE WHEN ${bytes} > ${T} THEN ${cut} ELSE ${col} END AS ${preview}, CASE WHEN ${bytes} > ${T} THEN ${bytes} END AS ${length}`;
    })
    .join(", ");
}

/** Puts previews back under their column's name and notes which cells were cut. */
export function applyPreviews(rows: Row[]): Row[] {
  for (const row of rows) {
    const lengths: Record<string, number> = {};
    for (const key of Object.keys(row)) {
      if (key.startsWith(PREVIEW_PREFIX)) {
        row[key.slice(PREVIEW_PREFIX.length)] = row[key];
        delete row[key];
      } else if (key.startsWith(LENGTH_PREFIX)) {
        if (row[key] !== null && row[key] !== undefined) lengths[key.slice(LENGTH_PREFIX.length)] = Number(row[key]);
        delete row[key];
      }
    }
    const names = Object.keys(lengths);
    // A cut text keeps its start; a cut binary value comes as null.
    if (names.length > 0) row[TRUNCATED_KEY] = Object.fromEntries(names.map((name) => [name, { bytes: lengths[name], binary: row[name] === null }])) satisfies TruncatedCells;
  }
  return rows;
}

export function buildOrderBy(engine: Engine, meta: TableMeta, sorts: RowSort[] = []): string {
  const parts = sorts.map((s) => {
    assertKnownColumn(meta, s.column);
    return `${quoteIdent(engine, s.column)} ${s.dir === "desc" ? "DESC" : "ASC"}`;
  });
  return parts.length ? `ORDER BY ${parts.join(", ")}` : "";
}

/** A suggested filter value: how many rows of the table on screen hold it, and its row's key when there is one. */
export interface DistinctValue {
  value: string;
  count: number;
  id?: string;
}

/**
 * Suggestions for a filter value: the column's values with the number of rows of
 * the table on screen holding each, among the rows the other filters keep
 * (`within`). With `via`, the column belongs to a related table and rows are
 * counted on the table on screen through the foreign keys. `id` is the key of the
 * row holding the value (the related row, or the row itself) when only one does.
 */
export function buildDistinctValues(
  engine: Engine,
  meta: TableMeta,
  column: string,
  query = "",
  limit = 50,
  options: { via?: string[]; within?: RowQuery; lookup?: TableLookup } = {},
): { sql: string; params: unknown[] } {
  const { hops } = resolveFilterColumn(meta, { column, via: options.via, op: "eq", value: "" }, options.lookup);
  const q = (name: string) => quoteIdent(engine, name);
  const { where: within, params } = buildWhere(engine, meta, options.within ?? {}, options.lookup);
  // The other filters narrow the table on screen first; related tables join onto it.
  let from = within ? `(SELECT * FROM ${q(meta.name)} ${within}) t0` : `${q(meta.name)} t0`;
  hops.forEach((h, i) => {
    from += ` JOIN ${q(h.table)} t${i + 1} ON t${i}.${q(h.fk)} = t${i + 1}.${q(h.refColumn)}`;
  });
  const last = `t${hops.length}`;
  const value = `${last}.${q(column)}`;
  const text = asText(engine, value);
  const pk = meta.columns.find((c) => c.isPrimaryKey)?.name;
  const key = hops.length ? `${last}.${q(hops[hops.length - 1].refColumn)}` : pk ? `t0.${q(pk)}` : null;
  const conditions = [`${value} IS NOT NULL`, `${text} <> ''`];
  if (query.trim()) {
    params.push(likeContains(query.trim()));
    conditions.push(`${text} ${engine === "postgres" ? "ILIKE" : "LIKE"} ${engine === "postgres" ? `$${params.length}` : "?"}${ESCAPE}`);
  }
  const id = key ? `, CASE WHEN COUNT(DISTINCT ${key}) = 1 THEN MIN(${key}) END AS id` : "";
  const sql = `SELECT ${text} AS value, COUNT(*) AS count${id} FROM ${from} WHERE ${conditions.join(" AND ")} GROUP BY ${text} ORDER BY COUNT(*) DESC, ${text} LIMIT ${Math.max(1, Math.min(500, Math.floor(limit)))}`;
  return { sql, params };
}

/** Rows from the suggestions query as plain values. */
export function distinctRows(rows: { value: unknown; count: unknown; id?: unknown }[]): DistinctValue[] {
  return rows.map((r) => ({ value: String(r.value), count: Number(r.count), ...(r.id !== null && r.id !== undefined ? { id: String(r.id) } : {}) }));
}

/** The tables a suggestions query reaches: the other filters' and the column's own path. */
export function distinctQueryTables(column: string, via: string[] | undefined, within: RowQuery | undefined): RowQuery {
  return { filters: [...(within?.filters ?? []), { column, via, op: "eq", value: "" }] };
}

/**
 * Suggestions from grouped values: when every value is a JSON list of scalars
 * (roles…), count the elements instead, so each role is offered on its own —
 * only those matching `query`, not their neighbours in the same list.
 */
export function topDistinct(rows: DistinctValue[], query = "", limit = 50): DistinctValue[] {
  const lists = rows.map((r) => {
    if (!r.value.trimStart().startsWith("[")) return null;
    try {
      const parsed: unknown = JSON.parse(r.value);
      return Array.isArray(parsed) && parsed.every((x) => ["string", "number", "boolean"].includes(typeof x)) ? parsed.map(String) : null;
    } catch {
      return null;
    }
  });
  if (rows.length === 0 || lists.some((l) => l === null)) return rows.slice(0, limit);
  const needle = query.trim().toLowerCase();
  const counts = new Map<string, number>();
  rows.forEach((r, i) => {
    for (const el of new Set(lists[i])) if (!needle || el.toLowerCase().includes(needle)) counts.set(el, (counts.get(el) ?? 0) + r.count);
  });
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit);
}

/** The page query a table view runs, with values inlined — for display only. */
export function describeSelect(
  engine: Engine,
  meta: TableMeta,
  opts: RowQuery & { sorts?: RowSort[]; limit: number; offset: number },
  lookup?: TableLookup,
): string {
  const { where, params } = buildWhere(engine, meta, opts, lookup);
  const orderBy = buildOrderBy(engine, meta, opts.sorts);
  const sql = [`SELECT * FROM ${quoteIdent(engine, meta.name)}`, where, orderBy, `LIMIT ${opts.limit}`, opts.offset ? `OFFSET ${opts.offset}` : ""].filter(Boolean).join(" ");
  return `${inlineParams({ sql, params }, engine === "postgres" ? "dollar" : "question")};`;
}

/** Which summaries make sense for a column. */
export function aggregatesFor(type: LogicalType): AggregateFn[] {
  if (type === "number") return ["filled", "empty", "unique", "sum", "avg", "min", "max"];
  if (type === "date") return ["filled", "empty", "unique", "min", "max"];
  return ["filled", "empty", "unique"];
}

/** One statement computing every requested summary over the rows a query keeps. */
export function buildAggregate(engine: Engine, meta: TableMeta, query: RowQuery, specs: { column: string; fn: AggregateFn }[], lookup?: TableLookup): { sql: string; params: unknown[]; keys: string[] } {
  const { where, params } = buildWhere(engine, meta, query, lookup);
  const keys: string[] = [];
  const exprs = specs.map((s, i) => {
    const colMeta = assertKnownColumn(meta, s.column);
    if (!aggregatesFor(colMeta.logicalType).includes(s.fn)) throw new Error(`Unsupported summary ${s.fn} on ${s.column}`);
    const col = quoteIdent(engine, s.column);
    const text = asText(engine, col);
    keys.push(`${s.column}:${s.fn}`);
    const expr = {
      filled: `SUM(CASE WHEN ${col} IS NOT NULL AND ${text} <> '' THEN 1 ELSE 0 END)`,
      empty: `SUM(CASE WHEN ${col} IS NULL OR ${text} = '' THEN 1 ELSE 0 END)`,
      unique: `COUNT(DISTINCT CASE WHEN ${text} <> '' THEN ${text} END)`,
      sum: `SUM(${col})`,
      avg: `AVG(${col})`,
      min: `MIN(${col})`,
      max: `MAX(${col})`,
    }[s.fn];
    return `${expr} AS ${quoteIdent(engine, `a${i}`)}`;
  });
  const sql = `SELECT ${exprs.join(", ")} FROM ${quoteIdent(engine, meta.name)}${where ? ` ${where}` : ""}`;
  return { sql, params, keys };
}

/** Driver values (bigint strings, decimals, dates) as plain JSON values. */
export function aggregateResult(keys: string[], row: Record<string, unknown> | undefined): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  keys.forEach((key, i) => {
    const v = row?.[`a${i}`];
    if (v === null || v === undefined) out[key] = null;
    else if (typeof v === "number") out[key] = v;
    else if (typeof v === "bigint") out[key] = Number(v);
    else if (v instanceof Date) out[key] = v.toISOString();
    else {
      const n = Number(v);
      out[key] = typeof v === "string" && v.trim() !== "" && Number.isFinite(n) && !/^\d{4}-\d{2}-\d{2}/.test(v) ? n : String(v);
    }
  });
  return out;
}
