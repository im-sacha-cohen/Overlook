import { getAdapter } from "@/lib/db/registry";
import { getConnection } from "@/lib/store/metadata";
import { checkConfirm } from "@/lib/api/guard";
import { errorResponse } from "@/lib/api/respond";
import type { Row } from "@/lib/types";

type Params = { params: Promise<{ id: string; table: string; rowId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id, table, rowId } = await params;
  try {
    const body = (await request.json()) as { pkColumn: string; values: Row };
    if (!body.pkColumn) return errorResponse(new Error("pkColumn requis"));
    await getAdapter(id).updateRow(decodeURIComponent(table), body.pkColumn, rowId, body.values);
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
    await getAdapter(id).deleteRow(decodeURIComponent(table), body.pkColumn, rowId);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
