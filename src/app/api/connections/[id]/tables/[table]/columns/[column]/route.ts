import { getAdapter } from "@/lib/db/registry";
import { getConnection } from "@/lib/store/metadata";
import { checkConfirm } from "@/lib/api/guard";
import { errorResponse } from "@/lib/api/respond";
import { journaled, describeOp } from "@/lib/api/journal";
import type { LogicalType } from "@/lib/types";

type Params = { params: Promise<{ id: string; table: string; column: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id, table, column } = await params;
  try {
    const body = (await request.json()) as { newName?: string; type?: LogicalType; confirm?: string };
    const conn = getConnection(id);
    if (!conn) return errorResponse(new Error("Connexion introuvable"), 404);

    const tableName = decodeURIComponent(table);
    const columnName = decodeURIComponent(column);
    if (body.newName) {
      const newName = body.newName;
      await journaled(
        request,
        id,
        async () => ({ action: "renameColumn", tableName, sql: await describeOp(id, { kind: "renameColumn", table: tableName, oldName: columnName, newName }) }),
        () => getAdapter(id).renameColumn(tableName, columnName, newName),
      );
    }
    if (body.type) {
      const guard = checkConfirm(conn, body.confirm);
      if (!guard.ok) return errorResponse(new Error(guard.error), 412);
      const type = body.type;
      await journaled(
        request,
        id,
        async () => ({ action: "changeColumnType", tableName, sql: await describeOp(id, { kind: "changeColumnType", table: tableName, column: columnName, type }) }),
        () => getAdapter(id).changeColumnType(tableName, columnName, type),
      );
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
    const tableName = decodeURIComponent(table);
    const columnName = decodeURIComponent(column);
    await journaled(
      request,
      id,
      async () => ({ action: "dropColumn", tableName, sql: await describeOp(id, { kind: "dropColumn", table: tableName, column: columnName }) }),
      () => getAdapter(id).dropColumn(tableName, columnName),
    );
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
