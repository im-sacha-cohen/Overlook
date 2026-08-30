import { getAdapter } from "@/lib/db/registry";
import { errorResponse } from "@/lib/api/respond";
import type { LogicalType } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const tables = await getAdapter(id).listTables();
    return Response.json({ tables });
  } catch (err) {
    return errorResponse(err, 500);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { name: string; columns?: { name: string; type: LogicalType }[] };
    if (!body.name || !body.name.trim()) return errorResponse(new Error("Nom de table requis"));
    await getAdapter(id).createTable(body.name, body.columns ?? []);
    return Response.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
