import { getAdapter } from "@/lib/db/registry";
import { errorResponse } from "@/lib/api/respond";
import { journaled, describeOp } from "@/lib/api/journal";
import type { LogicalType } from "@/lib/types";

type Params = { params: Promise<{ id: string; table: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, table } = await params;
  try {
    const body = (await request.json()) as { name: string; type: LogicalType };
    const tableName = decodeURIComponent(table);
    await journaled(
      request,
      id,
      async () => ({ action: "addColumn", tableName, sql: await describeOp(id, { kind: "addColumn", table: tableName, name: body.name, type: body.type }) }),
      () => getAdapter(id).addColumn(tableName, body.name, body.type),
    );
    return Response.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
