// Portable file format for moving saved connections between Overlook instances.
// Shared by the client (file preview) and the server (export/import routes).
import { SSL_MODES, type Engine, type EnvType, type SshTunnel, type SslMode } from "./types";
import { sanitizeConnectionPrefs, sanitizeTablePrefs, type ConnectionPrefs, type TablePrefs } from "./prefs";

export const BUNDLE_FORMAT = "overlook-connections";
export const BUNDLE_VERSION = 1;
export const MIN_PASSPHRASE_LENGTH = 8;

export interface BundleConnection {
  name: string;
  envType: EnvType;
  engine: Engine;
  host?: string;
  port?: number;
  database: string;
  user?: string;
  ssl: boolean;
  sslMode?: SslMode;
  ssh?: SshTunnel;
  // AES-256-GCM ciphertext under the bundle's passphrase-derived key — never the instance key.
  password?: string;
  // Same encryption: JSON of the SSH/TLS secrets (keys, certificates, SSH password).
  secrets?: string;
  // Per-table view preferences (filters, sorts, column layout…), keyed by table name.
  prefs?: Record<string, TablePrefs>;
  // Connection-level preferences (auto-refresh…).
  connectionPrefs?: ConnectionPrefs;
}

export interface BundleEncryption {
  kdf: "scrypt";
  salt: string;
  N: number;
  r: number;
  p: number;
}

export interface ConnectionBundle {
  format: typeof BUNDLE_FORMAT;
  version: typeof BUNDLE_VERSION;
  exportedAt: string;
  // null when the file was exported without passwords.
  encryption: BundleEncryption | null;
  connections: BundleConnection[];
}

export type BundleErrorCode = "invalidFile" | "unsupportedVersion";

export class BundleError extends Error {
  constructor(public code: BundleErrorCode, message: string) {
    super(message);
  }
}

const ENGINES: Engine[] = ["postgres", "mysql", "sqlite"];
const ENV_TYPES: EnvType[] = ["local", "dev", "staging", "prod", "custom"];

function optionalString(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function sanitizePrefsMap(raw: unknown): Record<string, TablePrefs> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, TablePrefs> = {};
  for (const [table, prefs] of Object.entries(raw as Record<string, unknown>).slice(0, 500)) out[table.slice(0, 200)] = sanitizeTablePrefs(prefs);
  return Object.keys(out).length > 0 ? out : undefined;
}

export function parseBundle(raw: unknown): ConnectionBundle {
  const invalid = (detail: string) => new BundleError("invalidFile", `Fichier de connexions invalide : ${detail}`);
  if (!raw || typeof raw !== "object") throw invalid("pas un objet JSON");
  const b = raw as Record<string, unknown>;
  if (b.format !== BUNDLE_FORMAT) throw invalid("ce n'est pas un export de connexions Overlook");
  if (b.version !== BUNDLE_VERSION) throw new BundleError("unsupportedVersion", `Version de fichier non prise en charge : ${String(b.version)}`);
  if (!Array.isArray(b.connections)) throw invalid("liste de connexions manquante");

  let encryption: BundleEncryption | null = null;
  if (b.encryption !== null && b.encryption !== undefined) {
    const e = b.encryption as Record<string, unknown>;
    const int = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max;
    // Bounds keep a crafted file from making the server allocate gigabytes during key derivation.
    if (e.kdf !== "scrypt" || typeof e.salt !== "string" || !int(e.N, 2 ** 20) || !int(e.r, 16) || !int(e.p, 4)) {
      throw invalid("paramètres de chiffrement invalides");
    }
    encryption = { kdf: "scrypt", salt: e.salt, N: e.N, r: e.r, p: e.p };
  }

  const connections = b.connections.map((item, i): BundleConnection => {
    const c = (item ?? {}) as Record<string, unknown>;
    const where = `connexion n°${i + 1}`;
    if (typeof c.name !== "string" || !c.name.trim()) throw invalid(`${where} sans nom`);
    if (!ENGINES.includes(c.engine as Engine)) throw invalid(`${where} : moteur inconnu`);
    if (!ENV_TYPES.includes(c.envType as EnvType)) throw invalid(`${where} : environnement inconnu`);
    if (typeof c.database !== "string" || !c.database) throw invalid(`${where} sans base de données`);
    if (c.port !== undefined && c.port !== null && (typeof c.port !== "number" || !Number.isInteger(c.port))) throw invalid(`${where} : port invalide`);
    const password = optionalString(c.password);
    if (password && !encryption) throw invalid(`${where} : mot de passe présent sans chiffrement`);
    const secrets = optionalString(c.secrets);
    if (secrets && !encryption) throw invalid(`${where} : secrets présents sans chiffrement`);
    const rawSsh = (c.ssh ?? null) as Record<string, unknown> | null;
    const ssh =
      rawSsh && typeof rawSsh.host === "string" && typeof rawSsh.user === "string"
        ? { host: rawSsh.host, user: rawSsh.user, port: Number.isInteger(rawSsh.port) ? (rawSsh.port as number) : 22, auth: rawSsh.auth === "key" ? ("key" as const) : ("password" as const) }
        : undefined;
    return {
      name: c.name.trim(),
      envType: c.envType as EnvType,
      engine: c.engine as Engine,
      host: optionalString(c.host),
      port: typeof c.port === "number" ? c.port : undefined,
      database: c.database,
      user: optionalString(c.user),
      ssl: c.ssl === true,
      sslMode: SSL_MODES.includes(c.sslMode as SslMode) ? (c.sslMode as SslMode) : undefined,
      ssh,
      password,
      secrets,
      prefs: sanitizePrefsMap(c.prefs),
      connectionPrefs: c.connectionPrefs ? sanitizeConnectionPrefs(c.connectionPrefs) : undefined,
    };
  });

  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: typeof b.exportedAt === "string" ? b.exportedAt : "",
    encryption,
    connections,
  };
}

// Two connections pointing at the same database as the same user are duplicates,
// whatever their display name.
export function connectionFingerprint(c: { engine: string; host?: string; port?: number; database: string; user?: string }): string {
  return [c.engine, (c.host ?? "").toLowerCase(), c.port ?? "", c.database, c.user ?? ""].join("|");
}
