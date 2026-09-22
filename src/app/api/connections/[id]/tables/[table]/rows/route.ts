import { getAdapter } from "@/lib/db/registry";
import { errorResponse } from "@/lib/api/respond";
import { journaled, describeInsert } from "@/lib/api/journal";
import type { Row, RowSort } from "@/lib/types";
import { rowQueryFromParams } from "@/lib/api/rowQuery";

type Params = { params: Promise<{ id: string; table: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, table } = await params;
  try {
    const url = new URL(request.url);
    const sorts = url.searchParams.get("sorts");
    const limit = url.searchParams.get("limit");
    const offset = url.searchParams.get("offset");
    const result = await getAdapter(id).selectRows(decodeURIComponent(table), {
      ...rowQueryFromParams(url.searchParams),
      sorts: sorts ? (JSON.parse(sorts) as RowSort[]) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      preview: url.searchParams.get("preview") === "1",
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
