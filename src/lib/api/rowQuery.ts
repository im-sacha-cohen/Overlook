import type { FilterGroup, RowFilter, RowQuery } from "../types";

/** The query string a table view sends (filters, groups, all/any, search) and back. */
export function rowQueryToParams(query: RowQuery, params = new URLSearchParams()): URLSearchParams {
  if (query.search?.trim()) params.set("search", query.search.trim());
  if (query.filters?.length) params.set("filters", JSON.stringify(query.filters));
  if (query.filterGroups?.length) params.set("groups", JSON.stringify(query.filterGroups));
  if (query.filterMatch === "any") params.set("match", "any");
  return params;
}

export function rowQueryFromParams(params: URLSearchParams): RowQuery {
  const filters = params.get("filters");
  const groups = params.get("groups");
  return {
    filters: filters ? (JSON.parse(filters) as RowFilter[]) : undefined,
    filterGroups: groups ? (JSON.parse(groups) as FilterGroup[]) : undefined,
    filterMatch: params.get("match") === "any" ? "any" : "all",
    search: params.get("search") ?? undefined,
  };
}
