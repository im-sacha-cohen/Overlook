import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { dataDir } from "./paths";
import { encrypt, decrypt } from "./crypto";
import { SECRET_FIELDS, SSL_MODES, type Connection, type ConnectionInput, type ConnectionSecrets, type SshTunnel, type SslMode } from "../types";

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
    CREATE TABLE IF NOT EXISTS journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connectionId TEXT NOT NULL,
      connectionName TEXT NOT NULL,
      envType TEXT NOT NULL,
      at TEXT NOT NULL,
      actor TEXT,
      ip TEXT,
      action TEXT NOT NULL,
      tableName TEXT,
      sql TEXT,
      rows INTEGER,
      details TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS journal_connection ON journal (connectionId, id);
    CREATE INDEX IF NOT EXISTS journal_at ON journal (at);
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  // Columns added after the first release.
  const columns = new Set((db.prepare("PRAGMA table_info(connections)").all() as { name: string }[]).map((c) => c.name));
  if (!columns.has("options")) db.exec("ALTER TABLE connections ADD COLUMN options TEXT");
  if (!columns.has("secretsEnc")) db.exec("ALTER TABLE connections ADD COLUMN secretsEnc TEXT");
  return db;
}

interface ConnectionOptions {
  sslMode?: SslMode;
  ssh?: SshTunnel | null;
}

function parseOptions(raw: string | null): ConnectionOptions {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ConnectionOptions;
  } catch {
    return {};
  }
}

function parseSecrets(enc: string | null): ConnectionSecrets {
  if (!enc) return {};
  try {
    return JSON.parse(decrypt(enc)) as ConnectionSecrets;
  } catch {
    return {};
  }
}

function sanitizeSsh(raw: unknown): SshTunnel | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const host = typeof s.host === "string" ? s.host.trim() : "";
  const user = typeof s.user === "string" ? s.user.trim() : "";
  if (!host || !user) throw new Error("Le tunnel SSH demande un hôte et un utilisateur");
  const port = Number(s.port ?? 22);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port SSH invalide");
  return { host, port, user, auth: s.auth === "key" ? "key" : "password" };
}

function sslModeOf(input: Partial<ConnectionInput>, fallback: SslMode): SslMode {
  if (input.sslMode && SSL_MODES.includes(input.sslMode)) return input.sslMode;
  if (input.ssl !== undefined) return input.ssl ? (fallback === "disable" ? "require" : fallback) : "disable";
  return fallback;
}

/** Applies secrets from an input over stored ones: undefined keeps, "" removes. */
export function mergeSecrets(stored: ConnectionSecrets, input: Partial<ConnectionSecrets>): ConnectionSecrets {
  const out: ConnectionSecrets = { ...stored };
  for (const field of SECRET_FIELDS) {
    const v = input[field];
    if (v === undefined) continue;
    if (v === "") delete out[field];
    else out[field] = v;
  }
  return out;
}

function encryptSecrets(secrets: ConnectionSecrets): string | null {
  return Object.keys(secrets).length > 0 ? encrypt(JSON.stringify(secrets)) : null;
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
  options: string | null;
  secretsEnc: string | null;
  createdAt: string;
}

