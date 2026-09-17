import { deleteSavedQuery, updateSavedQuery } from "@/lib/store/queries";
import { errorResponse } from "@/lib/api/respond";

type Params = { params: Promise<{ id: string; queryId: string }> };

export async function PUT(request: Request, { params }: Params) {
  try {
    const { id, queryId } = await params;
    const body = (await request.json()) as { name?: unknown; sql?: unknown };
    const query = updateSavedQuery(id, queryId, body.name, body.sql);
    if (!query) return errorResponse(new Error("Requête introuvable"), 404);
    return Response.json({ query });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id, queryId } = await params;
    if (!deleteSavedQuery(id, queryId)) return errorResponse(new Error("Requête introuvable"), 404);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
