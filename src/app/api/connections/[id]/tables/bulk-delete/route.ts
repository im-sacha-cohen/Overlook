import { getAdapter } from "@/lib/db/registry";
import { getConnection } from "@/lib/store/metadata";
import { checkConfirm } from "@/lib/api/guard";
import { errorResponse } from "@/lib/api/respond";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { names: string[]; confirm?: string };
    if (!Array.isArray(body.names) || body.names.length === 0) {
      return errorResponse(new Error("names est requis"));
    }
    const conn = getConnection(id);
    if (!conn) return errorResponse(new Error("Connexion introuvable"), 404);
    const guard = checkConfirm(conn, body.confirm);
    if (!guard.ok) return errorResponse(new Error(guard.error), 412);
    const adapter = getAdapter(id);
    for (const name of body.names) {
      await adapter.dropTable(name);
    }
    return Response.json({ dropped: body.names.length });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
