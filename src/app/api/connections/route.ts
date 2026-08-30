import { listConnections, createConnection } from "@/lib/store/metadata";
import { errorResponse } from "@/lib/api/respond";
import type { ConnectionInput } from "@/lib/types";

export async function GET() {
  return Response.json({ connections: listConnections() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ConnectionInput;
    if (!body.name || !body.engine || !body.database) {
      return errorResponse(new Error("name, engine et database sont requis"));
    }
    const conn = createConnection(body);
    return Response.json({ connection: conn }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
