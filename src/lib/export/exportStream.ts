import type { DatabaseAdapter, SelectOptions } from "../db/adapter";
import type { Engine, TableMeta } from "../types";
import { csvHeader, csvRows } from "./csv";
import { sqlDumpHeader, sqlCreateTable, sqlInsertBatch, sqlProgressComment, sqlForeignKeys } from "./sqlDump";
import { ndjsonTableStart, ndjsonRowBatch, ndjsonTableEnd } from "./ndjson";

export type ExportFormat = "sql" | "ndjson" | "csv";

export interface ExportOptions {
  format: ExportFormat;
  includeStructure: boolean;
  includeData: boolean;
  /** Rows of one table as a view shows them: its filters, search and sort. */
  view?: { table: string } & Omit<SelectOptions, "limit" | "offset">;
}

const BATCH_SIZE = 1000;

export async function* generateExport(
  adapter: DatabaseAdapter,
  engine: Engine,
  tables: TableMeta[],
  opts: ExportOptions
): AsyncGenerator<string> {
  if (opts.format === "sql") yield sqlDumpHeader(engine);

  if (opts.format === "csv") {
    // One table per file: the header, then its rows.
    const table = tables[0];
    if (!table) return;
    const query = opts.view?.table === table.name ? opts.view : {};
    yield csvHeader(table.columns);
    for (let offset = 0; ; offset += BATCH_SIZE) {
      const { rows } = await adapter.selectRows(table.name, { ...query, limit: BATCH_SIZE, offset });
      if (rows.length > 0) yield csvRows(table.columns, rows);
      if (rows.length < BATCH_SIZE) break;
    }
    return;
  }

  for (const table of tables) {
    if (opts.includeStructure) {
      yield opts.format === "sql" ? sqlCreateTable(engine, table) : ndjsonTableStart(table.name, table.columns);
    }

    let exported = 0;
    if (opts.includeData) {
      let offset = 0;
      while (true) {
        const query = opts.view?.table === table.name ? opts.view : {};
        const { rows } = await adapter.selectRows(table.name, { ...query, limit: BATCH_SIZE, offset });
        if (rows.length === 0) break;
        yield opts.format === "sql" ? sqlInsertBatch(engine, table, rows) : ndjsonRowBatch(table.name, rows);
        exported += rows.length;
        offset += BATCH_SIZE;
        if (rows.length < BATCH_SIZE) break;
      }
    }

    yield opts.format === "sql" ? sqlProgressComment(table.name, exported) : ndjsonTableEnd(table.name, exported);
  }

  // Emitted once every table exists and its data is loaded, so a FK never
  // points at a row that hasn't been inserted yet regardless of table order.
  if (opts.format === "sql" && opts.includeStructure) {
    for (const table of tables) {
      const fk = sqlForeignKeys(engine, table);
      if (fk) yield fk;
    }
  }
}

export function streamFromGenerator(gen: AsyncGenerator<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) {
          controller.close();
          return;
        }
        if (value) controller.enqueue(encoder.encode(value));
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await gen.return?.(undefined);
    },
  });
}
