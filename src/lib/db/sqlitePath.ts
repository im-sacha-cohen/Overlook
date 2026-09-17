import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../store/paths";

// A SQLite "connection" is just a file path, so without limits it could open any
// SQLite file on the machine (other apps' data, browser cookies, Overlook's own
// metadata) or create files anywhere. Paths are kept inside allowed folders.

function realDir(dir: string): string {
  const resolved = path.resolve(dir);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function allowedSqliteDirs(): string[] {
  const configured = (process.env.OVERLOOK_SQLITE_DIRS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  return (configured.length > 0 ? configured : [process.cwd()]).map(realDir);
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * The real path of a SQLite file a connection may use, or an error saying why not.
 * Symlinks are resolved first, so a link inside an allowed folder can't point outside.
 */
export function resolveSqlitePath(file: string): string {
  if (!file || file.includes("\0")) throw new Error("Chemin de fichier SQLite invalide");
  if (file === ":memory:" || file.startsWith("file:")) throw new Error("Seuls les fichiers SQLite sur disque sont acceptés");
  const absolute = path.resolve(process.cwd(), file);
  let real: string;
  try {
    real = fs.realpathSync(absolute);
  } catch {
    // Not created yet: check the folder it would go in.
    real = path.join(realDir(path.dirname(absolute)), path.basename(absolute));
  }
  const metadataDir = realDir(dataDir());
  if (isInside(real, metadataDir)) throw new Error("Ce dossier contient les données internes d'Overlook et ne peut pas être ouvert comme base");
  const dirs = allowedSqliteDirs();
  if (!dirs.some((dir) => isInside(real, dir))) {
    throw new Error(`Fichier SQLite hors des dossiers autorisés (${dirs.join(", ")}). Ajoutez son dossier à OVERLOOK_SQLITE_DIRS.`);
  }
  return real;
}

/** Removes quoted strings, quoted identifiers and comments, so keywords inside them don't count. */
function codeOnly(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/`[^`]*`/g, "``")
    .replace(/\[[^\]]*\]/g, "[]");
}

/** Refuses statements that make SQLite read or write other files. */
export function assertNoFileAccess(sql: string): void {
  const code = codeOnly(sql).toLowerCase();
  if (/\b(attach|detach)\b/.test(code) || /\bvacuum\b[\s\S]*?\binto\b/.test(code)) {
    throw new Error("ATTACH, DETACH et VACUUM INTO sont désactivés : ils donnent accès à d'autres fichiers que la base ouverte");
  }
}
