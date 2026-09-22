import { getAdapter } from "@/lib/db/registry";
import { getConnection } from "@/lib/store/metadata";
import { checkConfirm } from "@/lib/api/guard";
import { errorResponse } from "@/lib/api/respond";
import { journaled, describeOp } from "@/lib/api/journal";

type Params = { params: Promise<{ id: string }> };

// Empties tables: every row goes, the tables and their structure stay.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { names: string[]; confirm?: string; ignoreForeignKeys?: boolean };
    if (!Array.isArray(body.names) || body.names.length === 0) {
      return errorResponse(new Error("names est requis"));
    }
    const conn = getConnection(id);
    if (!conn) return errorResponse(new Error("Connexion introuvable"), 404);
    const guard = checkConfirm(conn, body.confirm);
    if (!guard.ok) return errorResponse(new Error(guard.error), 412);
    const op = { kind: "emptyTables" as const, tables: body.names, ignoreForeignKeys: body.ignoreForeignKeys === true };
    await journaled(
      request,
      id,
      async () => ({ action: "emptyTables", tableName: body.names.length === 1 ? body.names[0] : null, sql: await describeOp(id, op) }),
      () => getAdapter(id).emptyTables(op.tables, op),
    );
    return Response.json({ emptied: body.names.length });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
