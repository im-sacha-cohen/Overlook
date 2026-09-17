import type { AggregateFn, ColumnMeta, Engine, FilterMatch, LogicalType, RowFilter, RowQuery, RowSort, TableMeta } from "../types";
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
export function buildWhere(engine: Engine, meta: TableMeta, query: RowQuery = {}): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return engine === "postgres" ? `$${params.length}` : "?";
  };
  // Placeholders are numbered as they are written, so the SQL is built in reading
  // order: a group sits where its first filter is, with all its filters inside.
  const groupMatch = new Map((query.filterGroups ?? []).map((g) => [g.id, g.match]));
  const items: { group?: string; filters: { f: RowFilter; col: ColumnMeta }[] }[] = [];
  const byGroup = new Map<string, { f: RowFilter; col: ColumnMeta }[]>();
  for (const f of query.filters ?? []) {
    const col = assertKnownColumn(meta, f.column);
    if (!isAppliedFilter(f)) continue;
    if (f.group && groupMatch.has(f.group)) {
      let list = byGroup.get(f.group);
      if (!list) {
        list = [];
        byGroup.set(f.group, list);
        items.push({ group: f.group, filters: list });
      }
      list.push({ f, col });
    } else {
      items.push({ filters: [{ f, col }] });
    }
  }
  const filterClauses = items
    .map((item) => {
      const parts = item.filters.map(({ f, col }) => filterClause(engine, col, f, p)).filter((c): c is string => !!c);
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

export function buildOrderBy(engine: Engine, meta: TableMeta, sorts: RowSort[] = []): string {
  const parts = sorts.map((s) => {
    assertKnownColumn(meta, s.column);
    return `${quoteIdent(engine, s.column)} ${s.dir === "desc" ? "DESC" : "ASC"}`;
  });
  return parts.length ? `ORDER BY ${parts.join(", ")}` : "";
}

/**
 * The most frequent values of a column, as text, for filter suggestions.
 * Optionally narrowed to values containing `query`.
 */
export function buildDistinctValues(engine: Engine, meta: TableMeta, column: string, query = "", limit = 50): { sql: string; params: unknown[] } {
  assertKnownColumn(meta, column);
  const params: unknown[] = [];
  const text = asText(engine, quoteIdent(engine, column));
  const where = [`${quoteIdent(engine, column)} IS NOT NULL`, `${text} <> ''`];
  if (query.trim()) {
    params.push(likeContains(query.trim()));
    where.push(engine === "postgres" ? `${text} ILIKE $1${ESCAPE}` : `${text} LIKE ?${ESCAPE}`);
  }
  const sql = `SELECT ${text} AS value, COUNT(*) AS count FROM ${quoteIdent(engine, meta.name)} WHERE ${where.join(" AND ")} GROUP BY ${text} ORDER BY COUNT(*) DESC, ${text} LIMIT ${Math.max(1, Math.min(200, Math.floor(limit)))}`;
  return { sql, params };
}

/**
 * Suggestions from grouped values: when every value is a JSON list of scalars
 * (roles…), count the elements instead, so each role is offered on its own —
 * only those matching `query`, not their neighbours in the same list.
 */
export function topDistinct(rows: { value: string; count: number }[], query = "", limit = 50): { value: string; count: number }[] {
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
): string {
  const { where, params } = buildWhere(engine, meta, opts);
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
export function buildAggregate(engine: Engine, meta: TableMeta, query: RowQuery, specs: { column: string; fn: AggregateFn }[]): { sql: string; params: unknown[]; keys: string[] } {
  const { where, params } = buildWhere(engine, meta, query);
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
