import { getAdapter } from "@/lib/db/registry";
import { getConnection } from "@/lib/store/metadata";
import { checkConfirm } from "@/lib/api/guard";
import { errorResponse } from "@/lib/api/respond";

type Params = { params: Promise<{ id: string; table: string }> };

export async function DELETE(request: Request, { params }: Params) {
  const { id, table } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as { confirm?: string };
    const conn = getConnection(id);
    if (!conn) return errorResponse(new Error("Connexion introuvable"), 404);
    const guard = checkConfirm(conn, body.confirm);
    if (!guard.ok) return errorResponse(new Error(guard.error), 412);
    await getAdapter(id).dropTable(decodeURIComponent(table));
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
