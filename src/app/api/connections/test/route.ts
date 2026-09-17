import { resolveConnectionDraft } from "@/lib/store/metadata";
import { getAdapter, createAdHocAdapter } from "@/lib/db/registry";
import { errorResponse } from "@/lib/api/respond";
import type { ConnectionInput } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { id?: string } & Partial<ConnectionInput>;
    // Just an id: test the saved connection (and warm up its pool).
    if (body.id && Object.keys(body).length === 1) {
      await getAdapter(body.id).testConnection();
      return Response.json({ ok: true });
    }
    const adapter = await createAdHocAdapter(resolveConnectionDraft(body));
    try {
      await adapter.testConnection();
    } finally {
      await adapter.close().catch(() => {});
    }
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
