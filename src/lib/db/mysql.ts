import mysql, { type Pool } from "mysql2/promise";
import type { AggregateFn, ColumnMeta, LogicalType, QueryResult, Row, RowQuery, TableMeta } from "../types";
import {
  assertCreatableType,
  assertKnownColumn,
  assertValidIdentifier,
  ReadOnlyViolation,
  coerceRowValues,
  previewWithAdapter,
  type DatabaseAdapter,
  type DropTablesOptions,
  type ImportReport,
  type SelectOptions,
  type SqlStatement,
  type WriteOp,
  type WritePreview,
} from "./adapter";
import { aggregateResult, buildAggregate, buildDistinctValues, buildOrderBy, buildWhere, loadRelatedTables, topDistinct } from "./where";
import { normalizeMysqlDateLiterals, splitSqlStatements } from "./splitSqlStatements";
import net from "node:net";
import { mysqlSslOptions, type AdapterConnection } from "./network";

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
  /** One statement per call: used for read-only console queries. */
  private singleStatementPool: Pool;
  private database: string;

  constructor(conn: AdapterConnection) {
    this.database = conn.database;
    const options = {
      host: conn.host,
      port: conn.port ?? 3306,
      database: conn.database,
      user: conn.user,
      password: conn.password,
      ssl: mysqlSslOptions(conn),
      // Through a tunnel, connect to it but keep `host` for the certificate check.
      ...(conn.via ? { stream: () => net.connect(conn.via!.port, conn.via!.host) } : {}),
      connectionLimit: 5,
      multipleStatements: true,
      // Return DATE/DATETIME/TIMESTAMP exactly as MySQL shows them in the session's
      // timezone. Parsing them into JS Dates would read them in the Overlook server's
      // timezone (UTC in Docker) and shift every hour once the browser converts again.
      dateStrings: true,
    } satisfies mysql.PoolOptions;
    this.pool = mysql.createPool(options);
    this.singleStatementPool = mysql.createPool({ ...options, connectionLimit: 2, multipleStatements: false });
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

  async selectRows(table: string, opts: SelectOptions) {
    const meta = await this.getTable(table);
    const { where, params } = buildWhere("mysql", meta, opts, await loadRelatedTables(meta, opts, (t) => this.getTable(t)));
    const orderBy = buildOrderBy("mysql", meta, opts.sorts);
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;

    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT * FROM ${q(table)} ${where} ${orderBy} LIMIT ${limit} OFFSET ${offset}`,
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
    values = coerceRowValues(meta, values);
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

  async buildWrite(op: WriteOp): Promise<SqlStatement[]> {
    switch (op.kind) {
      case "updateRows": {
        const meta = await this.getTable(op.table);
        assertKnownColumn(meta, op.pkColumn);
        const values = coerceRowValues(meta, op.values);
        const cols = Object.keys(values).filter((k) => meta.columns.some((c) => c.name === k));
        if (cols.length === 0 || op.pkValues.length === 0) return [];
        return [
          {
            sql: `UPDATE ${q(op.table)} SET ${cols.map((c) => `${q(c)} = ?`).join(", ")} WHERE ${q(op.pkColumn)} IN (${op.pkValues.map(() => "?").join(", ")})`,
            params: [...cols.map((c) => values[c]), ...op.pkValues],
          },
        ];
      }
      case "deleteRows": {
        const meta = await this.getTable(op.table);
        assertKnownColumn(meta, op.pkColumn);
        if (op.pkValues.length === 0) return [];
        return [{ sql: `DELETE FROM ${q(op.table)} WHERE ${q(op.pkColumn)} IN (${op.pkValues.map(() => "?").join(", ")})`, params: op.pkValues }];
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
        assertCreatableType(op.type);
        assertKnownColumn(await this.getTable(op.table), op.column);
        return [{ sql: `ALTER TABLE ${q(op.table)} MODIFY COLUMN ${q(op.column)} ${CREATABLE_TYPE_SQL[op.type]}`, params: [] }];
      }
      case "dropColumn": {
        assertKnownColumn(await this.getTable(op.table), op.column);
        return [{ sql: `ALTER TABLE ${q(op.table)} DROP COLUMN ${q(op.column)}`, params: [] }];
      }
      case "dropTables": {
        op.tables.forEach(assertValidIdentifier);
        const drop = { sql: `DROP TABLE ${op.tables.map(q).join(", ")}`, params: [] };
        if (!op.ignoreForeignKeys) return [drop];
        return [{ sql: "SET FOREIGN_KEY_CHECKS = 0", params: [] }, drop, { sql: "SET FOREIGN_KEY_CHECKS = 1", params: [] }];
      }
    }
  }

  previewWrite(op: WriteOp): Promise<WritePreview> {
    return previewWithAdapter(this, op, "question", async (table, pkColumn, pkValues) => {
      const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM ${q(table)} WHERE ${q(pkColumn)} IN (${pkValues.map(() => "?").join(", ")})`,
        pkValues,
      );
      return Number(rows[0]?.count ?? 0);
    });
  }

  async aggregate(table: string, query: RowQuery, specs: { column: string; fn: AggregateFn }[]) {
    if (specs.length === 0) return {};
    const meta = await this.getTable(table);
    const { sql, params, keys } = buildAggregate("mysql", meta, query, specs, await loadRelatedTables(meta, query, (t) => this.getTable(t)));
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(sql, params);
    return aggregateResult(keys, rows[0]);
  }

  async distinctValues(table: string, column: string, query?: string) {
    const { sql, params } = buildDistinctValues("mysql", await this.getTable(table), column, query, 500);
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(sql, params);
    return topDistinct(rows.map((r) => ({ value: String(r.value), count: Number(r.count) })), query);
  }

  async selectRowsByPk(table: string, pkColumn: string, pkValues: unknown[]): Promise<Row[]> {
    if (pkValues.length === 0) return [];
    assertKnownColumn(await this.getTable(table), pkColumn);
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT * FROM ${q(table)} WHERE ${q(pkColumn)} IN (${pkValues.map(() => "?").join(", ")})`,
      pkValues,
    );
    return rows as Row[];
  }

  private async runStatements(statements: SqlStatement[]): Promise<void> {
    for (const st of statements) await this.pool.query(st.sql, st.params);
  }

  async updateRow(table: string, pkColumn: string, pkValue: unknown, values: Row): Promise<void> {
    const meta = await this.getTable(table);
    values = coerceRowValues(meta, values);
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
    const [st] = await this.buildWrite({ kind: "updateRows", table, pkColumn, pkValues, values });
    if (!st) return 0;
    const [result] = await this.pool.query<mysql.ResultSetHeader>(st.sql, st.params);
    return result.affectedRows;
  }

  async deleteRow(table: string, pkColumn: string, pkValue: unknown): Promise<void> {
    const meta = await this.getTable(table);
    assertKnownColumn(meta, pkColumn);
    await this.pool.query(`DELETE FROM ${q(table)} WHERE ${q(pkColumn)} = ?`, [pkValue]);
  }

  async deleteRows(table: string, pkColumn: string, pkValues: unknown[]): Promise<number> {
    const [st] = await this.buildWrite({ kind: "deleteRows", table, pkColumn, pkValues });
    if (!st) return 0;
    const [result] = await this.pool.query<mysql.ResultSetHeader>(st.sql, st.params);
    return result.affectedRows;
  }

  async addColumn(table: string, name: string, type: LogicalType): Promise<void> {
    await this.runStatements(await this.buildWrite({ kind: "addColumn", table, name, type }));
  }

  async renameColumn(table: string, oldName: string, newName: string): Promise<void> {
    await this.runStatements(await this.buildWrite({ kind: "renameColumn", table, oldName, newName }));
  }

  async changeColumnType(table: string, column: string, type: LogicalType): Promise<void> {
    await this.runStatements(await this.buildWrite({ kind: "changeColumnType", table, column, type }));
  }

  async dropColumn(table: string, column: string): Promise<void> {
    await this.runStatements(await this.buildWrite({ kind: "dropColumn", table, column }));
  }

  async dropTables(tables: string[], { ignoreForeignKeys = false }: DropTablesOptions = {}): Promise<void> {
    tables.forEach(assertValidIdentifier);
    // FOREIGN_KEY_CHECKS is per session: set and restore it on one pooled connection.
    const conn = await this.pool.getConnection();
    let restored = true;
    try {
      if (ignoreForeignKeys) {
        restored = false;
        await conn.query("SET FOREIGN_KEY_CHECKS = 0");
      }
      await conn.query(`DROP TABLE ${tables.map(q).join(", ")}`);
    } finally {
      if (!restored) {
        try {
          await conn.query("SET FOREIGN_KEY_CHECKS = 1");
          restored = true;
        } catch {
          // Never hand a session with checks off back to the pool.
        }
      }
      if (restored) conn.release();
      else conn.destroy();
    }
  }

  async bulkInsert(table: string, rows: Row[]): Promise<number> {
    if (rows.length === 0) return 0;
    const meta = await this.getTable(table);
    rows = rows.map((r) => coerceRowValues(meta, r));
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

  async runRawQuery(sql: string, { readOnly = false } = {}): Promise<QueryResult> {
    let rows: unknown;
    let fields: unknown;
    if (readOnly) {
      const conn = await this.singleStatementPool.getConnection();
      let clean = false;
      try {
        // Refuses every write for this session, DDL included.
        await conn.query("SET SESSION transaction_read_only = ON");
        [rows, fields] = await conn.query(sql);
      } catch (err) {
        const e = err as { errno?: number; code?: string };
        // 1792: write in read-only mode. A parse error on ";" means several statements.
        if (e.errno === 1792 || (e.code === "ER_PARSE_ERROR" && splitSqlStatements(sql).length > 1)) throw new ReadOnlyViolation();
        throw err;
      } finally {
        try {
          await conn.query("SET SESSION transaction_read_only = OFF");
          clean = true;
        } catch {
          // Never hand a read-only session back to the pool.
        }
        if (clean) conn.release();
        else conn.destroy();
      }
    } else {
      [rows, fields] = await this.pool.query(sql);
    }
    // Several statements return one result per statement, with a fields list for each.
    const multi = Array.isArray(fields) && fields.length > 0 && fields.every((f) => f === undefined || Array.isArray(f));
    const result = multi ? (rows as unknown[])[(rows as unknown[]).length - 1] : rows;
    const resultFields = multi ? (fields as unknown[])[(fields as unknown[]).length - 1] : fields;
    if (!Array.isArray(result)) {
      return { columns: [], rows: [], rowCount: (result as mysql.ResultSetHeader | undefined)?.affectedRows ?? 0 };
    }
    const rowArray = result as Row[];
    const columns = Array.isArray(resultFields) ? (resultFields as { name: string }[]).map((f) => f.name) : Object.keys(rowArray[0] ?? {});
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
    await Promise.all([this.pool.end(), this.singleStatementPool.end()]);
  }
}
