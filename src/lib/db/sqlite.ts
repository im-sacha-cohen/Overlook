import Database from "better-sqlite3";
import type { Connection, ColumnMeta, LogicalType, QueryResult, Row, TableMeta } from "../types";
import {
  assertCreatableType,
  assertKnownColumn,
  assertValidIdentifier,
  filterOpToSql,
  previewWithAdapter,
  type DatabaseAdapter,
  type DropTablesOptions,
  type ImportReport,
  type SelectOptions,
  type SqlStatement,
  type WriteOp,
  type WritePreview,
} from "./adapter";
import { splitSqlStatements } from "./splitSqlStatements";
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

  private buildWhere(meta: TableMeta, opts: SelectOptions): { where: string; params: unknown[] } {
    const filters = opts.filters ?? [];
    const search = opts.search?.trim();
    if (filters.length === 0 && !search) return { where: "", params: [] };
    const params: unknown[] = [];
    const clauses = filters.map((f) => {
      assertKnownColumn(meta, f.column);
      const op = filterOpToSql(f.op);
      params.push(op === "LIKE" ? `%${f.value}%` : f.value);
      return `CAST(${q(f.column)} AS TEXT) ${op} ?`;
    });
    if (search && meta.columns.length > 0) {
      clauses.push(`(${meta.columns.map((c) => { params.push(`%${search}%`); return `CAST(${q(c.name)} AS TEXT) LIKE ?`; }).join(" OR ")})`);
    }
    return { where: `WHERE ${clauses.join(" AND ")}`, params };
  }

  async selectRows(table: string, opts: SelectOptions) {
    const meta = await this.getTable(table);
    const { where, params } = this.buildWhere(meta, opts);
    const orderBy = (opts.sorts ?? [])
      .map((s) => {
        assertKnownColumn(meta, s.column);
        return `${q(s.column)} ${s.dir === "desc" ? "DESC" : "ASC"}`;
      })
      .join(", ");
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;
    const rows = this.db
      .prepare(`SELECT * FROM ${q(table)} ${where} ${orderBy ? `ORDER BY ${orderBy}` : ""} LIMIT ${limit} OFFSET ${offset}`)
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

  async runRawQuery(sql: string): Promise<QueryResult> {
    assertNoFileAccess(sql);
    const trimmed = sql.trim().toLowerCase();
    if (trimmed.startsWith("select") || trimmed.startsWith("pragma") || trimmed.startsWith("explain")) {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all() as Row[];
      const columns = stmt.columns().map((c) => c.name);
      return { columns, rows, rowCount: rows.length };
    }
    const info = this.db.prepare(sql).run();
    return { columns: [], rows: [], rowCount: info.changes };
  }

  async runStatement(sql: string): Promise<void> {
    assertNoFileAccess(sql);
    this.db.exec(sql);
  }

  async runScript(sql: string): Promise<ImportReport> {
    const statements = splitSqlStatements(sql);
    const report: ImportReport = { executed: 0, failed: [] };
    for (let i = 0; i < statements.length; i++) {
      try {
        await this.runStatement(statements[i]);
        report.executed++;
      } catch (err) {
        report.failed.push({
          statement: i + 1,
          sql: statements[i].slice(0, 200),
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return report;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
