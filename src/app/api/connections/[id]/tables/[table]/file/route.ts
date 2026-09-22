import { getAdapter } from "@/lib/db/registry";
import { errorResponse } from "@/lib/api/respond";

type Params = { params: Promise<{ id: string; table: string }> };

// Downloads one cell's value as a file: the binary values the grid and the
// detail panel only show by size.
export async function GET(request: Request, { params }: Params) {
  const { id, table } = await params;
  try {
    const url = new URL(request.url);
    const pkColumn = url.searchParams.get("pkColumn");
    const pk = url.searchParams.get("pk");
    const column = url.searchParams.get("column");
    if (!pkColumn || pk === null || !column) return errorResponse(new Error("pkColumn, pk et column sont requis"));
    const tableName = decodeURIComponent(table);
    const adapter = getAdapter(id);
    const meta = await adapter.getTable(tableName);
    if (!meta.columns.some((c) => c.name === column)) return errorResponse(new Error(`Colonne inconnue : ${column}`));
    const { rows } = await adapter.selectRows(tableName, { filters: [{ column: pkColumn, op: "eq", value: pk }], limit: 1 });
    if (rows.length === 0) return errorResponse(new Error("Ligne introuvable"), 404);
    const value = rows[0][column];
    if (value === null || value === undefined) return errorResponse(new Error("Cette cellule est vide"), 404);
    const bytes = Buffer.isBuffer(value) ? value : value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(String(value), "utf8");
    const name = `${tableName}-${pk}-${column}.bin`.replace(/[^\w.-]+/g, "_");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
