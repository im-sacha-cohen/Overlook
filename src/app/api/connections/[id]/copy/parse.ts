import { CONFLICT_MODES, type ConflictMode } from "@/lib/db/adapter";
import { getConnection } from "@/lib/store/metadata";
import { errorResponse } from "@/lib/api/respond";
import { RELATION_MODES, type CopyPlan, type RelationMode } from "@/lib/api/copyRows";
import type { Connection } from "@/lib/types";

const MAX_IDS = 50_000;

function names(v: unknown): string[] | null {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x) ? (v as string[]) : null;
}

/** The body of a copy or of its analysis: source, target and what to copy, checked. */
export async function parseCopyRequest(
  sourceId: string,
  raw: unknown,
): Promise<{ error: Response } | { source: Connection; target: Connection; plan: CopyPlan; confirm: unknown }> {
  const body = (raw ?? {}) as { target?: unknown; tables?: unknown; ids?: unknown; onConflict?: unknown; emptyFirst?: unknown; emptyAlso?: unknown; relations?: unknown; confirm?: unknown };
  const source = getConnection(sourceId);
  if (!source) return { error: errorResponse(new Error("Connexion introuvable"), 404) };
  const target = typeof body.target === "string" ? getConnection(body.target) : null;
  if (!target) return { error: errorResponse(new Error("Connexion cible introuvable"), 404) };
  if (target.id === source.id) return { error: errorResponse(new Error("La cible doit être une autre connexion")) };
  const tables = names(body.tables);
  if (!tables) return { error: errorResponse(new Error("tables est requis")) };
  const ids = body.ids === undefined ? undefined : Array.isArray(body.ids) ? body.ids.map(String) : null;
  if (ids === null || (ids && (ids.length === 0 || ids.length > MAX_IDS))) return { error: errorResponse(new Error("ids doit être une liste de clés")) };
  const onConflict: ConflictMode = CONFLICT_MODES.includes(body.onConflict as ConflictMode) ? (body.onConflict as ConflictMode) : "error";
  const relations: RelationMode = RELATION_MODES.includes(body.relations as RelationMode) ? (body.relations as RelationMode) : "skip";
  const emptyAlso = body.emptyAlso === undefined ? [] : names(body.emptyAlso);
  if (emptyAlso === null) return { error: errorResponse(new Error("emptyAlso doit être une liste de tables")) };
  return { source, target, plan: { tables, ids, onConflict, emptyFirst: body.emptyFirst === true, emptyAlso, relations }, confirm: body.confirm };
}
