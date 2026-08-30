import fs from "node:fs";
import { Client as PgClient } from "pg";
import mysql from "mysql2/promise";
import Database from "better-sqlite3";
import type { Engine } from "../types";
import { assertValidIdentifier } from "./adapter";

export interface AdminConnParams {
  engine: Engine;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  ssl?: boolean;
  database: string;
}

export async function createDatabase(params: AdminConnParams): Promise<void> {
  assertValidIdentifier(params.database);
  if (params.engine === "sqlite") {
    const db = new Database(params.database);
    db.close();
    return;
  }
  if (params.engine === "postgres") {
    const client = new PgClient({
      host: params.host,
      port: params.port ?? 5432,
      database: "postgres",
      user: params.user,
      password: params.password,
      ssl: params.ssl ? { rejectUnauthorized: false } : undefined,
    });
    await client.connect();
    try {
      await client.query(`CREATE DATABASE "${params.database}"`);
    } finally {
      await client.end();
    }
    return;
  }
  const conn = await mysql.createConnection({
    host: params.host,
    port: params.port ?? 3306,
    user: params.user,
    password: params.password,
    ssl: params.ssl ? {} : undefined,
  });
  try {
    await conn.query(`CREATE DATABASE \`${params.database}\``);
  } finally {
    await conn.end();
  }
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
  if (params.engine === "postgres") {
    const client = new PgClient({
      host: params.host,
      port: params.port ?? 5432,
      database: "postgres",
      user: params.user,
      password: params.password,
      ssl: params.ssl ? { rejectUnauthorized: false } : undefined,
    });
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
  const conn = await mysql.createConnection({
    host: params.host,
    port: params.port ?? 3306,
    user: params.user,
    password: params.password,
    ssl: params.ssl ? {} : undefined,
  });
  try {
    await conn.query(`DROP DATABASE \`${params.database}\``);
  } finally {
    await conn.end();
  }
}
