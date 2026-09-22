import { errorResponse } from "@/lib/api/respond";
import { foreignRequestRefusal } from "@/lib/api/sameSite";
import { getSqlImport, ImportConflict } from "@/lib/api/sqlImports";

type Params = { params: Promise<{ id: string; importId: string }> };

// One piece of a SQL import's script, as the raw body (Content-Type: application/sql).
// The proxy skips this route, so a piece isn't copied in memory once more; it runs
// the proxy's checks itself.

/** The browser sends 4 MB; anything much bigger isn't one of its pieces. */
const MAX_PIECE_BYTES = 16 * 1024 * 1024;

export async function POST(request: Request, { params }: Params) {
  const { id, importId } = await params;
  const refusal = foreignRequestRefusal(request, "application/sql");
  if (refusal) return errorResponse(new Error(refusal), 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/sql")) {
    return errorResponse(new Error("Le morceau doit être envoyé brut, en application/sql"), 415);
  }
  const imp = getSqlImport(id, importId);
  if (!imp) return errorResponse(new Error("Import introuvable ou expiré"), 404);

  const url = new URL(request.url);
  const offset = Number(url.searchParams.get("offset"));
  if (!Number.isSafeInteger(offset) || offset < 0) return errorResponse(new Error("offset invalide"));
  if (Number(request.headers.get("content-length")) > MAX_PIECE_BYTES) return errorResponse(new Error("Morceau trop gros"), 413);

  try {
    const data = new Uint8Array(await request.arrayBuffer());
    if (data.byteLength > MAX_PIECE_BYTES) return errorResponse(new Error("Morceau trop gros"), 413);
    return Response.json(await imp.push(offset, data, url.searchParams.get("end") === "1"));
  } catch (err) {
    return errorResponse(err, err instanceof ImportConflict ? 409 : 500);
  }
}

/** Where the import stands, polled by the browser while a long piece runs. */
export async function GET(request: Request, { params }: Params) {
  const { id, importId } = await params;
  const refusal = foreignRequestRefusal(request, "application/json");
  if (refusal) return errorResponse(new Error(refusal), 403);
  const imp = getSqlImport(id, importId);
  if (!imp) return errorResponse(new Error("Import introuvable ou expiré"), 404);
  return Response.json(imp.status());
}

/** Cancels the import: what already ran stays in the database. */
export async function DELETE(request: Request, { params }: Params) {
  const { id, importId } = await params;
  const refusal = foreignRequestRefusal(request, "application/json");
  if (refusal) return errorResponse(new Error(refusal), 403);
  const imp = getSqlImport(id, importId);
  if (!imp) return errorResponse(new Error("Import introuvable ou expiré"), 404);
  return Response.json(await imp.cancel());
}
