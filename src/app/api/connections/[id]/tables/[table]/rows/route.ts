import { getAdapter } from "@/lib/db/registry";
import { errorResponse } from "@/lib/api/respond";
import { journaled, describeInsert } from "@/lib/api/journal";
import type { Row, RowFilter, RowSort } from "@/lib/types";

type Params = { params: Promise<{ id: string; table: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, table } = await params;
  try {
    const url = new URL(request.url);
    const filters = url.searchParams.get("filters");
    const sorts = url.searchParams.get("sorts");
    const search = url.searchParams.get("search");
    const limit = url.searchParams.get("limit");
    const offset = url.searchParams.get("offset");
    const result = await getAdapter(id).selectRows(decodeURIComponent(table), {
      filters: filters ? (JSON.parse(filters) as RowFilter[]) : undefined,
      sorts: sorts ? (JSON.parse(sorts) as RowSort[]) : undefined,
      search: search ?? undefined,
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
    const tableName = decodeURIComponent(table);
    const row = await journaled(
      request,
      id,
      { action: "insertRow", tableName, sql: describeInsert(tableName, values) },
      () => getAdapter(id).insertRow(tableName, values),
      () => 1,
      // Keep the inserted row, with its generated key, so the insert can be undone.
      async (inserted) => {
        const pkColumn = (await getAdapter(id).getTable(tableName)).columns.find((c) => c.isPrimaryKey)?.name;
        return { pkColumn, after: [inserted] };
      },
    );
    return Response.json({ row }, { status: 201 });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
