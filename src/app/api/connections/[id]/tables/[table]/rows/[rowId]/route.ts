import { getAdapter } from "@/lib/db/registry";
import { getConnection } from "@/lib/store/metadata";
import { checkConfirm } from "@/lib/api/guard";
import { errorResponse } from "@/lib/api/respond";
import { journaled, describeOp, beforeRows } from "@/lib/api/journal";
import type { Row } from "@/lib/types";

type Params = { params: Promise<{ id: string; table: string; rowId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id, table, rowId } = await params;
  try {
    const body = (await request.json()) as { pkColumn: string; values: Row };
    if (!body.pkColumn) return errorResponse(new Error("pkColumn requis"));
    const tableName = decodeURIComponent(table);
    await journaled(
      request,
      id,
      async () => ({
        action: "updateRow",
        tableName,
        sql: await describeOp(id, { kind: "updateRows", table: tableName, pkColumn: body.pkColumn, pkValues: [rowId], values: body.values }),
        details: { ...(await beforeRows(id, tableName, body.pkColumn, [rowId], Object.keys(body.values))), after: [{ [body.pkColumn]: rowId, ...body.values }] },
      }),
      () => getAdapter(id).updateRow(tableName, body.pkColumn, rowId, body.values),
      () => 1,
    );
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err, 500);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, table, rowId } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as { pkColumn?: string; confirm?: string };
    if (!body.pkColumn) return errorResponse(new Error("pkColumn requis"));
    const conn = getConnection(id);
    if (!conn) return errorResponse(new Error("Connexion introuvable"), 404);
    const guard = checkConfirm(conn, body.confirm);
    if (!guard.ok) return errorResponse(new Error(guard.error), 412);
    const tableName = decodeURIComponent(table);
    const pkColumn = body.pkColumn;
    await journaled(
      request,
      id,
      async () => ({
        action: "deleteRows",
        tableName,
        sql: await describeOp(id, { kind: "deleteRows", table: tableName, pkColumn, pkValues: [rowId] }),
        details: await beforeRows(id, tableName, pkColumn, [rowId]),
      }),
      () => getAdapter(id).deleteRow(tableName, pkColumn, rowId),
      () => 1,
    );
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
