import Database from "better-sqlite3";
import type { AggregateFn, Connection, ColumnMeta, LogicalType, QueryResult, Row, RowQuery, TableMeta } from "../types";
import {
  assertCreatableType,
  assertKnownColumn,
  assertValidIdentifier,
  previewWithAdapter,
  ReadOnlyViolation,
  type DatabaseAdapter,
  type DropTablesOptions,
  type ScriptSession,
  runOneByOne,
  type SelectOptions,
  type SqlStatement,
  type WriteOp,
  type WritePreview,
} from "./adapter";
import { aggregateResult, buildAggregate, buildDistinctValues, buildOrderBy, buildWhere, distinctQueryTables, distinctRows, loadRelatedTables, topDistinct } from "./where";
import { leadingKeyword } from "./splitSqlStatements";
import { assertNoFileAccess, resolveSqlitePath } from "./sqlitePath";

const CREATABLE_TYPE_SQL: Record<Exclude<LogicalType, "relation" | "unknown">, string> = {
  text: "TEXT",
  number: "REAL",
  select: "TEXT",
  date: "TEXT",
  checkbox: "INTEGER",
  json: "TEXT",
};

function nativeToLogical(declaredType: string): LogicalType {
  const t = declaredType.toUpperCase();
  if (t.includes("BOOL")) return "checkbox";
  if (t.includes("INT")) return "number";
  if (t.includes("DATE") || t.includes("TIME")) return "date";
  if (t.includes("JSON")) return "json";
  if (t.includes("REAL") || t.includes("FLOA") || t.includes("DOUB") || t.includes("NUMERIC")) return "number";
  if (t.includes("CHAR") || t.includes("CLOB") || t.includes("TEXT") || t === "") return "text";
  return "unknown";
}

function q(ident: string): string {
  assertValidIdentifier(ident);
  return `"${ident}"`;
}

function coerceParam(value: unknown): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === undefined) return null;
  return value;
}

interface TableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

interface ForeignKeyRow {
  table: string;
  from: string;
  to: string;
}

const SQLITE_BATCH_SIZE = 2000;
const SQLITE_OUTSIDE_BATCH = /^(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|PRAGMA|VACUUM)\b/i;

export class SqliteAdapter implements DatabaseAdapter {
  private db: Database.Database;

  constructor(conn: Connection) {
    // Connections open existing files only; creating one goes through "Create database".
    this.db = new Database(resolveSqlitePath(conn.database), { fileMustExist: true });
    this.db.pragma("foreign_keys = ON");
  }

  async testConnection(): Promise<void> {
    this.db.prepare("SELECT 1").get();
  }

  async listTables(): Promise<TableMeta[]> {
    const tableRows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    const tables: TableMeta[] = [];
    for (const t of tableRows) {
      tables.push(await this.getTable(t.name));
    }
    return tables;
  }

  async createTable(table: string, columns: { name: string; type: LogicalType }[]): Promise<void> {
    assertValidIdentifier(table);
    const colDefs = columns.map((c) => {
      assertValidIdentifier(c.name);
      if (c.type === "relation" || c.type === "unknown") throw new Error(`Cannot create a column of type ${c.type}`);
      return `${q(c.name)} ${CREATABLE_TYPE_SQL[c.type]}`;
    });
    this.db.exec(
      `CREATE TABLE ${q(table)} (id INTEGER PRIMARY KEY AUTOINCREMENT${colDefs.length ? ", " + colDefs.join(", ") : ""})`
    );
  }

  async getTable(table: string): Promise<TableMeta> {
    assertValidIdentifier(table);
    const infoRows = this.db.prepare(`PRAGMA table_info(${q(table)})`).all() as TableInfoRow[];
    const fkRows = this.db.prepare(`PRAGMA foreign_key_list(${q(table)})`).all() as ForeignKeyRow[];
    const fkByColumn = new Map(fkRows.map((r) => [r.from, r]));

    const columns: ColumnMeta[] = infoRows.map((c) => {
      const fk = fkByColumn.get(c.name);
      return {
        name: c.name,
        logicalType: fk ? "relation" : nativeToLogical(c.type),
        nativeType: c.type || "TEXT",
        nullable: c.notnull === 0,
        isPrimaryKey: c.pk > 0,
        references: fk ? { table: fk.table, column: fk.to } : undefined,
      };
    });

    const countRow = this.db.prepare(`SELECT COUNT(*) AS count FROM ${q(table)}`).get() as { count: number };
    return { name: table, columns, rowCount: countRow.count };
  }

