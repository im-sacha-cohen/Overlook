import { getAdapter } from "@/lib/db/registry";
import { getConnection } from "@/lib/store/metadata";
import { checkConfirm } from "@/lib/api/guard";
import { errorResponse } from "@/lib/api/respond";
import { splitSqlStatements } from "@/lib/db/splitSqlStatements";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { sql: string; confirm?: string };
    if (!body.sql || !body.sql.trim()) return errorResponse(new Error("Script SQL vide"));
    const conn = getConnection(id);
    if (!conn) return errorResponse(new Error("Connexion introuvable"), 404);
    const guard = checkConfirm(conn, body.confirm);
    if (!guard.ok) return errorResponse(new Error(guard.error), 412);

    const statements = splitSqlStatements(body.sql);
    const adapter = getAdapter(id);
    const encoder = new TextEncoder();

    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const failed: { statement: number; sql: string; message: string }[] = [];
        let executed = 0;
        const send = (obj: unknown) => {
          if (cancelled) return;
          try {
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          } catch {
            // stream already closed client-side, ignore
          }
        };
        send({ type: "start", total: statements.length });
        for (let i = 0; i < statements.length && !cancelled; i++) {
          try {
            await adapter.runStatement(statements[i]);
            executed++;
          } catch (err) {
            failed.push({
              statement: i + 1,
              sql: statements[i].slice(0, 200),
              message: err instanceof Error ? err.message : String(err),
            });
          }
          send({ type: "progress", index: i + 1, total: statements.length, executed, failedCount: failed.length });
        }
        if (!cancelled) {
          send({ type: "done", executed, failed, cancelled });
          controller.close();
        }
      },
      cancel() {
        cancelled = true;
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "X-Total-Statements": String(statements.length) },
    });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
