import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";

const ALGO = "aes-256-gcm";

function loadOrCreateKey(): Buffer {
  const fromEnv = process.env.APP_SECRET;
  if (fromEnv && fromEnv.length > 0) {
    return crypto.createHash("sha256").update(fromEnv).digest();
  }
  const keyPath = path.join(dataDir(), "secret.key");
  if (fs.existsSync(keyPath)) {
    return Buffer.from(fs.readFileSync(keyPath, "utf8"), "hex");
  }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, key.toString("hex"), { mode: 0o600 });
  return key;
}

let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (!cachedKey) cachedKey = loadOrCreateKey();
  return cachedKey;
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), enc.toString("base64"), authTag.toString("base64")].join(".");
}

export function decrypt(ciphertext: string): string {
  const [ivB64, encB64, tagB64] = ciphertext.split(".");
  if (!ivB64 || !encB64 || !tagB64) throw new Error("Malformed ciphertext");
  const iv = Buffer.from(ivB64, "base64");
  const enc = Buffer.from(encB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
