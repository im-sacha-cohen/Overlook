import { getAdapter } from "@/lib/db/registry";
import { getConnection } from "@/lib/store/metadata";
import { checkConfirm } from "@/lib/api/guard";
import { errorResponse } from "@/lib/api/respond";

type Params = { params: Promise<{ id: string; table: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, table } = await params;
  try {
    const body = (await request.json()) as { pkColumn: string; ids: (string | number)[]; confirm?: string };
    if (!body.pkColumn || !Array.isArray(body.ids) || body.ids.length === 0) {
      return errorResponse(new Error("pkColumn et ids sont requis"));
    }
    const conn = getConnection(id);
    if (!conn) return errorResponse(new Error("Connexion introuvable"), 404);
    const guard = checkConfirm(conn, body.confirm);
    if (!guard.ok) return errorResponse(new Error(guard.error), 412);
    const deleted = await getAdapter(id).deleteRows(decodeURIComponent(table), body.pkColumn, body.ids);
    return Response.json({ deleted });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
