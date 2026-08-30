import { getAdapter } from "@/lib/db/registry";
import { errorResponse } from "@/lib/api/respond";
import type { LogicalType } from "@/lib/types";

type Params = { params: Promise<{ id: string; table: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, table } = await params;
  try {
    const body = (await request.json()) as { name: string; type: LogicalType };
    await getAdapter(id).addColumn(decodeURIComponent(table), body.name, body.type);
    return Response.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
