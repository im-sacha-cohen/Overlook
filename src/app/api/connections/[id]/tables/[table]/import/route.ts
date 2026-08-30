import { getAdapter } from "@/lib/db/registry";
import { errorResponse } from "@/lib/api/respond";
import type { Row } from "@/lib/types";

type Params = { params: Promise<{ id: string; table: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, table } = await params;
  try {
    const body = (await request.json()) as { rows: Row[] };
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return errorResponse(new Error("Aucune ligne à importer"));
    }
    const inserted = await getAdapter(id).bulkInsert(decodeURIComponent(table), body.rows);
    return Response.json({ inserted });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
