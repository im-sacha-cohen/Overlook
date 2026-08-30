import mysql, { type Pool } from "mysql2/promise";
import type { Connection, ColumnMeta, LogicalType, QueryResult, Row, TableMeta } from "../types";
import { assertKnownColumn, assertValidIdentifier, filterOpToSql, type DatabaseAdapter, type ImportReport, type SelectOptions } from "./adapter";
import { normalizeMysqlDateLiterals, splitSqlStatements } from "./splitSqlStatements";

const CREATABLE_TYPE_SQL: Record<Exclude<LogicalType, "relation" | "unknown">, string> = {
  text: "text",
  number: "double",
  select: "varchar(255)",
  date: "datetime",
  checkbox: "tinyint(1)",
  json: "json",
};

function nativeToLogical(dataType: string, columnType: string): LogicalType {
  const t = dataType.toLowerCase();
  if (t === "tinyint" && columnType.toLowerCase() === "tinyint(1)") return "checkbox";
  if (["int", "bigint", "smallint", "mediumint", "decimal", "float", "double"].includes(t)) return "number";
  if (["date", "datetime", "timestamp"].includes(t)) return "date";
  if (t === "json") return "json";
  if (t === "enum") return "select";
  if (["varchar", "char", "text", "tinytext", "mediumtext", "longtext"].includes(t)) return "text";
  return "unknown";
}

function parseEnumOptions(columnType: string): string[] {
  const match = /^enum\((.*)\)$/i.exec(columnType.trim());
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim().replace(/^'/, "").replace(/'$/, "").replace(/''/g, "'"));
}

function q(ident: string): string {
  assertValidIdentifier(ident);
  return `\`${ident}\``;
}

export class MySqlAdapter implements DatabaseAdapter {
  private pool: Pool;
  private database: string;

  constructor(conn: Connection & { password?: string }) {
    this.database = conn.database;
    this.pool = mysql.createPool({
      host: conn.host,
      port: conn.port ?? 3306,
      database: conn.database,
      user: conn.user,
      password: conn.password,
      ssl: conn.ssl ? {} : undefined,
      connectionLimit: 5,
      multipleStatements: true,
    });
  }

