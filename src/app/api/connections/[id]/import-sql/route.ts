import { getAdapter } from "@/lib/db/registry";
import { getConnection } from "@/lib/store/metadata";
import { checkConfirm } from "@/lib/api/guard";
import { errorResponse } from "@/lib/api/respond";
import { startSqlImport } from "@/lib/api/sqlImports";

type Params = { params: Promise<{ id: string }> };

// Starts a SQL import. The script itself follows in pieces, sent to ./[importId].
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { fileName?: unknown; confirm?: string };
    const conn = getConnection(id);
    if (!conn) return errorResponse(new Error("Connexion introuvable"), 404);
    const guard = checkConfirm(conn, body.confirm);
    if (!guard.ok) return errorResponse(new Error(guard.error), 412);

    // Opened now, so an unreachable database fails here rather than on the first piece.
    const session = await getAdapter(id).openScriptSession();
    const fileName = typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim().slice(0, 255) : null;
    const imp = startSqlImport(id, session, request, fileName);
    return Response.json({ importId: imp.id });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
