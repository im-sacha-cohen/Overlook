import { getConnectionSecret } from "../store/metadata";
import type { DatabaseAdapter } from "./adapter";
import { PostgresAdapter } from "./postgres";
import { MySqlAdapter } from "./mysql";
import { SqliteAdapter } from "./sqlite";

const cache = new Map<string, DatabaseAdapter>();

export function getAdapter(connectionId: string): DatabaseAdapter {
  const cached = cache.get(connectionId);
  if (cached) return cached;

  const conn = getConnectionSecret(connectionId);
  if (!conn) throw new Error("Connection not found");

  let adapter: DatabaseAdapter;
  if (conn.engine === "postgres") adapter = new PostgresAdapter(conn);
  else if (conn.engine === "mysql") adapter = new MySqlAdapter(conn);
  else adapter = new SqliteAdapter(conn);

  cache.set(connectionId, adapter);
  return adapter;
}

export async function createAdHocAdapter(
  conn: Parameters<typeof buildAdapter>[0]
): Promise<DatabaseAdapter> {
  return buildAdapter(conn);
}

function buildAdapter(conn: {
  engine: "postgres" | "mysql" | "sqlite";
  host?: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
  ssl?: boolean;
}): DatabaseAdapter {
  const asConn = { id: "adhoc", name: "adhoc", envType: "local" as const, createdAt: "", ...conn };
  if (conn.engine === "postgres") return new PostgresAdapter(asConn);
  if (conn.engine === "mysql") return new MySqlAdapter(asConn);
  return new SqliteAdapter(asConn);
}

export function invalidateConnection(connectionId: string): void {
  const adapter = cache.get(connectionId);
  if (adapter) {
    adapter.close().catch(() => {});
    cache.delete(connectionId);
  }
}
