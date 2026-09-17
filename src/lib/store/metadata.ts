import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { dataDir } from "./paths";
import { encrypt, decrypt } from "./crypto";
import type { Connection, ConnectionInput } from "../types";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(path.join(dir, "app-metadata.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      envType TEXT NOT NULL,
      engine TEXT NOT NULL,
      host TEXT,
      port INTEGER,
      database TEXT NOT NULL,
      user TEXT,
      passwordEnc TEXT,
      ssl INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS table_prefs (
      connectionId TEXT NOT NULL,
      tableName TEXT NOT NULL,
      prefs TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (connectionId, tableName)
    );
    CREATE TABLE IF NOT EXISTS connection_prefs (
      connectionId TEXT PRIMARY KEY,
      prefs TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS saved_queries (
      id TEXT PRIMARY KEY,
      connectionId TEXT NOT NULL,
      name TEXT NOT NULL,
      sql TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS saved_queries_connection ON saved_queries (connectionId);
    CREATE TABLE IF NOT EXISTS query_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connectionId TEXT NOT NULL,
      sql TEXT NOT NULL,
      ranAt TEXT NOT NULL,
      durationMs INTEGER NOT NULL,
      rowCount INTEGER,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS query_history_connection ON query_history (connectionId, id);
  `);
  return db;
}

interface ConnectionRow {
  id: string;
  name: string;
  envType: string;
  engine: string;
  host: string | null;
  port: number | null;
  database: string;
  user: string | null;
  passwordEnc: string | null;
  ssl: number;
  createdAt: string;
}

function toPublic(row: ConnectionRow): Connection {
  return {
    id: row.id,
    name: row.name,
    envType: row.envType as Connection["envType"],
    engine: row.engine as Connection["engine"],
    host: row.host ?? undefined,
    port: row.port ?? undefined,
    database: row.database,
    user: row.user ?? undefined,
    ssl: !!row.ssl,
    createdAt: row.createdAt,
  };
}

export function listConnections(): Connection[] {
  const rows = getDb()
    .prepare("SELECT * FROM connections ORDER BY createdAt ASC")
    .all() as ConnectionRow[];
  return rows.map(toPublic);
}

export function getConnection(id: string): Connection | null {
  const row = getDb().prepare("SELECT * FROM connections WHERE id = ?").get(id) as
    | ConnectionRow
    | undefined;
  return row ? toPublic(row) : null;
}

export function getConnectionSecret(id: string): (Connection & { password?: string }) | null {
  const row = getDb().prepare("SELECT * FROM connections WHERE id = ?").get(id) as
    | ConnectionRow
    | undefined;
  if (!row) return null;
  return {
    ...toPublic(row),
    password: row.passwordEnc ? decrypt(row.passwordEnc) : undefined,
  };
}

export function createConnection(input: ConnectionInput): Connection {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO connections (id, name, envType, engine, host, port, database, user, passwordEnc, ssl, createdAt)
       VALUES (@id, @name, @envType, @engine, @host, @port, @database, @user, @passwordEnc, @ssl, @createdAt)`
    )
    .run({
      id,
      name: input.name,
      envType: input.envType,
      engine: input.engine,
      host: input.host ?? null,
      port: input.port ?? null,
      database: input.database,
      user: input.user ?? null,
      passwordEnc: input.password ? encrypt(input.password) : null,
      ssl: input.ssl ? 1 : 0,
      createdAt,
    });
  return getConnection(id) as Connection;
}

export function updateConnection(id: string, input: Partial<ConnectionInput>): Connection | null {
  const existing = getDb().prepare("SELECT * FROM connections WHERE id = ?").get(id) as
    | ConnectionRow
    | undefined;
  if (!existing) return null;
  const next = {
    name: input.name ?? existing.name,
    envType: input.envType ?? existing.envType,
    engine: input.engine ?? existing.engine,
    host: input.host !== undefined ? input.host : existing.host,
    port: input.port !== undefined ? input.port : existing.port,
    database: input.database ?? existing.database,
    user: input.user !== undefined ? input.user : existing.user,
    passwordEnc:
      input.password !== undefined ? (input.password ? encrypt(input.password) : null) : existing.passwordEnc,
    ssl: input.ssl !== undefined ? (input.ssl ? 1 : 0) : existing.ssl,
  };
  getDb()
    .prepare(
      `UPDATE connections SET name=@name, envType=@envType, engine=@engine, host=@host, port=@port,
       database=@database, user=@user, passwordEnc=@passwordEnc, ssl=@ssl WHERE id=@id`
    )
    .run({ ...next, id });
  return getConnection(id);
}

export function deleteConnection(id: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM table_prefs WHERE connectionId = ?").run(id);
    db.prepare("DELETE FROM connection_prefs WHERE connectionId = ?").run(id);
    db.prepare("DELETE FROM saved_queries WHERE connectionId = ?").run(id);
    db.prepare("DELETE FROM query_history WHERE connectionId = ?").run(id);
    db.prepare("DELETE FROM connections WHERE id = ?").run(id);
  })();
}
