import { getConnection, updateConnection, deleteConnection } from "@/lib/store/metadata";
import { invalidateConnection } from "@/lib/db/registry";
import { errorResponse } from "@/lib/api/respond";
import type { ConnectionInput } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const conn = getConnection(id);
  if (!conn) return errorResponse(new Error("Connexion introuvable"), 404);
  return Response.json({ connection: conn });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = (await request.json()) as Partial<ConnectionInput>;
    const conn = updateConnection(id, body);
    if (!conn) return errorResponse(new Error("Connexion introuvable"), 404);
    invalidateConnection(id);
    return Response.json({ connection: conn });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  invalidateConnection(id);
  deleteConnection(id);
  return Response.json({ ok: true });
}
