import crypto from "node:crypto";
import { BUNDLE_FORMAT, BUNDLE_VERSION, MIN_PASSPHRASE_LENGTH, type BundleEncryption, type ConnectionBundle } from "../connectionBundle";
import type { Connection } from "../types";
import { decryptWithKey, encryptWithKey } from "./crypto";
import { createConnection, getConnectionSecret, listConnections } from "./metadata";
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
      const password = key ? getConnectionSecret(c.id)?.password : undefined;
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
        password: key && password ? encryptWithKey(password, key) : undefined,
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

export function importBundle(bundle: ConnectionBundle, indices: number[], passphrase: unknown): Connection[] {
  const picked = [...new Set(indices)].filter((i) => Number.isInteger(i) && i >= 0 && i < bundle.connections.length).map((i) => bundle.connections[i]);
  if (picked.length === 0) throw new Error("Aucune connexion sélectionnée");

  // Decrypt everything before writing anything, so a wrong passphrase imports nothing.
  let key: Buffer | null = null;
  if (bundle.encryption && picked.some((c) => c.password)) key = deriveKey(checkPassphrase(passphrase), bundle.encryption);
  const passwords = picked.map((c) => {
    if (!c.password || !key) return undefined;
    try {
      return decryptWithKey(c.password, key);
    } catch {
      throw new Error("Phrase de passe incorrecte");
    }
  });

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
      password: passwords[i],
    });
    if (c.prefs) replaceTablePrefs(created.id, c.prefs);
    if (c.connectionPrefs) saveConnectionPrefs(created.id, c.connectionPrefs);
    return created;
  });
}
