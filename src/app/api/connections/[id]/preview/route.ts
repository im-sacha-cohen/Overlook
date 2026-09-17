import { getAdapter } from "@/lib/db/registry";
import type { WriteOp } from "@/lib/types";
import { errorResponse } from "@/lib/api/respond";

const KINDS: WriteOp["kind"][] = ["updateRows", "deleteRows", "addColumn", "renameColumn", "changeColumnType", "dropColumn", "dropTables"];

// Shows the SQL a write would run and how many rows it concerns, without running it.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const op = (await request.json()) as WriteOp;
    if (!op || !KINDS.includes(op.kind)) return errorResponse(new Error("Opération inconnue"));
    if ((op.kind === "updateRows" || op.kind === "deleteRows") && !Array.isArray(op.pkValues)) return errorResponse(new Error("pkValues doit être une liste"));
    if (op.kind === "dropTables" && !Array.isArray(op.tables)) return errorResponse(new Error("tables doit être une liste"));
    return Response.json(await getAdapter(id).previewWrite(op));
  } catch (err) {
    return errorResponse(err, 500);
  }
}
