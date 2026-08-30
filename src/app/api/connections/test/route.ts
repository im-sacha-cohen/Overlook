import { getConnectionSecret } from "@/lib/store/metadata";
import { getAdapter, createAdHocAdapter } from "@/lib/db/registry";
import { errorResponse } from "@/lib/api/respond";
import type { ConnectionInput } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { id?: string } & Partial<ConnectionInput>;
    if (body.id) {
      const conn = getConnectionSecret(body.id);
      if (!conn) return errorResponse(new Error("Connexion introuvable"), 404);
      await getAdapter(body.id).testConnection();
      return Response.json({ ok: true });
    }
    if (!body.engine || !body.database) {
      return errorResponse(new Error("engine et database sont requis"));
    }
    const adapter = await createAdHocAdapter({
      engine: body.engine,
      host: body.host,
      port: body.port,
      database: body.database,
      user: body.user,
      password: body.password,
      ssl: body.ssl,
    });
    try {
      await adapter.testConnection();
    } finally {
      await adapter.close();
    }
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
