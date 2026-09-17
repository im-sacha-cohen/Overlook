import fs from "node:fs";
import { Client as PgClient } from "pg";
import mysql from "mysql2/promise";
import Database from "better-sqlite3";
import net from "node:net";
import { ENGINE_DEFAULT_PORT, type ConnectionSecrets, type Engine, type SshTunnel, type SslMode } from "../types";
import { assertValidIdentifier } from "./adapter";
import { mysqlSslOptions, tlsOptions, type AdapterConnection } from "./network";
import { openTunnel } from "./sshTunnel";

export interface AdminConnParams {
  engine: Engine;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  ssl?: boolean;
  sslMode?: SslMode;
  ssh?: SshTunnel | null;
  secrets?: ConnectionSecrets;
  database: string;
}

/** Runs `fn` against the server, through an SSH tunnel when the connection has one. */
async function withServer<T>(params: AdminConnParams, fn: (conn: AdapterConnection) => Promise<T>): Promise<T> {
  const port = params.port ?? ENGINE_DEFAULT_PORT[params.engine] ?? undefined;
  const conn: AdapterConnection = { id: "admin", name: "admin", envType: "local", createdAt: "", ...params, port };
  if (!params.ssh) return fn(conn);
  const tunnel = await openTunnel(params.ssh, params.secrets ?? {}, params.host || "127.0.0.1", port ?? 0);
  try {
    return await fn({ ...conn, via: { host: tunnel.host, port: tunnel.port } });
  } finally {
    await tunnel.close();
  }
}

function pgClient(conn: AdapterConnection): PgClient {
  return new PgClient({
    host: conn.via?.host ?? conn.host,
    port: conn.via?.port ?? conn.port ?? 5432,
    database: "postgres",
    user: conn.user,
    password: conn.password,
    ssl: tlsOptions(conn),
  });
}

function mysqlConnection(conn: AdapterConnection) {
  return mysql.createConnection({
    host: conn.host,
    port: conn.port ?? 3306,
    user: conn.user,
    password: conn.password,
    ssl: mysqlSslOptions(conn),
    ...(conn.via ? { stream: net.connect(conn.via.port, conn.via.host) } : {}),
  });
}

export async function createDatabase(params: AdminConnParams): Promise<void> {
  assertValidIdentifier(params.database);
  if (params.engine === "sqlite") {
    const db = new Database(params.database);
    db.close();
    return;
  }
  await withServer(params, async (server) => {
    if (params.engine === "postgres") {
      const client = pgClient(server);
      await client.connect();
      try {
        await client.query(`CREATE DATABASE "${params.database}"`);
      } finally {
        await client.end();
      }
      return;
    }
    const conn = await mysqlConnection(server);
    try {
      await conn.query(`CREATE DATABASE \`${params.database}\``);
    } finally {
      await conn.end();
    }
  });
}

export async function dropDatabase(params: AdminConnParams): Promise<void> {
  assertValidIdentifier(params.database);
  if (params.engine === "sqlite") {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const path = params.database + suffix;
      if (fs.existsSync(path)) fs.unlinkSync(path);
    }
    return;
  }
  await withServer(params, async (server) => {
    if (params.engine === "postgres") {
      const client = pgClient(server);
      await client.connect();
      try {
        await client.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [params.database]
        );
        await client.query(`DROP DATABASE "${params.database}"`);
      } finally {
        await client.end();
      }
      return;
    }
    const conn = await mysqlConnection(server);
    try {
      await conn.query(`DROP DATABASE \`${params.database}\``);
    } finally {
      await conn.end();
    }
  });
}