  async testConnection(): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.query("SELECT 1");
    } finally {
      conn.release();
    }
  }

  async listTables(): Promise<TableMeta[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME AS name FROM information_schema.tables
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
      [this.database]
    );
    const tables: TableMeta[] = [];
    for (const r of rows) {
      tables.push(await this.getTable(r.name as string));
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
    await this.pool.query(
      `CREATE TABLE ${q(table)} (id INT AUTO_INCREMENT PRIMARY KEY${colDefs.length ? ", " + colDefs.join(", ") : ""})`
    );
  }

  async getTable(table: string): Promise<TableMeta> {
    assertValidIdentifier(table);
    const [colRows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
       FROM information_schema.columns WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [this.database, table]
    );
    const [fkRows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [this.database, table]
    );
    const fkByColumn = new Map(fkRows.map((r) => [r.COLUMN_NAME as string, r]));

    const columns: ColumnMeta[] = colRows.map((c) => {
      const columnType = String(c.COLUMN_TYPE);
      const logical = nativeToLogical(String(c.DATA_TYPE), columnType);
      const fk = fkByColumn.get(c.COLUMN_NAME as string);
      return {
        name: c.COLUMN_NAME as string,
        logicalType: fk ? "relation" : logical,
        nativeType: columnType,
        nullable: c.IS_NULLABLE === "YES",
        isPrimaryKey: c.COLUMN_KEY === "PRI",
        options: logical === "select" ? parseEnumOptions(columnType) : undefined,
        references: fk
          ? { table: fk.REFERENCED_TABLE_NAME as string, column: fk.REFERENCED_COLUMN_NAME as string }
          : undefined,
      };
    });

    const [countRows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM ${q(table)}`
    );
    return { name: table, columns, rowCount: Number(countRows[0]?.count ?? 0) };
  }

  private buildWhere(meta: TableMeta, opts: SelectOptions): { where: string; params: unknown[] } {
    const filters = opts.filters ?? [];
    if (filters.length === 0) return { where: "", params: [] };
    const params: unknown[] = [];
    const clauses = filters.map((f) => {
      assertKnownColumn(meta, f.column);
      const op = filterOpToSql(f.op);
      if (op === "LIKE") {
        params.push(`%${f.value}%`);
      } else {
        params.push(f.value);
      }
      return `CAST(${q(f.column)} AS CHAR) ${op} ?`;
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

    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT * FROM ${q(table)} ${where} ${orderBy ? `ORDER BY ${orderBy}` : ""} LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const [countRows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM ${q(table)} ${where}`,
      params
    );
    return { rows: rows as Row[], total: Number(countRows[0]?.count ?? 0) };
  }

  async insertRow(table: string, values: Row): Promise<Row> {
    const meta = await this.getTable(table);
    const cols = Object.keys(values).filter((k) => meta.columns.some((c) => c.name === k));
    cols.forEach((c) => assertKnownColumn(meta, c));
    const sql =
      cols.length === 0
        ? `INSERT INTO ${q(table)} () VALUES ()`
        : `INSERT INTO ${q(table)} (${cols.map(q).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    const [result] = await this.pool.query<mysql.ResultSetHeader>(
      sql,
      cols.map((c) => values[c])
    );
    const pk = meta.columns.find((c) => c.isPrimaryKey);
    if (pk && result.insertId) {
      const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
        `SELECT * FROM ${q(table)} WHERE ${q(pk.name)} = ?`,
        [result.insertId]
      );
      return rows[0] as Row;
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
    await this.pool.query(`UPDATE ${q(table)} SET ${setClause} WHERE ${q(pkColumn)} = ?`, [
      ...cols.map((c) => values[c]),
      pkValue,
    ]);
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
    const [result] = await this.pool.query<mysql.ResultSetHeader>(
      `UPDATE ${q(table)} SET ${setClause} WHERE ${q(pkColumn)} IN (${placeholders})`,
      [...cols.map((c) => values[c]), ...pkValues]
    );
    return result.affectedRows;
  }

  async deleteRow(table: string, pkColumn: string, pkValue: unknown): Promise<void> {
    const meta = await this.getTable(table);
    assertKnownColumn(meta, pkColumn);
    await this.pool.query(`DELETE FROM ${q(table)} WHERE ${q(pkColumn)} = ?`, [pkValue]);
  }

  async deleteRows(table: string, pkColumn: string, pkValues: unknown[]): Promise<number> {
    if (pkValues.length === 0) return 0;
    const meta = await this.getTable(table);
    assertKnownColumn(meta, pkColumn);
    const placeholders = pkValues.map(() => "?").join(", ");
    const [result] = await this.pool.query<mysql.ResultSetHeader>(
      `DELETE FROM ${q(table)} WHERE ${q(pkColumn)} IN (${placeholders})`,
      pkValues
    );
    return result.affectedRows;
  }

  async addColumn(table: string, name: string, type: LogicalType): Promise<void> {
    assertValidIdentifier(name);
    if (type === "relation" || type === "unknown") throw new Error(`Cannot create a column of type ${type}`);
    await this.pool.query(`ALTER TABLE ${q(table)} ADD COLUMN ${q(name)} ${CREATABLE_TYPE_SQL[type]}`);
  }

  async renameColumn(table: string, oldName: string, newName: string): Promise<void> {
    assertValidIdentifier(newName);
    const meta = await this.getTable(table);
    assertKnownColumn(meta, oldName);
    await this.pool.query(`ALTER TABLE ${q(table)} RENAME COLUMN ${q(oldName)} TO ${q(newName)}`);
  }

  async changeColumnType(table: string, column: string, type: LogicalType): Promise<void> {
    if (type === "relation" || type === "unknown") throw new Error(`Cannot change to type ${type}`);
    const meta = await this.getTable(table);
    assertKnownColumn(meta, column);
    await this.pool.query(`ALTER TABLE ${q(table)} MODIFY COLUMN ${q(column)} ${CREATABLE_TYPE_SQL[type]}`);
  }

  async dropColumn(table: string, column: string): Promise<void> {
    const meta = await this.getTable(table);
    assertKnownColumn(meta, column);
    await this.pool.query(`ALTER TABLE ${q(table)} DROP COLUMN ${q(column)}`);
  }

  async dropTable(table: string): Promise<void> {
    assertValidIdentifier(table);
    await this.pool.query(`DROP TABLE ${q(table)}`);
  }

  async bulkInsert(table: string, rows: Row[]): Promise<number> {
    if (rows.length === 0) return 0;
    const meta = await this.getTable(table);
    const cols = Object.keys(rows[0]).filter((k) => meta.columns.some((c) => c.name === k));
    cols.forEach((c) => assertKnownColumn(meta, c));
    const conn = await this.pool.getConnection();
    let inserted = 0;
    try {
      await conn.beginTransaction();
      for (const row of rows) {
        await conn.query(
          `INSERT INTO ${q(table)} (${cols.map(q).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
          cols.map((c) => row[c])
        );
        inserted += 1;
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return inserted;
  }

  async runRawQuery(sql: string): Promise<QueryResult> {
    const [rows, fields] = await this.pool.query(sql);
    const rowArray = Array.isArray(rows) ? (rows as Row[]) : [];
    const columns = Array.isArray(fields) ? fields.map((f) => f.name) : Object.keys(rowArray[0] ?? {});
    return { columns, rows: rowArray, rowCount: rowArray.length };
  }

  async runStatement(sql: string): Promise<void> {
    await this.pool.query(normalizeMysqlDateLiterals(sql));
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
    await this.pool.end();
  }
}
