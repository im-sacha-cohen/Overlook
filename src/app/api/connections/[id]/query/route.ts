import { getAdapter } from "@/lib/db/registry";
import { getConnection } from "@/lib/store/metadata";
import { checkConfirm } from "@/lib/api/guard";
import { isReadOnlyStatement } from "@/lib/api/sql-guard";
import { errorResponse } from "@/lib/api/respond";
import { journaled } from "@/lib/api/journal";
import { recordQuery } from "@/lib/store/queries";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { sql: string; allowWrite?: boolean; confirm?: string };
    if (!body.sql || !body.sql.trim()) return errorResponse(new Error("Requête vide"));

    const readOnly = isReadOnlyStatement(body.sql);
    if (!readOnly) {
      if (!body.allowWrite) {
        return errorResponse(
          new Error("Cette requête n'est pas en lecture seule. Active « Autoriser les requêtes d'écriture »."),
          403
        );
      }
      const conn = getConnection(id);
      if (!conn) return errorResponse(new Error("Connexion introuvable"), 404);
      const guard = checkConfirm(conn, body.confirm);
      if (!guard.ok) return errorResponse(new Error(guard.error), 412);
    }

    const started = Date.now();
    try {
      const result = readOnly
        ? await getAdapter(id).runRawQuery(body.sql)
        : await journaled(request, id, { action: "query", sql: body.sql }, () => getAdapter(id).runRawQuery(body.sql), (r) => r.rowCount);
      recordQuery(id, { sql: body.sql, durationMs: Date.now() - started, rowCount: result.rowCount, error: null });
      return Response.json(result);
    } catch (err) {
      recordQuery(id, { sql: body.sql, durationMs: Date.now() - started, rowCount: null, error: err instanceof Error ? err.message || String(err) : String(err) });
      throw err;
    }
  } catch (err) {
    return errorResponse(err, 500);
  }
}
