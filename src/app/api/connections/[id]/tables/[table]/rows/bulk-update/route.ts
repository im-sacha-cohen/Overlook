import { getAdapter } from "@/lib/db/registry";
import { getConnection } from "@/lib/store/metadata";
import { checkConfirm } from "@/lib/api/guard";
import { errorResponse } from "@/lib/api/respond";
import { journaled, describeOp, beforeRows } from "@/lib/api/journal";
import type { Row } from "@/lib/types";

type Params = { params: Promise<{ id: string; table: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, table } = await params;
  try {
    const body = (await request.json()) as { pkColumn: string; ids: (string | number)[]; values: Row; confirm?: string };
    if (!body.pkColumn || !Array.isArray(body.ids) || body.ids.length === 0 || !body.values) {
      return errorResponse(new Error("pkColumn, ids et values sont requis"));
    }
    const conn = getConnection(id);
    if (!conn) return errorResponse(new Error("Connexion introuvable"), 404);
    const guard = checkConfirm(conn, body.confirm);
    if (!guard.ok) return errorResponse(new Error(guard.error), 412);
    const tableName = decodeURIComponent(table);
    const updated = await journaled(
      request,
      id,
      async () => ({
        action: "updateRows",
        tableName,
        sql: await describeOp(id, { kind: "updateRows", table: tableName, pkColumn: body.pkColumn, pkValues: body.ids, values: body.values }),
        details: { ...(await beforeRows(id, tableName, body.pkColumn, body.ids, Object.keys(body.values))), after: [body.values] },
      }),
      () => getAdapter(id).updateRows(tableName, body.pkColumn, body.ids, body.values),
      (n) => n,
    );
    return Response.json({ updated });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
