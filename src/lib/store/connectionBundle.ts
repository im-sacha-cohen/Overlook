import crypto from "node:crypto";
import { BUNDLE_FORMAT, BUNDLE_VERSION, MIN_PASSPHRASE_LENGTH, type BundleEncryption, type ConnectionBundle } from "../connectionBundle";
import type { Connection, ConnectionSecrets } from "../types";
import { decryptWithKey, encryptWithKey } from "./crypto";
import { createConnection, createConnectionFolder, deleteAllConnections, getConnectionSecret, getDb, listConnections } from "./metadata";
import { resolveSqlitePath } from "../db/sqlitePath";
import { getConnectionPrefs, listTablePrefs, replaceTablePrefs, saveConnectionPrefs } from "./prefs";

// ~32 MiB of memory and ~100 ms per derivation: slow enough to make offline
// guessing of the passphrase expensive, fast enough for an interactive export.
const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1 };

function deriveKey(passphrase: string, enc: BundleEncryption): Buffer {
  return crypto.scryptSync(passphrase, Buffer.from(enc.salt, "base64"), 32, {
    N: enc.N,
    r: enc.r,
    p: enc.p,
    maxmem: 128 * enc.N * enc.r * 2,
  });
}

function checkPassphrase(passphrase: unknown): string {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`La phrase de passe doit faire au moins ${MIN_PASSPHRASE_LENGTH} caractères`);
  }
  return passphrase;
}

// passphrase === null → export without passwords.
export function buildBundle(ids: string[], passphrase: string | null): ConnectionBundle {
  const wanted = new Set(ids);
  const conns = listConnections().filter((c) => wanted.has(c.id));
  if (conns.length === 0) throw new Error("Aucune connexion sélectionnée");

  let encryption: BundleEncryption | null = null;
  let key: Buffer | null = null;
  if (passphrase !== null) {
    encryption = { kdf: "scrypt", salt: crypto.randomBytes(16).toString("base64"), ...SCRYPT_PARAMS };
    key = deriveKey(checkPassphrase(passphrase), encryption);
  }

  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    encryption,
    connections: conns.map((c) => {
      const full = key ? getConnectionSecret(c.id) : null;
      const password = full?.password;
      const secrets = full && Object.keys(full.secrets).length > 0 ? JSON.stringify(full.secrets) : undefined;
      const prefs = listTablePrefs(c.id);
      const connectionPrefs = getConnectionPrefs(c.id);
      return {
        name: c.name,
        envType: c.envType,
        engine: c.engine,
        host: c.host,
        port: c.port,
        database: c.database,
        user: c.user,
        ssl: !!c.ssl,
        sslMode: c.sslMode,
        ssh: c.ssh ?? undefined,
        folder: c.folder,
        password: key && password ? encryptWithKey(password, key) : undefined,
        secrets: key && secrets ? encryptWithKey(secrets, key) : undefined,
        prefs: Object.keys(prefs).length > 0 ? prefs : undefined,
        connectionPrefs: connectionPrefs.autoRefresh ? connectionPrefs : undefined,
      };
    }),
  };
}

function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}

// replaceAll: every connection and folder configured here is deleted first, so the
// file's selection becomes the whole list. All or nothing: a failure keeps the old list.
export function importBundle(bundle: ConnectionBundle, indices: number[], passphrase: unknown, replaceAll = false): Connection[] {
  const picked = [...new Set(indices)].filter((i) => Number.isInteger(i) && i >= 0 && i < bundle.connections.length).map((i) => bundle.connections[i]);
  if (picked.length === 0) throw new Error("Aucune connexion sélectionnée");

  // Check paths and decrypt everything before writing anything, so a bad file imports nothing.
  for (const c of picked) if (c.engine === "sqlite") resolveSqlitePath(c.database);
  let key: Buffer | null = null;
  if (bundle.encryption && picked.some((c) => c.password || c.secrets)) key = deriveKey(checkPassphrase(passphrase), bundle.encryption);
  const open = (cipher: string | undefined) => {
    if (!cipher || !key) return undefined;
    try {
      return decryptWithKey(cipher, key);
    } catch {
      throw new Error("Phrase de passe incorrecte");
    }
  };
  const passwords = picked.map((c) => open(c.password));
  const secrets = picked.map((c) => {
    const json = open(c.secrets);
    if (!json) return {};
    try {
      return JSON.parse(json) as ConnectionSecrets;
    } catch {
      return {};
    }
  });

  return getDb().transaction(() => {
    if (replaceAll) {
      deleteAllConnections();
      // Keep the folders in the file's order rather than alphabetical.
      for (const folder of new Set(picked.map((c) => c.folder).filter((f): f is string => !!f))) createConnectionFolder(folder);
    }
    const taken = new Set(listConnections().map((c) => c.name));
    return picked.map((c, i) => {
      const name = uniqueName(c.name, taken);
      taken.add(name);
      const created = createConnection({
        name,
        envType: c.envType,
        engine: c.engine,
        host: c.host,
        port: c.port,
        database: c.database,
        user: c.user,
        ssl: c.ssl,
        sslMode: c.sslMode,
        ssh: c.ssh ?? null,
        folder: c.folder,
        password: passwords[i],
        ...secrets[i],
      });
      if (c.prefs) replaceTablePrefs(created.id, c.prefs);
      if (c.connectionPrefs) saveConnectionPrefs(created.id, c.connectionPrefs);
      return created;
    });
  })();
}
