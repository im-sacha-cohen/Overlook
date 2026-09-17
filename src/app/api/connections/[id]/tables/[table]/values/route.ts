import { getAdapter } from "@/lib/db/registry";
import { errorResponse } from "@/lib/api/respond";

type Params = { params: Promise<{ id: string; table: string }> };

// Filter suggestions: the most frequent values of one column.
export async function GET(request: Request, { params }: Params) {
  const { id, table } = await params;
  try {
    const url = new URL(request.url);
    const column = url.searchParams.get("column") ?? "";
    const query = (url.searchParams.get("q") ?? "").slice(0, 200);
    const values = await getAdapter(id).distinctValues(decodeURIComponent(table), column, query);
    return Response.json({ values });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
