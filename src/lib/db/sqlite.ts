import Database from "better-sqlite3";
import type { Connection, ColumnMeta, LogicalType, QueryResult, Row, TableMeta } from "../types";
import { assertKnownColumn, assertValidIdentifier, filterOpToSql, type DatabaseAdapter, type ImportReport, type SelectOptions } from "./adapter";
import { splitSqlStatements } from "./splitSqlStatements";

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
    this.db = new Database(conn.database);
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
    if (filters.length === 0) return { where: "", params: [] };
    const params: unknown[] = [];
    const clauses = filters.map((f) => {
      assertKnownColumn(meta, f.column);
      const op = filterOpToSql(f.op);
      params.push(op === "LIKE" ? `%${f.value}%` : f.value);
      return `CAST(${q(f.column)} AS TEXT) ${op} ?`;
    });
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

  async updateRows(table: string, pkColumn: string, pkValues: unknown[], values: Row): Promise<number> {
    if (pkValues.length === 0) return 0;
    const meta = await this.getTable(table);
    const cols = Object.keys(values).filter((k) => meta.columns.some((c) => c.name === k));
    cols.forEach((c) => assertKnownColumn(meta, c));
    assertKnownColumn(meta, pkColumn);
    if (cols.length === 0) return 0;
    const setClause = cols.map((c) => `${q(c)} = ?`).join(", ");
    const placeholders = pkValues.map(() => "?").join(", ");
    const info = this.db
      .prepare(`UPDATE ${q(table)} SET ${setClause} WHERE ${q(pkColumn)} IN (${placeholders})`)
      .run(...cols.map((c) => coerceParam(values[c])), ...pkValues.map(coerceParam));
    return info.changes;
  }

  async deleteRow(table: string, pkColumn: string, pkValue: unknown): Promise<void> {
    const meta = await this.getTable(table);
    assertKnownColumn(meta, pkColumn);
    this.db.prepare(`DELETE FROM ${q(table)} WHERE ${q(pkColumn)} = ?`).run(coerceParam(pkValue));
  }

  async deleteRows(table: string, pkColumn: string, pkValues: unknown[]): Promise<number> {
    if (pkValues.length === 0) return 0;
    const meta = await this.getTable(table);
    assertKnownColumn(meta, pkColumn);
    const placeholders = pkValues.map(() => "?").join(", ");
    const info = this.db
      .prepare(`DELETE FROM ${q(table)} WHERE ${q(pkColumn)} IN (${placeholders})`)
      .run(...pkValues.map(coerceParam));
    return info.changes;
  }

  async addColumn(table: string, name: string, type: LogicalType): Promise<void> {
    assertValidIdentifier(name);
    if (type === "relation" || type === "unknown") throw new Error(`Cannot create a column of type ${type}`);
    this.db.exec(`ALTER TABLE ${q(table)} ADD COLUMN ${q(name)} ${CREATABLE_TYPE_SQL[type]}`);
  }

  async renameColumn(table: string, oldName: string, newName: string): Promise<void> {
    assertValidIdentifier(newName);
    const meta = await this.getTable(table);
    assertKnownColumn(meta, oldName);
    this.db.exec(`ALTER TABLE ${q(table)} RENAME COLUMN ${q(oldName)} TO ${q(newName)}`);
  }

  async changeColumnType(table: string, column: string, type: LogicalType): Promise<void> {
    if (type === "relation" || type === "unknown") throw new Error(`Cannot change to type ${type}`);
    const meta = await this.getTable(table);
    assertKnownColumn(meta, column);
    const tmpName = `${table}__overlook_tmp`;
    const colDefs = meta.columns
      .map((c) => {
        const sqlType = c.name === column ? CREATABLE_TYPE_SQL[type] : c.nativeType || "TEXT";
        const notnull = c.nullable ? "" : " NOT NULL";
        const pk = c.isPrimaryKey ? " PRIMARY KEY" : "";
        return `${q(c.name)} ${sqlType}${pk}${notnull}`;
      })
      .join(", ");
    const colNames = meta.columns.map((c) => q(c.name)).join(", ");
    const selectExprs = meta.columns
      .map((c) => (c.name === column ? `CAST(${q(c.name)} AS ${CREATABLE_TYPE_SQL[type]})` : q(c.name)))
      .join(", ");
    const txn = this.db.transaction(() => {
      this.db.exec(`CREATE TABLE ${q(tmpName)} (${colDefs})`);
      this.db.exec(`INSERT INTO ${q(tmpName)} (${colNames}) SELECT ${selectExprs} FROM ${q(table)}`);
      this.db.exec(`DROP TABLE ${q(table)}`);
      this.db.exec(`ALTER TABLE ${q(tmpName)} RENAME TO ${q(table)}`);
    });
    txn();
  }

  async dropColumn(table: string, column: string): Promise<void> {
    const meta = await this.getTable(table);
    assertKnownColumn(meta, column);
    this.db.exec(`ALTER TABLE ${q(table)} DROP COLUMN ${q(column)}`);
  }

  async dropTable(table: string): Promise<void> {
    assertValidIdentifier(table);
    this.db.exec(`DROP TABLE ${q(table)}`);
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
