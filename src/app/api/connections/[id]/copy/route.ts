import { getAdapter } from "@/lib/db/registry";
import { checkConfirm } from "@/lib/api/guard";
import { errorMessage, errorResponse } from "@/lib/api/respond";
import { recordWrite } from "@/lib/api/journal";
import { copyRows, type CopyEvent } from "@/lib/api/copyRows";
import { parseCopyRequest } from "./parse";

type Params = { params: Promise<{ id: string }> };

// Copies rows (ids given) or whole tables of this connection into the same tables of
// another one. Answers with one JSON line per step, so the page can show progress.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const parsed = await parseCopyRequest(id, await request.json());
    if ("error" in parsed) return parsed.error;
    const { source, target, plan } = parsed;
    // The target is the one written to: it is the one a production guard protects.
    const guard = checkConfirm(target, parsed.confirm);
    if (!guard.ok) return errorResponse(new Error(guard.error), 412);

    const events = copyRows(getAdapter(source.id), getAdapter(target.id), target.engine, plan, request.signal);
    const { tables, ids, onConflict } = plan;
    const describe = `-- Copie depuis « ${source.name} » : ${tables.join(", ")}${ids ? ` (${ids.length} ligne(s) choisie(s))` : ""}` +
      `\n-- Lignes déjà présentes : ${onConflict === "skip" ? "ignorées" : onConflict === "replace" ? "remplacées" : "annulation"}` +
      `\n-- Relations manquantes : ${plan.relations === "include" ? "lignes liées copiées aussi" : "lignes concernées laissées de côté"}` +
      (plan.emptyFirst && !ids ? `\n-- Tables cibles vidées avant la copie${plan.emptyAlso?.length ? ` (avec ${plan.emptyAlso.join(", ")})` : ""}` : "");
    const info = { action: "copyRows" as const, tableName: tables.length === 1 ? tables[0] : null, sql: describe };

    const encoder = new TextEncoder();
    // Rows written so far, per table: a copy stopped midway still says what it left behind.
    const writtenByTable = new Map<string, number>();
    const written = () => [...writtenByTable.values()].reduce((a, b) => a + b, 0);
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const send = (event: CopyEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        try {
          const { value, done } = await events.next();
          if (done) {
            controller.close();
            return;
          }
          if (value.type === "progress") writtenByTable.set(value.table, value.written);
          if (value.type === "done") recordWrite(request, target.id, info, value.written, null);
          send(value);
        } catch (err) {
          const message = errorMessage(err);
          recordWrite(request, target.id, info, written(), message);
          send({ type: "error", message });
          controller.close();
        }
      },
      async cancel() {
        await events.return(undefined);
        recordWrite(request, target.id, info, written(), "Copie interrompue");
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
