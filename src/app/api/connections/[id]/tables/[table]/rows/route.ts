import { getAdapter } from "@/lib/db/registry";
import { errorResponse } from "@/lib/api/respond";
import type { Row, RowFilter, RowSort } from "@/lib/types";

type Params = { params: Promise<{ id: string; table: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, table } = await params;
  try {
    const url = new URL(request.url);
    const filters = url.searchParams.get("filters");
    const sorts = url.searchParams.get("sorts");
    const limit = url.searchParams.get("limit");
    const offset = url.searchParams.get("offset");
    const result = await getAdapter(id).selectRows(decodeURIComponent(table), {
      filters: filters ? (JSON.parse(filters) as RowFilter[]) : undefined,
      sorts: sorts ? (JSON.parse(sorts) as RowSort[]) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return Response.json(result);
  } catch (err) {
    return errorResponse(err, 500);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id, table } = await params;
  try {
    const values = (await request.json()) as Row;
    const row = await getAdapter(id).insertRow(decodeURIComponent(table), values);
    return Response.json({ row }, { status: 201 });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
