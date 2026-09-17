import { getConnectionSecret } from "../store/metadata";
import type { DatabaseAdapter } from "./adapter";
import { PostgresAdapter } from "./postgres";
import { MySqlAdapter } from "./mysql";
import { SqliteAdapter } from "./sqlite";
import { openTunnel } from "./sshTunnel";
import type { AdapterConnection } from "./network";
import { ENGINE_DEFAULT_PORT } from "../types";

const cache = new Map<string, DatabaseAdapter>();

export function getAdapter(connectionId: string): DatabaseAdapter {
  const cached = cache.get(connectionId);
  if (cached) return cached;

  const conn = getConnectionSecret(connectionId);
  if (!conn) throw new Error("Connection not found");

  const adapter = connect(conn, () => {
    // A tunnel that failed to open is forgotten, so the next request tries again.
    if (cache.get(connectionId) === adapter) cache.delete(connectionId);
  });
  cache.set(connectionId, adapter);
  return adapter;
}

export async function createAdHocAdapter(conn: Omit<AdapterConnection, "id" | "name" | "envType" | "createdAt">): Promise<DatabaseAdapter> {
  return connect({ id: "adhoc", name: "adhoc", envType: "local", createdAt: "", ...conn });
}

function build(conn: AdapterConnection): DatabaseAdapter {
  if (conn.engine === "postgres") return new PostgresAdapter(conn);
  if (conn.engine === "mysql") return new MySqlAdapter(conn);
  return new SqliteAdapter(conn);
}

function connect(conn: AdapterConnection, onTunnelFailure?: () => void): DatabaseAdapter {
  if (!conn.ssh || conn.engine === "sqlite") return build(conn);
  const ssh = conn.ssh;
  const targetHost = conn.host || "127.0.0.1";
  const targetPort = conn.port ?? ENGINE_DEFAULT_PORT[conn.engine] ?? 0;
  const ready = openTunnel(ssh, conn.secrets ?? {}, targetHost, targetPort).then((tunnel) => ({
    tunnel,
    inner: build({ ...conn, host: targetHost, port: targetPort, via: { host: tunnel.host, port: tunnel.port } }),
  }));
  ready.catch(() => onTunnelFailure?.());
  // Every adapter method is async, so each call can simply wait for the tunnel.
  return new Proxy({} as DatabaseAdapter, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      return async (...args: unknown[]) => {
        const { tunnel, inner } = await ready;
        if (prop === "close") {
          await inner.close();
          await tunnel.close();
          return;
        }
        const method = (inner as unknown as Record<PropertyKey, (...a: unknown[]) => unknown>)[prop];
        return method.apply(inner, args);
      };
    },
  });
}

export function invalidateConnection(connectionId: string): void {
  const adapter = cache.get(connectionId);
  if (adapter) {
    adapter.close().catch(() => {});
    cache.delete(connectionId);
  }
}
