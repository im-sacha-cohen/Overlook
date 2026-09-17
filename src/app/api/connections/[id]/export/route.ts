import { getAdapter } from "@/lib/db/registry";
import { getConnection } from "@/lib/store/metadata";
import { generateExport, streamFromGenerator, type ExportFormat } from "@/lib/export/exportStream";
import { errorResponse } from "@/lib/api/respond";
import { rowQueryFromParams } from "@/lib/api/rowQuery";
import type { RowSort } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const conn = getConnection(id);
    if (!conn) return errorResponse(new Error("Connexion introuvable"), 404);

    const url = new URL(request.url);
    const requested = url.searchParams.get("format");
    const format: ExportFormat = requested === "ndjson" || requested === "csv" ? requested : "sql";
    // view=<table>: that table's rows as the view shows them (filters, search, sort in the same params).
    const viewTable = url.searchParams.get("view");
    const sorts = url.searchParams.get("sorts");
    const view = viewTable ? { table: viewTable, ...rowQueryFromParams(url.searchParams), sorts: sorts ? (JSON.parse(sorts) as RowSort[]) : undefined } : undefined;
    const includeStructure = url.searchParams.get("structure") !== "0";
    const includeData = url.searchParams.get("data") !== "0";
    const only = url.searchParams.get("tables");
    const wanted = only ? new Set(only.split(",")) : null;

    if (format !== "csv" && !includeStructure && !includeData) {
      return errorResponse(new Error("Choisis au moins structure ou données"));
    }

    const adapter = getAdapter(id);
    const allTables = await adapter.listTables();
    const tables = view ? allTables.filter((t) => t.name === view.table) : wanted ? allTables.filter((t) => wanted.has(t.name)) : allTables;
    if (tables.length === 0) return errorResponse(new Error("Aucune table à exporter"));
    if (format === "csv" && tables.length !== 1) return errorResponse(new Error("Le CSV exporte une seule table"));

    let totalRows = 0;
    if (includeData || format === "csv") {
      for (const t of tables) totalRows += view?.table === t.name ? (await adapter.selectRows(t.name, { ...view, limit: 1 })).total : t.rowCount;
    }
    const base = format === "csv" || view ? `${conn.name}-${tables[0].name}` : conn.name;
    const filename = `${base.replace(/[^a-zA-Z0-9_-]+/g, "_")}-${new Date().toISOString().slice(0, 10)}.${format}`;

    const stream = streamFromGenerator(
      generateExport(adapter, conn.engine, tables, { format, includeStructure, includeData, view })
    );

    return new Response(stream, {
      headers: {
        "Content-Type": format === "ndjson" ? "application/x-ndjson; charset=utf-8" : format === "csv" ? "text/csv; charset=utf-8" : "application/sql; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Total-Rows": String(totalRows),
        "X-Total-Tables": String(tables.length),
      },
    });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
