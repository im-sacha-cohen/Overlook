import { getAdapter } from "@/lib/db/registry";
import { errorResponse } from "@/lib/api/respond";
import { analyzeCopy } from "@/lib/api/copyRows";
import { parseCopyRequest } from "../parse";

type Params = { params: Promise<{ id: string }> };

// What a copy would run into (missing tables, columns, parent rows), before the user
// confirms it. Reads both sides, writes nothing: no production guard.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const parsed = await parseCopyRequest(id, await request.json());
    if ("error" in parsed) return parsed.error;
    const { source, target, plan } = parsed;
    return Response.json(await analyzeCopy(getAdapter(source.id), getAdapter(target.id), target.engine, plan, request.signal));
  } catch (err) {
    return errorResponse(err, 500);
  }
}
