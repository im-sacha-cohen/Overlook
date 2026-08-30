import type { Connection } from "../types";

export function requiresGuard(conn: Connection): boolean {
  return conn.envType === "prod";
}

export function checkConfirm(conn: Connection, confirm: unknown): { ok: true } | { ok: false; error: string } {
  if (!requiresGuard(conn)) return { ok: true };
  if (typeof confirm !== "string" || confirm !== conn.name) {
    return {
      ok: false,
      error: `Connexion de production : renvoyez confirm="${conn.name}" pour confirmer cette action.`,
    };
  }
  return { ok: true };
}
