import { getConnection } from "@/lib/store/metadata";
import { createSavedQuery, listSavedQueries } from "@/lib/store/queries";
import { errorResponse } from "@/lib/api/respond";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    if (!getConnection(id)) return errorResponse(new Error("Connexion introuvable"), 404);
    return Response.json({ queries: listSavedQueries(id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    if (!getConnection(id)) return errorResponse(new Error("Connexion introuvable"), 404);
    const body = (await request.json()) as { name?: unknown; sql?: unknown };
    return Response.json({ query: createSavedQuery(id, body.name, body.sql) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
