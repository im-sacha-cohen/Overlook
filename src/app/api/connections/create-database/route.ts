import { createDatabase } from "@/lib/db/databaseAdmin";
import { errorResponse } from "@/lib/api/respond";
import type { Engine } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      engine: Engine;
      host?: string;
      port?: number;
      user?: string;
      password?: string;
      ssl?: boolean;
      database: string;
    };
    if (!body.engine || !body.database) return errorResponse(new Error("engine et database sont requis"));
    await createDatabase(body);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
