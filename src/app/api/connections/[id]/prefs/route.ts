import { getConnection } from "@/lib/store/metadata";
import { getConnectionPrefs, listTablePrefs, saveConnectionPrefs, saveTablePrefs } from "@/lib/store/prefs";
import { errorResponse } from "@/lib/api/respond";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!getConnection(id)) return errorResponse(new Error("Connexion introuvable"), 404);
    return Response.json({ connection: getConnectionPrefs(id), tables: listTablePrefs(id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!getConnection(id)) return errorResponse(new Error("Connexion introuvable"), 404);
    const body = (await request.json()) as { table?: unknown; prefs?: unknown };
    // No table name → the preferences apply to the whole connection.
    if (body.table === undefined || body.table === null) return Response.json({ connection: saveConnectionPrefs(id, body.prefs) });
    if (typeof body.table !== "string" || !body.table) return errorResponse(new Error("table doit être un nom de table"));
    return Response.json({ tables: { [body.table]: saveTablePrefs(id, body.table, body.prefs) } });
  } catch (err) {
    return errorResponse(err);
  }
}
