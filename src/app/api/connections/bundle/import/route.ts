import { parseBundle } from "@/lib/connectionBundle";
import { importBundle } from "@/lib/store/connectionBundle";
import { errorResponse } from "@/lib/api/respond";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { bundle?: unknown; indices?: unknown; passphrase?: unknown };
    const bundle = parseBundle(body.bundle);
    const indices = Array.isArray(body.indices) ? body.indices.filter((i): i is number => typeof i === "number") : [];
    const connections = importBundle(bundle, indices, body.passphrase);
    return Response.json({ connections }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
