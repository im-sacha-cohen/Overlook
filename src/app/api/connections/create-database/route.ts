import { createDatabase } from "@/lib/db/databaseAdmin";
import { resolveConnectionDraft } from "@/lib/store/metadata";
import { errorResponse } from "@/lib/api/respond";
import type { ConnectionInput } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { id?: string } & Partial<ConnectionInput>;
    await createDatabase(resolveConnectionDraft(body));
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
