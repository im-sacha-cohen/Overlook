import type {
  Connection,
  ConnectionInput,
  JournalEntry,
  LogicalType,
  QueryHistoryEntry,
  QueryResult,
  Row,
  RowFilter,
  RowSort,
  SavedQuery,
  TableMeta,
  WriteOp,
  WritePreview,
} from "../types";
import type { ConnectionBundle } from "../connectionBundle";
import type { ConnectionPrefs, TablePrefs } from "../prefs";

const USER_NAME_KEY = "overlook:userName";

/** The name shown as author in the journal, set in Settings and kept in this browser. */
export function getUserName(): string {
  try {
    return localStorage.getItem(USER_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setUserName(name: string): void {
  try {
    if (name.trim()) localStorage.setItem(USER_NAME_KEY, name.trim());
    else localStorage.removeItem(USER_NAME_KEY);
  } catch {
    // Storage unavailable: the journal just won't show a name.
  }
}

export function userHeader(): Record<string, string> {
  const name = typeof window === "undefined" ? "" : getUserName();
  return name ? { "X-Overlook-User": encodeURIComponent(name) } : {};
}

export interface JournalFilters {
  connectionId?: string;
  table?: string;
  action?: string;
  from?: string;
  to?: string;
  search?: string;
  beforeId?: number;
}

export function journalQueryString(filters: JournalFilters): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== "") params.set(k, String(v));
  return params.toString();
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...userHeader(), ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Erreur ${res.status}`);
  }
  return body as T;
}

export const api = {
  listConnections: () => request<{ connections: Connection[] }>("/api/connections"),
  createConnection: (input: ConnectionInput) =>
    request<{ connection: Connection }>("/api/connections", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateConnection: (id: string, input: Partial<ConnectionInput>) =>
    request<{ connection: Connection }>(`/api/connections/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteConnection: (id: string) =>
    request<{ ok: true }>(`/api/connections/${id}`, { method: "DELETE" }),
  testConnection: (input: { id?: string } & Partial<ConnectionInput>) =>
    request<{ ok: true }>("/api/connections/test", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  getPrefs: (connectionId: string) =>
    request<{ connection: ConnectionPrefs; tables: Record<string, TablePrefs> }>(`/api/connections/${connectionId}/prefs`),
  saveTablePrefs: (connectionId: string, table: string, prefs: TablePrefs) =>
    request<unknown>(`/api/connections/${connectionId}/prefs`, { method: "PUT", body: JSON.stringify({ table, prefs }) }),
  saveConnectionPrefs: (connectionId: string, prefs: ConnectionPrefs) =>
    request<unknown>(`/api/connections/${connectionId}/prefs`, { method: "PUT", body: JSON.stringify({ prefs }) }),

  exportConnections: async (input: { ids: string[]; includePasswords: boolean; passphrase?: string }) => {
    const res = await fetch("/api/connections/bundle/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Erreur ${res.status}`);
    }
    const match = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "");
    return { blob: await res.blob(), filename: match ? match[1] : "overlook-connections.json" };
  },
  importConnections: (input: { bundle: ConnectionBundle; indices: number[]; passphrase?: string }) =>
    request<{ connections: Connection[] }>("/api/connections/bundle/import", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  createDatabase: (input: Pick<ConnectionInput, "engine" | "host" | "port" | "user" | "password" | "ssl" | "database">) =>
    request<{ ok: true }>("/api/connections/create-database", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  dropDatabase: (connectionId: string, confirm: string) =>
    request<{ ok: true }>(`/api/connections/${connectionId}/drop-database`, {
      method: "POST",
      body: JSON.stringify({ confirm }),
    }),

  listTables: (connectionId: string) =>
    request<{ tables: TableMeta[] }>(`/api/connections/${connectionId}/tables`),

  createTable: (connectionId: string, name: string, columns: { name: string; type: LogicalType }[]) =>
    request<{ ok: true }>(`/api/connections/${connectionId}/tables`, {
      method: "POST",
      body: JSON.stringify({ name, columns }),
    }),

  selectRows: (
    connectionId: string,
    table: string,
    opts: { filters?: RowFilter[]; sorts?: RowSort[]; search?: string; limit?: number; offset?: number }
  ) => {
    const params = new URLSearchParams();
    if (opts.search?.trim()) params.set("search", opts.search.trim());
    if (opts.filters?.length) params.set("filters", JSON.stringify(opts.filters));
    if (opts.sorts?.length) params.set("sorts", JSON.stringify(opts.sorts));
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.offset) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return request<{ rows: Row[]; total: number }>(
      `/api/connections/${connectionId}/tables/${encodeURIComponent(table)}/rows${qs ? `?${qs}` : ""}`
    );
  },

  insertRow: (connectionId: string, table: string, values: Row) =>
    request<{ row: Row }>(`/api/connections/${connectionId}/tables/${encodeURIComponent(table)}/rows`, {
      method: "POST",
      body: JSON.stringify(values),
    }),

  updateRow: (
    connectionId: string,
    table: string,
    rowId: string | number,
    pkColumn: string,
    values: Row
  ) =>
    request<{ ok: true }>(
      `/api/connections/${connectionId}/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(String(rowId))}`,
      { method: "PATCH", body: JSON.stringify({ pkColumn, values }) }
    ),

  deleteRow: (
    connectionId: string,
    table: string,
    rowId: string | number,
    pkColumn: string,
    confirm?: string
  ) =>
    request<{ ok: true }>(
      `/api/connections/${connectionId}/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(String(rowId))}`,
      { method: "DELETE", body: JSON.stringify({ pkColumn, confirm }) }
    ),

  deleteRows: (
    connectionId: string,
    table: string,
    pkColumn: string,
    ids: (string | number)[],
    confirm?: string
  ) =>
    request<{ deleted: number }>(`/api/connections/${connectionId}/tables/${encodeURIComponent(table)}/rows/bulk-delete`, {
      method: "POST",
      body: JSON.stringify({ pkColumn, ids, confirm }),
    }),

  updateRows: (
    connectionId: string,
    table: string,
    pkColumn: string,
    ids: (string | number)[],
    values: Row,
    confirm?: string
  ) =>
    request<{ updated: number }>(`/api/connections/${connectionId}/tables/${encodeURIComponent(table)}/rows/bulk-update`, {
      method: "POST",
      body: JSON.stringify({ pkColumn, ids, values, confirm }),
    }),

  dropTable: (connectionId: string, table: string, confirm?: string) =>
    request<{ ok: true }>(`/api/connections/${connectionId}/tables/${encodeURIComponent(table)}`, {
      method: "DELETE",
      body: JSON.stringify({ confirm }),
    }),

  dropTables: (connectionId: string, names: string[], options: { ignoreForeignKeys?: boolean; confirm?: string } = {}) =>
    request<{ dropped: number }>(`/api/connections/${connectionId}/tables/bulk-delete`, {
      method: "POST",
      body: JSON.stringify({ names, confirm: options.confirm, ignoreForeignKeys: options.ignoreForeignKeys === true }),
    }),

  addColumn: (connectionId: string, table: string, name: string, type: LogicalType) =>
    request<{ ok: true }>(`/api/connections/${connectionId}/tables/${encodeURIComponent(table)}/columns`, {
      method: "POST",
      body: JSON.stringify({ name, type }),
    }),

  renameColumn: (connectionId: string, table: string, column: string, newName: string) =>
    request<{ ok: true }>(
      `/api/connections/${connectionId}/tables/${encodeURIComponent(table)}/columns/${encodeURIComponent(column)}`,
      { method: "PATCH", body: JSON.stringify({ newName }) }
    ),

  changeColumnType: (
    connectionId: string,
    table: string,
    column: string,
    type: LogicalType,
    confirm?: string
  ) =>
    request<{ ok: true }>(
      `/api/connections/${connectionId}/tables/${encodeURIComponent(table)}/columns/${encodeURIComponent(column)}`,
      { method: "PATCH", body: JSON.stringify({ type, confirm }) }
    ),

  dropColumn: (connectionId: string, table: string, column: string, confirm?: string) =>
    request<{ ok: true }>(
      `/api/connections/${connectionId}/tables/${encodeURIComponent(table)}/columns/${encodeURIComponent(column)}`,
      { method: "DELETE", body: JSON.stringify({ confirm }) }
    ),

  importCsv: (connectionId: string, table: string, rows: Row[]) =>
    request<{ inserted: number }>(`/api/connections/${connectionId}/tables/${encodeURIComponent(table)}/import`, {
      method: "POST",
      body: JSON.stringify({ rows }),
    }),

  runQuery: (connectionId: string, sql: string, allowWrite?: boolean, confirm?: string) =>
    request<QueryResult>(`/api/connections/${connectionId}/query`, {
      method: "POST",
      body: JSON.stringify({ sql, allowWrite, confirm }),
    }),

  listJournal: (filters: JournalFilters) => request<{ entries: JournalEntry[] }>(`/api/journal?${journalQueryString(filters)}`),
  journalExportUrl: (filters: JournalFilters) => `/api/journal/export?${journalQueryString(filters)}`,
  getSettings: () => request<{ journalRetentionDays: number }>("/api/settings"),
  saveSettings: (settings: { journalRetentionDays: number }) =>
    request<{ journalRetentionDays: number }>("/api/settings", { method: "PUT", body: JSON.stringify(settings) }),
  previewWrite: (connectionId: string, op: WriteOp) =>
    request<WritePreview>(`/api/connections/${connectionId}/preview`, { method: "POST", body: JSON.stringify(op) }),
  listSavedQueries: (connectionId: string) => request<{ queries: SavedQuery[] }>(`/api/connections/${connectionId}/saved-queries`),
  createSavedQuery: (connectionId: string, name: string, sql: string) =>
    request<{ query: SavedQuery }>(`/api/connections/${connectionId}/saved-queries`, {
      method: "POST",
      body: JSON.stringify({ name, sql }),
    }),
  updateSavedQuery: (connectionId: string, queryId: string, name: string, sql: string) =>
    request<{ query: SavedQuery }>(`/api/connections/${connectionId}/saved-queries/${queryId}`, {
      method: "PUT",
      body: JSON.stringify({ name, sql }),
    }),
  deleteSavedQuery: (connectionId: string, queryId: string) =>
    request<{ ok: true }>(`/api/connections/${connectionId}/saved-queries/${queryId}`, { method: "DELETE" }),
  listQueryHistory: (connectionId: string) => request<{ entries: QueryHistoryEntry[] }>(`/api/connections/${connectionId}/query-history`),
};
