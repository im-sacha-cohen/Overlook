import { getAdapter } from "@/lib/db/registry";
import { errorResponse } from "@/lib/api/respond";
import { rowQueryFromParams } from "@/lib/api/rowQuery";

type Params = { params: Promise<{ id: string; table: string }> };

// Filter suggestions: a column's values, counted on the rows the other filters keep.
export async function GET(request: Request, { params }: Params) {
  const { id, table } = await params;
  try {
    const url = new URL(request.url);
    const column = url.searchParams.get("column") ?? "";
    const query = (url.searchParams.get("q") ?? "").slice(0, 200);
    const via = url.searchParams.get("via");
    const values = await getAdapter(id).distinctValues(decodeURIComponent(table), column, query, {
      via: via ? (JSON.parse(via) as string[]) : undefined,
      within: rowQueryFromParams(url.searchParams),
    });
    return Response.json({ values });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
