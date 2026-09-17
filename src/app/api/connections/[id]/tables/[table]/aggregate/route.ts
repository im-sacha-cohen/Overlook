import { getAdapter } from "@/lib/db/registry";
import { errorResponse } from "@/lib/api/respond";
import { rowQueryFromParams } from "@/lib/api/rowQuery";
import { AGGREGATE_FNS, type AggregateFn } from "@/lib/types";

type Params = { params: Promise<{ id: string; table: string }> };

// Column summaries (count, sum, min…) over the rows a view keeps.
export async function GET(request: Request, { params }: Params) {
  const { id, table } = await params;
  try {
    const url = new URL(request.url);
    const raw = JSON.parse(url.searchParams.get("specs") ?? "[]") as { column?: unknown; fn?: unknown }[];
    const specs = (Array.isArray(raw) ? raw : [])
      .filter((s): s is { column: string; fn: AggregateFn } => typeof s.column === "string" && AGGREGATE_FNS.includes(s.fn as AggregateFn))
      .slice(0, 200);
    const values = await getAdapter(id).aggregate(decodeURIComponent(table), rowQueryFromParams(url.searchParams), specs);
    return Response.json({ values });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
