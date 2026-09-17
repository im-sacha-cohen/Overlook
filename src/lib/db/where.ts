import type { ColumnMeta, Engine, FilterMatch, LogicalType, RowFilter, RowSort, TableMeta } from "../types";
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

export function buildWhere(engine: Engine, meta: TableMeta, filters: RowFilter[] = [], search?: string, match: FilterMatch = "all"): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return engine === "postgres" ? `$${params.length}` : "?";
  };
  const like = engine === "postgres" ? "ILIKE" : "LIKE";
  const clauses: string[] = [];
  const filterClauses: string[] = [];

  for (const f of filters) {
    const colMeta: ColumnMeta = assertKnownColumn(meta, f.column);
    if (!isActiveFilter(f)) continue;
    const col = quoteIdent(engine, f.column);
    const spanEnd = (v: string) => (colMeta.logicalType === "date" ? dateSpanEnd(v) : null);
    const clauses = filterClauses;
    const oneOf = () => {
      const values = [...new Set((f.values ?? []).filter((v) => v !== ""))];
      const parts = [`${asText(engine, col)} IN (${values.map((v) => p(v)).join(", ")})`];
      if (holdsLists(colMeta)) for (const v of values) parts.push(`${asText(engine, col)} LIKE ${p(`%${JSON.stringify(v)}%`)}`);
      return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
    };
    switch (f.op) {
      case "eq": {
        const end = spanEnd(f.value);
        clauses.push(end ? `(${col} >= ${p(f.value)} AND ${col} < ${p(end)})` : `${asText(engine, col)} = ${p(f.value)}`);
        break;
      }
      case "neq": {
        const end = spanEnd(f.value);
        clauses.push(end ? `(${col} < ${p(f.value)} OR ${col} >= ${p(end)})` : `${asText(engine, col)} <> ${p(f.value)}`);
        break;
      }
      case "in":
        clauses.push(oneOf());
        break;
      case "notIn":
        clauses.push(`(${col} IS NULL OR NOT ${oneOf()})`);
        break;
      case "contains":
        clauses.push(`${asText(engine, col)} ${like} ${p(`%${f.value}%`)}`);
        break;
      case "notContains":
        clauses.push(`(${col} IS NULL OR ${asText(engine, col)} NOT ${like} ${p(`%${f.value}%`)})`);
        break;
      case "gt": {
        const end = spanEnd(f.value);
        clauses.push(end ? `${col} >= ${p(end)}` : `${col} > ${p(f.value)}`);
        break;
      }
      case "lt":
        clauses.push(`${col} < ${p(f.value)}`);
        break;
      case "between": {
        const from = f.value;
        const to = f.value2 ?? "";
        if (from !== "") clauses.push(`${col} >= ${p(from)}`);
        const end = to !== "" ? spanEnd(to) : null;
        if (to !== "") clauses.push(end ? `${col} < ${p(end)}` : `${col} <= ${p(to)}`);
        break;
      }
      case "empty":
        clauses.push(`(${col} IS NULL OR ${asText(engine, col)} = '')`);
        break;
      case "notEmpty":
        clauses.push(`(${col} IS NOT NULL AND ${asText(engine, col)} <> '')`);
        break;
    }
  }

  if (filterClauses.length === 1) clauses.push(filterClauses[0]);
  else if (filterClauses.length > 1) clauses.push(match === "any" ? `(${filterClauses.join(" OR ")})` : filterClauses.join(" AND "));

  const term = search?.trim();
  if (term && meta.columns.length > 0) {
    if (engine === "postgres") {
      const ph = p(`%${term}%`);
      clauses.push(`(${meta.columns.map((c) => `${asText(engine, quoteIdent(engine, c.name))} ILIKE ${ph}`).join(" OR ")})`);
    } else if (engine === "mysql") {
      clauses.push(`(${meta.columns.map((c) => `LOWER(${asText(engine, quoteIdent(engine, c.name))}) LIKE ${p(`%${term.toLowerCase()}%`)}`).join(" OR ")})`);
    } else {
      clauses.push(`(${meta.columns.map((c) => `${asText(engine, quoteIdent(engine, c.name))} LIKE ${p(`%${term}%`)}`).join(" OR ")})`);
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
    params.push(`%${query.trim()}%`);
    where.push(engine === "postgres" ? `${text} ILIKE $1` : `${text} LIKE ?`);
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
  opts: { filters?: RowFilter[]; filterMatch?: FilterMatch; sorts?: RowSort[]; search?: string; limit: number; offset: number },
): string {
  const { where, params } = buildWhere(engine, meta, opts.filters, opts.search, opts.filterMatch);
  const orderBy = buildOrderBy(engine, meta, opts.sorts);
  const sql = [`SELECT * FROM ${quoteIdent(engine, meta.name)}`, where, orderBy, `LIMIT ${opts.limit}`, opts.offset ? `OFFSET ${opts.offset}` : ""].filter(Boolean).join(" ");
  return `${inlineParams({ sql, params }, engine === "postgres" ? "dollar" : "question")};`;
}