function toPublic(row: ConnectionRow): Connection {
  const options = parseOptions(row.options);
  const sslMode: SslMode = options.sslMode ?? (row.ssl ? "require" : "disable");
  return {
    id: row.id,
    name: row.name,
    envType: row.envType as Connection["envType"],
    engine: row.engine as Connection["engine"],
    host: row.host ?? undefined,
    port: row.port ?? undefined,
    database: row.database,
    user: row.user ?? undefined,
    ssl: sslMode !== "disable",
    sslMode,
    ssh: options.ssh ?? null,
    storedSecrets: SECRET_FIELDS.filter((f) => parseSecrets(row.secretsEnc)[f]),
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

export type ConnectionWithSecrets = Connection & { password?: string; secrets: ConnectionSecrets };

export function getConnectionSecret(id: string): ConnectionWithSecrets | null {
  const row = getDb().prepare("SELECT * FROM connections WHERE id = ?").get(id) as
    | ConnectionRow
    | undefined;
  if (!row) return null;
  return {
    ...toPublic(row),
    password: row.passwordEnc ? decrypt(row.passwordEnc) : undefined,
    secrets: parseSecrets(row.secretsEnc),
  };
}

export function createConnection(input: ConnectionInput): Connection {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO connections (id, name, envType, engine, host, port, database, user, passwordEnc, ssl, options, secretsEnc, createdAt)
       VALUES (@id, @name, @envType, @engine, @host, @port, @database, @user, @passwordEnc, @ssl, @options, @secretsEnc, @createdAt)`
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
      ssl: sslModeOf(input, "disable") !== "disable" ? 1 : 0,
      options: JSON.stringify({ sslMode: sslModeOf(input, "disable"), ssh: sanitizeSsh(input.ssh) }),
      secretsEnc: encryptSecrets(mergeSecrets({}, input)),
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
    ssl: 0,
    options: existing.options,
    secretsEnc: encryptSecrets(mergeSecrets(parseSecrets(existing.secretsEnc), input)),
  };
  const oldOptions = parseOptions(existing.options);
  const sslMode = sslModeOf(input, oldOptions.sslMode ?? (existing.ssl ? "require" : "disable"));
  next.ssl = sslMode !== "disable" ? 1 : 0;
  next.options = JSON.stringify({ sslMode, ssh: input.ssh !== undefined ? sanitizeSsh(input.ssh) : oldOptions.ssh ?? null });
  getDb()
    .prepare(
      `UPDATE connections SET name=@name, envType=@envType, engine=@engine, host=@host, port=@port,
       database=@database, user=@user, passwordEnc=@passwordEnc, ssl=@ssl, options=@options, secretsEnc=@secretsEnc WHERE id=@id`
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

/**
 * Connection settings from a form that may be editing a saved connection: fields
 * left out (undefined) fall back to the saved ones, secrets included.
 */
export function resolveConnectionDraft(body: { id?: string } & Partial<ConnectionInput>): ConnectionWithSecrets {
  const stored = body.id ? getConnectionSecret(body.id) : null;
  if (body.id && !stored) throw new Error("Connexion introuvable");
  const pick = <K extends keyof ConnectionInput>(key: K) => (body[key] !== undefined ? body[key] : stored?.[key as keyof ConnectionWithSecrets]);
  const engine = pick("engine") as Connection["engine"] | undefined;
  const database = pick("database") as string | undefined;
  if (!engine || !database) throw new Error("engine et database sont requis");
  const sslMode = sslModeOf(body, stored?.sslMode ?? "disable");
  const ssh = body.ssh !== undefined ? sanitizeSsh(body.ssh) : stored?.ssh ?? null;
  // Saved credentials only go to the server they were saved for: a draft pointing
  // elsewhere has to provide its own, so they can't be sent to an arbitrary host.
  const sameTarget =
    !!stored &&
    (pick("host") ?? "") === (stored.host ?? "") &&
    (pick("port") ?? null) === (stored.port ?? null) &&
    (ssh?.host ?? "") === (stored.ssh?.host ?? "") &&
    (ssh?.port ?? null) === (stored.ssh?.port ?? null);
  const base = sameTarget && stored ? stored : null;
  return {
    id: stored?.id ?? "draft",
    name: (pick("name") as string | undefined) ?? "draft",
    envType: (pick("envType") as Connection["envType"] | undefined) ?? "local",
    engine,
    host: pick("host") as string | undefined,
    port: pick("port") as number | undefined,
    database,
    user: pick("user") as string | undefined,
    password: body.password !== undefined ? body.password || undefined : base?.password,
    ssl: sslMode !== "disable",
    sslMode,
    ssh,
    secrets: mergeSecrets(base?.secrets ?? {}, body),
    createdAt: stored?.createdAt ?? "",
  };
}
