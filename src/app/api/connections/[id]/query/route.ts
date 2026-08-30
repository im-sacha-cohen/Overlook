import { getAdapter } from "@/lib/db/registry";
import { getConnection } from "@/lib/store/metadata";
import { checkConfirm } from "@/lib/api/guard";
import { isReadOnlyStatement } from "@/lib/api/sql-guard";
import { errorResponse } from "@/lib/api/respond";

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

    const result = await getAdapter(id).runRawQuery(body.sql);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err, 500);
  }
}
