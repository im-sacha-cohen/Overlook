import { getAdapter } from "@/lib/db/registry";
import { errorResponse } from "@/lib/api/respond";
import { journaled, describeInsert } from "@/lib/api/journal";
import type { Row } from "@/lib/types";

type Params = { params: Promise<{ id: string; table: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, table } = await params;
  try {
    const body = (await request.json()) as { rows: Row[] };
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return errorResponse(new Error("Aucune ligne à importer"));
    }
    const tableName = decodeURIComponent(table);
    const inserted = await journaled(
      request,
      id,
      { action: "importRows", tableName, sql: `-- ${body.rows.length} ligne(s) importée(s) depuis un CSV\n${body.rows.slice(0, 5).map((r) => describeInsert(tableName, r)).join("\n")}${body.rows.length > 5 ? "\n-- …" : ""}` },
      () => getAdapter(id).bulkInsert(tableName, body.rows),
      (n) => n,
    );
    return Response.json({ inserted });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
