import type { JournalQuery } from "../store/journal";

export function journalQueryFromUrl(url: URL): JournalQuery {
  const p = url.searchParams;
  const beforeId = Number(p.get("beforeId"));
  const limit = Number(p.get("limit"));
  return {
    connectionId: p.get("connectionId") || undefined,
    tableName: p.get("table") || undefined,
    action: p.get("action") || undefined,
    from: p.get("from") || undefined,
    to: p.get("to") || undefined,
    search: p.get("search") || undefined,
    beforeId: Number.isInteger(beforeId) && beforeId > 0 ? beforeId : undefined,
    limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
  };
}
