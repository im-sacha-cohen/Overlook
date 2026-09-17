import { getConnection } from "@/lib/store/metadata";
import { listQueryHistory } from "@/lib/store/queries";
import { errorResponse } from "@/lib/api/respond";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!getConnection(id)) return errorResponse(new Error("Connexion introuvable"), 404);
    return Response.json({ entries: listQueryHistory(id) });
  } catch (err) {
    return errorResponse(err);
  }
}
