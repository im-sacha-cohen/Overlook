import { getAdapter } from "@/lib/db/registry";
import { getConnection } from "@/lib/store/metadata";
import { diffSchemas } from "@/lib/compare";
import { errorResponse } from "@/lib/api/respond";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { left?: string; right?: string };
    if (!body.left || !body.right || !getConnection(body.left) || !getConnection(body.right)) {
      return errorResponse(new Error("Choisis deux connexions existantes"));
    }
    const [left, right] = await Promise.all([getAdapter(body.left).listTables(), getAdapter(body.right).listTables()]);
    const sameEngine = getConnection(body.left)?.engine === getConnection(body.right)?.engine;
    return Response.json(diffSchemas(left, right, sameEngine));
  } catch (err) {
    return errorResponse(err, 500);
  }
}
