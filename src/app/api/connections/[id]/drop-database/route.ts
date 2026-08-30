import { getConnectionSecret, deleteConnection } from "@/lib/store/metadata";
import { invalidateConnection } from "@/lib/db/registry";
import { dropDatabase } from "@/lib/db/databaseAdmin";
import { errorResponse } from "@/lib/api/respond";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as { confirm?: string };
    const conn = getConnectionSecret(id);
    if (!conn) return errorResponse(new Error("Connexion introuvable"), 404);
    if (body.confirm !== conn.database) {
      return errorResponse(
        new Error(`Suppression de base de données : renvoyez confirm="${conn.database}" pour confirmer.`),
        412
      );
    }
    invalidateConnection(id);
    await dropDatabase(conn);
    deleteConnection(id);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
