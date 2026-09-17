import { getAdapter } from "@/lib/db/registry";
import { isReadOnlyViolation } from "@/lib/db/adapter";
import { getConnection } from "@/lib/store/metadata";
import { checkConfirm } from "@/lib/api/guard";
import { errorResponse } from "@/lib/api/respond";
import { journaled } from "@/lib/api/journal";
import { recordQuery } from "@/lib/store/queries";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { sql: string; allowWrite?: boolean; confirm?: string };
    if (!body.sql || !body.sql.trim()) return errorResponse(new Error("Requête vide"));
    const conn = getConnection(id);
    if (!conn) return errorResponse(new Error("Connexion introuvable"), 404);
    const adapter = getAdapter(id);
    const started = Date.now();
    const remember = (rowCount: number | null, error: unknown) =>
      recordQuery(id, {
        sql: body.sql,
        durationMs: Date.now() - started,
        rowCount,
        error: error ? (error instanceof Error ? error.message || String(error) : String(error)) : null,
      });

    // Every query first runs read-only, enforced by the database: guessing from
    // the first keyword let "SELECT 1; DROP TABLE t" or a data-modifying WITH through.
    try {
      const result = await adapter.runRawQuery(body.sql, { readOnly: true });
      remember(result.rowCount, null);
      return Response.json(result);
    } catch (err) {
      if (!isReadOnlyViolation(err)) {
        remember(null, err);
        throw err;
      }
    }

    // It writes (or holds several statements): only on request, confirmed on production, journaled.
    if (!body.allowWrite) {
      return errorResponse(
        new Error("Cette requête modifie la base ou contient plusieurs instructions. Active « Autoriser les requêtes d'écriture » pour l'exécuter."),
        403
      );
    }
    const guard = checkConfirm(conn, body.confirm);
    if (!guard.ok) return errorResponse(new Error(guard.error), 412);
    try {
      const result = await journaled(request, id, { action: "query", sql: body.sql }, () => adapter.runRawQuery(body.sql), (r) => r.rowCount);
      remember(result.rowCount, null);
      return Response.json({ ...result, wrote: true });
    } catch (err) {
      remember(null, err);
      throw err;
    }
  } catch (err) {
    return errorResponse(err, 500);
  }
}