  async selectRows(table: string, opts: SelectOptions) {
    const meta = await this.getTable(table);
    const { where, params } = buildWhere("sqlite", meta, opts, await loadRelatedTables(meta, opts, (t) => this.getTable(t)));
    const orderBy = buildOrderBy("sqlite", meta, opts.sorts);
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;
    const rows = this.db
      .prepare(`SELECT * FROM ${q(table)} ${where} ${orderBy} LIMIT ${limit} OFFSET ${offset}`)
      .all(...params) as Row[];
    const countRow = this.db.prepare(`SELECT COUNT(*) AS count FROM ${q(table)} ${where}`).get(...params) as {
      count: number;
    };
    return { rows, total: countRow.count };
  }

  async insertRow(table: string, values: Row): Promise<Row> {
    const meta = await this.getTable(table);
    const cols = Object.keys(values).filter((k) => meta.columns.some((c) => c.name === k));
    cols.forEach((c) => assertKnownColumn(meta, c));
    const sql =
      cols.length === 0
        ? `INSERT INTO ${q(table)} DEFAULT VALUES`
        : `INSERT INTO ${q(table)} (${cols.map(q).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    const info = this.db.prepare(sql).run(...cols.map((c) => coerceParam(values[c])));
    const pk = meta.columns.find((c) => c.isPrimaryKey);
    if (pk) {
      const row = this.db.prepare(`SELECT * FROM ${q(table)} WHERE rowid = ?`).get(info.lastInsertRowid) as Row;
      if (row) return row;
    }
    return values;
  }

  async updateRow(table: string, pkColumn: string, pkValue: unknown, values: Row): Promise<void> {
    const meta = await this.getTable(table);
    const cols = Object.keys(values).filter((k) => meta.columns.some((c) => c.name === k));
    cols.forEach((c) => assertKnownColumn(meta, c));
    assertKnownColumn(meta, pkColumn);
    if (cols.length === 0) return;
    const setClause = cols.map((c) => `${q(c)} = ?`).join(", ");
    this.db
      .prepare(`UPDATE ${q(table)} SET ${setClause} WHERE ${q(pkColumn)} = ?`)
      .run(...cols.map((c) => coerceParam(values[c])), coerceParam(pkValue));
  }

  async buildWrite(op: WriteOp): Promise<SqlStatement[]> {
    switch (op.kind) {
      case "updateRows": {
        const meta = await this.getTable(op.table);
        assertKnownColumn(meta, op.pkColumn);
        const cols = Object.keys(op.values).filter((k) => meta.columns.some((c) => c.name === k));
        if (cols.length === 0 || op.pkValues.length === 0) return [];
        return [
          {
            sql: `UPDATE ${q(op.table)} SET ${cols.map((c) => `${q(c)} = ?`).join(", ")} WHERE ${q(op.pkColumn)} IN (${op.pkValues.map(() => "?").join(", ")})`,
            params: [...cols.map((c) => coerceParam(op.values[c])), ...op.pkValues.map(coerceParam)],
          },
        ];
      }
      case "deleteRows": {
        const meta = await this.getTable(op.table);
        assertKnownColumn(meta, op.pkColumn);
        if (op.pkValues.length === 0) return [];
        return [{ sql: `DELETE FROM ${q(op.table)} WHERE ${q(op.pkColumn)} IN (${op.pkValues.map(() => "?").join(", ")})`, params: op.pkValues.map(coerceParam) }];
      }
      case "addColumn":
        assertValidIdentifier(op.name);
        assertCreatableType(op.type);
        return [{ sql: `ALTER TABLE ${q(op.table)} ADD COLUMN ${q(op.name)} ${CREATABLE_TYPE_SQL[op.type]}`, params: [] }];
      case "renameColumn": {
        assertValidIdentifier(op.newName);
        assertKnownColumn(await this.getTable(op.table), op.oldName);
        return [{ sql: `ALTER TABLE ${q(op.table)} RENAME COLUMN ${q(op.oldName)} TO ${q(op.newName)}`, params: [] }];
      }
      case "changeColumnType": {
        // SQLite can't alter a column's type: rebuild the table around it.
        assertCreatableType(op.type);
        const meta = await this.getTable(op.table);
        assertKnownColumn(meta, op.column);
        const sqlType = CREATABLE_TYPE_SQL[op.type];
        const tmpName = `${op.table}__overlook_tmp`;
        const colDefs = meta.columns
          .map((c) => {
            const type = c.name === op.column ? sqlType : c.nativeType || "TEXT";
            return `${q(c.name)} ${type}${c.isPrimaryKey ? " PRIMARY KEY" : ""}${c.nullable ? "" : " NOT NULL"}`;
          })
          .join(", ");
        const colNames = meta.columns.map((c) => q(c.name)).join(", ");
        const selectExprs = meta.columns.map((c) => (c.name === op.column ? `CAST(${q(c.name)} AS ${sqlType})` : q(c.name))).join(", ");
        return [
          { sql: `CREATE TABLE ${q(tmpName)} (${colDefs})`, params: [] },
          { sql: `INSERT INTO ${q(tmpName)} (${colNames}) SELECT ${selectExprs} FROM ${q(op.table)}`, params: [] },
          { sql: `DROP TABLE ${q(op.table)}`, params: [] },
          { sql: `ALTER TABLE ${q(tmpName)} RENAME TO ${q(op.table)}`, params: [] },
        ];
      }
      case "dropColumn": {
        assertKnownColumn(await this.getTable(op.table), op.column);
        return [{ sql: `ALTER TABLE ${q(op.table)} DROP COLUMN ${q(op.column)}`, params: [] }];
      }
      case "dropTables": {
        op.tables.forEach(assertValidIdentifier);
        const drops = this.dropOrder(op.tables).map((table) => ({ sql: `DROP TABLE ${q(table)}`, params: [] }));
        if (!op.ignoreForeignKeys) return drops;
        return [{ sql: "PRAGMA foreign_keys = OFF", params: [] }, ...drops, { sql: "PRAGMA foreign_keys = ON", params: [] }];
      }
      case "emptyTables": {
        op.tables.forEach(assertValidIdentifier);
        const statements = this.emptyStatements(op.tables);
        if (!op.ignoreForeignKeys) return statements;
        return [{ sql: "PRAGMA foreign_keys = OFF", params: [] }, ...statements, { sql: "PRAGMA foreign_keys = ON", params: [] }];
      }
    }
  }

  previewWrite(op: WriteOp): Promise<WritePreview> {
    return previewWithAdapter(this, op, "question", async (table, pkColumn, pkValues) => {
      const row = this.db
        .prepare(`SELECT COUNT(*) AS count FROM ${q(table)} WHERE ${q(pkColumn)} IN (${pkValues.map(() => "?").join(", ")})`)
        .get(...pkValues.map(coerceParam)) as { count: number };
      return row.count;
    });
  }

  async aggregate(table: string, query: RowQuery, specs: { column: string; fn: AggregateFn }[]) {
    if (specs.length === 0) return {};
    const meta = await this.getTable(table);
    const { sql, params, keys } = buildAggregate("sqlite", meta, query, specs, await loadRelatedTables(meta, query, (t) => this.getTable(t)));
    return aggregateResult(keys, this.db.prepare(sql).get(...params) as Record<string, unknown> | undefined);
  }

  async distinctValues(table: string, column: string, query?: string, options: { via?: string[]; within?: RowQuery } = {}) {
    const meta = await this.getTable(table);
    const lookup = await loadRelatedTables(meta, distinctQueryTables(column, options.via, options.within), (t) => this.getTable(t));
    const { sql, params } = buildDistinctValues("sqlite", meta, column, query, 500, { ...options, lookup });
    return topDistinct(distinctRows(this.db.prepare(sql).all(...params) as { value: unknown; count: unknown; id?: unknown }[]), query);
  }

  async selectRowsByPk(table: string, pkColumn: string, pkValues: unknown[]): Promise<Row[]> {
    if (pkValues.length === 0) return [];
    assertKnownColumn(await this.getTable(table), pkColumn);
    return this.db
      .prepare(`SELECT * FROM ${q(table)} WHERE ${q(pkColumn)} IN (${pkValues.map(() => "?").join(", ")})`)
      .all(...pkValues.map(coerceParam)) as Row[];
  }

  /** Runs the statements in one transaction and returns the rows changed. */
  private runStatements(statements: SqlStatement[]): number {
    let changes = 0;
    this.db.transaction(() => {
      for (const st of statements) changes += this.db.prepare(st.sql).run(...st.params).changes;
    })();
    return changes;
  }

  async updateRows(table: string, pkColumn: string, pkValues: unknown[], values: Row): Promise<number> {
    return this.runStatements(await this.buildWrite({ kind: "updateRows", table, pkColumn, pkValues, values }));
  }

  async deleteRow(table: string, pkColumn: string, pkValue: unknown): Promise<void> {
    const meta = await this.getTable(table);
    assertKnownColumn(meta, pkColumn);
    this.db.prepare(`DELETE FROM ${q(table)} WHERE ${q(pkColumn)} = ?`).run(coerceParam(pkValue));
  }

  async deleteRows(table: string, pkColumn: string, pkValues: unknown[]): Promise<number> {
    return this.runStatements(await this.buildWrite({ kind: "deleteRows", table, pkColumn, pkValues }));
  }

  async addColumn(table: string, name: string, type: LogicalType): Promise<void> {
    this.runStatements(await this.buildWrite({ kind: "addColumn", table, name, type }));
  }

  async renameColumn(table: string, oldName: string, newName: string): Promise<void> {
    this.runStatements(await this.buildWrite({ kind: "renameColumn", table, oldName, newName }));
  }

  async changeColumnType(table: string, column: string, type: LogicalType): Promise<void> {
    this.runStatements(await this.buildWrite({ kind: "changeColumnType", table, column, type }));
  }

  async dropColumn(table: string, column: string): Promise<void> {
    this.runStatements(await this.buildWrite({ kind: "dropColumn", table, column }));
  }

  // SQLite drops one table per statement and checks foreign keys on each, so a
  // referencing table has to go before the table it points to.
  private dropOrder(tables: string[]): string[] {
    const references = new Map(
      tables.map((table) => {
        const fks = this.db.pragma(`foreign_key_list(${q(table)})`) as { table: string }[];
        return [table, new Set(fks.map((fk) => fk.table).filter((target) => target !== table))] as const;
      })
    );
    const ordered: string[] = [];
    const remaining = new Set(tables);
    let progressed = true;
    while (remaining.size > 0 && progressed) {
      progressed = false;
      for (const table of [...remaining]) {
        const stillReferenced = [...remaining].some((other) => other !== table && references.get(other)?.has(table));
        if (!stillReferenced) {
          ordered.push(table);
          remaining.delete(table);
          progressed = true;
        }
      }
    }
    // A reference cycle can't be ordered: keep the given order and let SQLite report it.
    return [...ordered, ...remaining];
  }

  /**
   * SQLite has no TRUNCATE: DELETE each table, referencing ones first (as for a drop),
   * then restart AUTOINCREMENT counters, kept in sqlite_sequence when there are any.
   */
  private emptyStatements(tables: string[]): SqlStatement[] {
    const statements: SqlStatement[] = this.dropOrder(tables).map((table) => ({ sql: `DELETE FROM ${q(table)}`, params: [] }));
    const hasSequence = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'").get();
    if (hasSequence) statements.push({ sql: `DELETE FROM sqlite_sequence WHERE name IN (${tables.map(() => "?").join(", ")})`, params: tables });
    return statements;
  }

  async emptyTables(tables: string[], { ignoreForeignKeys = false }: DropTablesOptions = {}): Promise<void> {
    tables.forEach(assertValidIdentifier);
    const statements = this.emptyStatements(tables);
    // PRAGMA foreign_keys is a no-op inside a transaction, so flip it around it.
    if (ignoreForeignKeys) this.db.pragma("foreign_keys = OFF");
    try {
      this.db.transaction(() => {
        for (const st of statements) this.db.prepare(st.sql).run(...st.params);
      })();
    } finally {
      if (ignoreForeignKeys) this.db.pragma("foreign_keys = ON");
    }
  }

  async dropTables(tables: string[], { ignoreForeignKeys = false }: DropTablesOptions = {}): Promise<void> {
    tables.forEach(assertValidIdentifier);
    const ordered = this.dropOrder(tables);
    // PRAGMA foreign_keys is a no-op inside a transaction, so flip it around it.
    if (ignoreForeignKeys) this.db.pragma("foreign_keys = OFF");
    try {
      this.db.transaction(() => {
        for (const table of ordered) this.db.exec(`DROP TABLE ${q(table)}`);
      })();
    } finally {
      if (ignoreForeignKeys) this.db.pragma("foreign_keys = ON");
    }
  }

  async bulkInsert(table: string, rows: Row[]): Promise<number> {
    if (rows.length === 0) return 0;
    const meta = await this.getTable(table);
    const cols = Object.keys(rows[0]).filter((k) => meta.columns.some((c) => c.name === k));
    cols.forEach((c) => assertKnownColumn(meta, c));
    const stmt = this.db.prepare(
      `INSERT INTO ${q(table)} (${cols.map(q).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
    );
    const txn = this.db.transaction((allRows: Row[]) => {
      for (const row of allRows) stmt.run(...cols.map((c) => coerceParam(row[c])));
    });
    txn(rows);
    return rows.length;
  }

  async runRawQuery(sql: string, { readOnly = false } = {}): Promise<QueryResult> {
    assertNoFileAccess(sql);
    let stmt: Database.Statement;
    try {
      // prepare() compiles exactly one statement and refuses more.
      stmt = this.db.prepare(sql);
    } catch (err) {
      if (/more than one statement/i.test(err instanceof Error ? err.message : "")) {
        if (readOnly) throw new ReadOnlyViolation();
        throw new Error("Une seule requête à la fois dans la console : utilisez l'import de script SQL pour en exécuter plusieurs.");
      }
      throw err;
    }
    // SQLite itself says whether the compiled statement can write.
    if (readOnly && !stmt.readonly) throw new ReadOnlyViolation();
    if (stmt.reader) {
      const rows = stmt.all() as Row[];
      const columns = stmt.columns().map((c) => c.name);
      return { columns, rows, rowCount: rows.length };
    }
    const info = stmt.run();
    return { columns: [], rows: [], rowCount: info.changes };
  }

  async runStatement(sql: string): Promise<void> {
    assertNoFileAccess(sql);
    this.db.exec(sql);
  }

  async openScriptSession(): Promise<ScriptSession> {
    const db = this.db;
    // Committing after every statement costs a disk sync each: batch them instead.
    // `ours` says the open transaction is one Overlook started, not the script.
    let ours = false;
    let batched = 0;
    const commit = () => {
      if (ours && db.inTransaction) db.exec("COMMIT");
      ours = false;
      batched = 0;
    };
    // Local and synchronous: no round trip to save, one statement after the other.
    const session: ScriptSession = {
      runMany: (statements) => runOneByOne(session, statements),
      run: async (sql) => {
        assertNoFileAccess(sql);
        if (SQLITE_OUTSIDE_BATCH.test(leadingKeyword(sql))) {
          // The script's own transactions and PRAGMAs (foreign_keys is ignored inside one) run on their own.
          commit();
          db.exec(sql);
          return;
        }
        if (!db.inTransaction) {
          db.exec("BEGIN");
          ours = true;
        }
        try {
          db.exec(sql);
        } catch (err) {
          if (ours && !db.inTransaction) {
            // Some errors make SQLite roll the whole transaction back, not just the statement.
            const lost = batched;
            ours = false;
            batched = 0;
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(lost > 0 ? `${message} (SQLite a aussi annulé les ${lost} instruction(s) précédente(s) de son lot)` : message);
          }
          throw err;
        }
        if (ours && ++batched >= SQLITE_BATCH_SIZE) commit();
      },
      close: async () => {
        commit();
        // A transaction the script left open, or foreign keys it switched off, would outlive it on this shared handle.
        if (db.inTransaction) db.exec("ROLLBACK");
        db.pragma("foreign_keys = ON");
      },
    };
    return session;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
