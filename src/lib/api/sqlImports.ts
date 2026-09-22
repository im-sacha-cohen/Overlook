import { ScriptSessionLost, type ScriptSession } from "../db/adapter";
import { SqlStatementSplitter } from "../db/splitSqlStatements";
import { recordWrite } from "./journal";
import { errorMessage } from "./respond";

// A SQL import runs across several requests: the browser sends the script in
// pieces of a few MB, one after the other, and each is run before the next is
// sent. No request lasts long (Node cuts off a request after 5 minutes), the
// browser gets progress after every piece, and nothing ever holds the whole script.

/** Errors kept in full; the rest are only counted. */
const MAX_REPORTED_FAILURES = 100;
/** A pasted script this short goes to the journal as is; a file only by name and size. */
const JOURNAL_SQL_LIMIT = 20_000;
/** An import with no piece for this long was abandoned (tab closed…): its connection is let go. */
const IDLE_TIMEOUT_MS = 2 * 60_000;
/** A finished import stays readable this long, for a request that crossed its end. */
const KEEP_FINISHED_MS = 60_000;
/**
 * SQLite runs statements synchronously: without a pause now and then, a piece
 * would hold the server until its end, cancel and every other request included.
 */
const YIELD_EVERY_MS = 50;

export interface ImportFailure {
  statement: number;
  sql: string;
  message: string;
}

export interface ImportStatus {
  state: "running" | "done" | "cancelled" | "error";
  bytes: number;
  statements: number;
  executed: number;
  failedCount: number;
  failed: ImportFailure[];
  error: string | null;
}

export class ImportConflict extends Error {}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} Go`;
}

class SqlImport {
  readonly id = crypto.randomUUID();
  private state: ImportStatus["state"] = "running";
  private error: string | null = null;
  private bytes = 0;
  private statements = 0;
  private executed = 0;
  private failedCount = 0;
  private failed: ImportFailure[] = [];
  private busy = false;
  private cancelRequested = false;
  private readonly splitter = new SqlStatementSplitter();
  private readonly decoder = new TextDecoder();
  private journalSql = "";
  private idle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly connectionId: string,
    private readonly session: ScriptSession,
    /** The request that started the import: the journal credits its sender. */
    private readonly request: Request,
    private readonly fileName: string | null,
  ) {
    this.armIdleTimeout();
  }

  status(): ImportStatus {
    const { state, bytes, statements, executed, failedCount, failed, error } = this;
    return { state, bytes, statements, executed, failedCount, failed, error };
  }

  /** Runs the piece starting at byte `offset`; `last` ends the script after it. */
  async push(offset: number, data: Uint8Array, last: boolean): Promise<ImportStatus> {
    if (this.state !== "running") throw new ImportConflict("Cet import est déjà terminé");
    if (this.busy) throw new ImportConflict("Le morceau précédent de cet import est encore en cours");
    if (offset !== this.bytes) throw new ImportConflict(`Morceau inattendu : l'import en est à l'octet ${this.bytes}, pas ${offset}`);
    this.busy = true;
    if (this.idle) clearTimeout(this.idle);
    try {
      this.bytes += data.byteLength;
      const text = this.decoder.decode(data, { stream: !last });
      if (!this.fileName && this.journalSql.length <= JOURNAL_SQL_LIMIT) this.journalSql += text.slice(0, JOURNAL_SQL_LIMIT + 1 - this.journalSql.length);
      await this.run(this.splitter.push(text));
      if (last) await this.run(this.splitter.end());
    } catch (err) {
      await this.finish("error", errorMessage(err));
    } finally {
      this.busy = false;
    }
    if (this.cancelRequested) await this.finish("cancelled");
    else if (last) await this.finish("done");
    else if (this.state === "running") this.armIdleTimeout();
    return this.status();
  }

  /** Stops after the statement running now, if any. What already ran stays. */
  async cancel(): Promise<ImportStatus> {
    this.cancelRequested = true;
    if (!this.busy) await this.finish("cancelled");
    return this.status();
  }

  private async run(statements: string[]): Promise<void> {
    let lastYield = Date.now();
    for (const sql of statements) {
      if (Date.now() - lastYield > YIELD_EVERY_MS) {
        await new Promise((resolve) => setImmediate(resolve));
        lastYield = Date.now();
      }
      if (this.cancelRequested) return;
      this.statements++;
      try {
        await this.session.run(sql);
        this.executed++;
      } catch (err) {
        if (err instanceof ScriptSessionLost) throw err;
        this.failedCount++;
        if (this.failed.length < MAX_REPORTED_FAILURES) this.failed.push({ statement: this.statements, sql: sql.slice(0, 200), message: errorMessage(err) });
      }
    }
  }

  private armIdleTimeout(): void {
    this.idle = setTimeout(() => void this.finish("error", "Import abandonné : plus aucun morceau reçu"), IDLE_TIMEOUT_MS);
    this.idle.unref?.();
  }

  private async finish(state: Exclude<ImportStatus["state"], "running">, error: string | null = null): Promise<void> {
    if (this.state !== "running") return;
    this.state = state;
    this.error = error;
    if (this.idle) clearTimeout(this.idle);
    await this.session.close().catch(() => {});

    const summary = `-- ${this.fileName ? `Fichier ${this.fileName}` : "Script"} · ${formatBytes(this.bytes)} · ${this.statements} instruction(s)`;
    const journalError =
      state === "cancelled"
        ? "Import annulé"
        : state === "error"
          ? `Import interrompu après ${this.statements} instruction(s) : ${error}`
          : this.failedCount > 0
            ? `${this.failedCount} instruction(s) en échec sur ${this.statements}`
            : null;
    recordWrite(
      this.request,
      this.connectionId,
      { action: "sqlScript", sql: this.fileName || this.journalSql.length > JOURNAL_SQL_LIMIT ? summary : this.journalSql },
      this.executed,
      journalError,
    );
    setTimeout(() => imports.delete(this.id), KEEP_FINISHED_MS).unref?.();
  }
}

// On globalThis so every route bundle (and a dev reload) sees the same imports.
const store = globalThis as typeof globalThis & { __overlookSqlImports?: Map<string, SqlImport> };
const imports = (store.__overlookSqlImports ??= new Map());

export function startSqlImport(connectionId: string, session: ScriptSession, request: Request, fileName: string | null): SqlImport {
  const imp = new SqlImport(connectionId, session, request, fileName);
  imports.set(imp.id, imp);
  return imp;
}

export function getSqlImport(connectionId: string, importId: string): SqlImport | null {
  const imp = imports.get(importId);
  return imp && imp.connectionId === connectionId ? imp : null;
}
