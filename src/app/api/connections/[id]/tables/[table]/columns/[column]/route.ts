import { getAdapter } from "@/lib/db/registry";
import { getConnection } from "@/lib/store/metadata";
import { checkConfirm } from "@/lib/api/guard";
import { errorResponse } from "@/lib/api/respond";
import type { LogicalType } from "@/lib/types";

type Params = { params: Promise<{ id: string; table: string; column: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id, table, column } = await params;
  try {
    const body = (await request.json()) as { newName?: string; type?: LogicalType; confirm?: string };
    const conn = getConnection(id);
    if (!conn) return errorResponse(new Error("Connexion introuvable"), 404);

    if (body.newName) {
      await getAdapter(id).renameColumn(decodeURIComponent(table), decodeURIComponent(column), body.newName);
    }
    if (body.type) {
      const guard = checkConfirm(conn, body.confirm);
      if (!guard.ok) return errorResponse(new Error(guard.error), 412);
      await getAdapter(id).changeColumnType(decodeURIComponent(table), decodeURIComponent(column), body.type);
    }
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err, 500);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, table, column } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as { confirm?: string };
    const conn = getConnection(id);
    if (!conn) return errorResponse(new Error("Connexion introuvable"), 404);
    const guard = checkConfirm(conn, body.confirm);
    if (!guard.ok) return errorResponse(new Error(guard.error), 412);
    await getAdapter(id).dropColumn(decodeURIComponent(table), decodeURIComponent(column));
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
