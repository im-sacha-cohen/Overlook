import type {
  Connection,
  ConnectionInput,
  LogicalType,
  QueryResult,
  Row,
  RowFilter,
  RowSort,
  TableMeta,
} from "../types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
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
    opts: { filters?: RowFilter[]; sorts?: RowSort[]; limit?: number; offset?: number }
  ) => {
    const params = new URLSearchParams();
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

  dropTables: (connectionId: string, names: string[], confirm?: string) =>
    request<{ dropped: number }>(`/api/connections/${connectionId}/tables/bulk-delete`, {
      method: "POST",
      body: JSON.stringify({ names, confirm }),
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
};
