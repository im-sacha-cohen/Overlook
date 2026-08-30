import { getAdapter } from "@/lib/db/registry";
import { getConnection } from "@/lib/store/metadata";
import { generateExport, streamFromGenerator, type ExportFormat } from "@/lib/export/exportStream";
import { errorResponse } from "@/lib/api/respond";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const conn = getConnection(id);
    if (!conn) return errorResponse(new Error("Connexion introuvable"), 404);

    const url = new URL(request.url);
    const format = (url.searchParams.get("format") as ExportFormat) || "sql";
    const includeStructure = url.searchParams.get("structure") !== "0";
    const includeData = url.searchParams.get("data") !== "0";
    const only = url.searchParams.get("tables");
    const wanted = only ? new Set(only.split(",")) : null;

    if (!includeStructure && !includeData) {
      return errorResponse(new Error("Choisis au moins structure ou données"));
    }

    const adapter = getAdapter(id);
    const allTables = await adapter.listTables();
    const tables = wanted ? allTables.filter((t) => wanted.has(t.name)) : allTables;
    if (tables.length === 0) return errorResponse(new Error("Aucune table à exporter"));

    const totalRows = includeData ? tables.reduce((sum, t) => sum + t.rowCount, 0) : 0;
    const ext = format === "ndjson" ? "ndjson" : "sql";
    const filename = `${conn.name.replace(/[^a-zA-Z0-9_-]+/g, "_")}-${new Date().toISOString().slice(0, 10)}.${ext}`;

    const stream = streamFromGenerator(
      generateExport(adapter, conn.engine, tables, { format, includeStructure, includeData })
    );

    return new Response(stream, {
      headers: {
        "Content-Type": format === "ndjson" ? "application/x-ndjson; charset=utf-8" : "application/sql; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Total-Rows": String(totalRows),
        "X-Total-Tables": String(tables.length),
      },
    });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
