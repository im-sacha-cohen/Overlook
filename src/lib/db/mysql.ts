import mysql, { type Pool } from "mysql2/promise";
import type { AggregateFn, ColumnMeta, LogicalType, QueryResult, Row, RowQuery, TableMeta } from "../types";
import {
  assertCreatableType,
  assertKnownColumn,
  assertValidIdentifier,
  ReadOnlyViolation,
  ScriptSessionLost,
  SCRIPT_BATCH_MS,
  SCRIPT_BATCH_SIZE,
  EXACT_COUNT_BELOW,
  groupStatements,
  referencingFirst,
  runOneByOne,
  coerceRowValues,
  previewWithAdapter,
  type DatabaseAdapter,
  type BulkInsertOptions,
  type DropTablesOptions,
  type ScriptSession,
  type SelectOptions,
  type SqlStatement,
  type WriteOp,
  type WritePreview,
} from "./adapter";
import { aggregateResult, buildAggregate, buildDistinctValues, buildOrderBy, buildWhere, distinctQueryTables, distinctRows, loadRelatedTables, topDistinct, applyPreviews, previewSelectList } from "./where";
import { leadingKeyword, normalizeMysqlDateLiterals, splitSqlStatements, transactionControl } from "./splitSqlStatements";
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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
    const conn = await this.pool.getConnection();
    let rows: mysql.RowDataPacket[];
    try {
      // MySQL 8 caches these statistics for a day by default: ask for current ones (older servers don't know the setting).
      await conn.query("SET SESSION information_schema_stats_expiry = 0").catch(() => {});
      [rows] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT TABLE_NAME AS name, TABLE_ROWS AS estimate, ENGINE AS engine FROM information_schema.tables
         WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
        [this.database]
      );
    } finally {
      conn.release();
    }
    const described = await this.describeTables();
    return Promise.all(
      rows.map(async (r) => {
        const name = r.name as string;
        const estimate = Number(r.estimate ?? 0);
        const meta = { name, columns: described.get(name) ?? [], rowCount: estimate };
        // MyISAM keeps an exact count; InnoDB's is an estimate, worth replacing only while counting is cheap.
        if (String(r.engine).toLowerCase() === "myisam") return meta;
        if (estimate >= EXACT_COUNT_BELOW) return { ...meta, rowCountEstimated: true };
        const [countRows] = await this.pool.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS count FROM ${q(name)}`);
        return { ...meta, rowCount: Number(countRows[0]?.count ?? 0) };
      }),
    );
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
    const meta = await this.describeTable(table);
    const [countRows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM ${q(table)}`
    );
    return { ...meta, rowCount: Number(countRows[0]?.count ?? 0) };
  }

  /** The table's columns, without counting its rows (a full scan on a big InnoDB table). */
  private async describeTable(table: string): Promise<TableMeta> {
    assertValidIdentifier(table);
    return { name: table, columns: (await this.describeTables(table)).get(table) ?? [], rowCount: 0 };
  }

  /** Columns of one table, or of all of them at once (two queries whatever their number). */
  private async describeTables(table?: string): Promise<Map<string, ColumnMeta[]>> {
    const only = table ? " AND TABLE_NAME = ?" : "";
    const args = table ? [this.database, table] : [this.database];
    const [colRows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
       FROM information_schema.columns WHERE TABLE_SCHEMA = ?${only} ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      args
    );
    const [fkRows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ?${only} AND REFERENCED_TABLE_NAME IS NOT NULL`,
      args
    );
    const fkByColumn = new Map(fkRows.map((r) => [`${r.TABLE_NAME}\u0000${r.COLUMN_NAME}`, r]));

    const byTable = new Map<string, ColumnMeta[]>();
    for (const c of colRows) {
      const columnType = String(c.COLUMN_TYPE);
      const logical = nativeToLogical(String(c.DATA_TYPE), columnType);
      const fk = fkByColumn.get(`${c.TABLE_NAME}\u0000${c.COLUMN_NAME}`);
      const columns = byTable.get(c.TABLE_NAME as string) ?? [];
      columns.push({
        name: c.COLUMN_NAME as string,
        logicalType: fk ? "relation" : logical,
        nativeType: columnType,
        nullable: c.IS_NULLABLE === "YES",
        isPrimaryKey: c.COLUMN_KEY === "PRI",
        options: logical === "select" ? parseEnumOptions(columnType) : undefined,
        references: fk
          ? { table: fk.REFERENCED_TABLE_NAME as string, column: fk.REFERENCED_COLUMN_NAME as string }
          : undefined,
      });
      byTable.set(c.TABLE_NAME as string, columns);
    }
    return byTable;
  }

  async selectRows(table: string, opts: SelectOptions) {
    const meta = await this.describeTable(table);
    const { where, params } = buildWhere("mysql", meta, opts, await loadRelatedTables(meta, opts, (t) => this.getTable(t)));
    const orderBy = buildOrderBy("mysql", meta, opts.sorts);
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;

    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT ${opts.preview ? previewSelectList("mysql", meta, { text: opts.preview !== "files" }) : "*"} FROM ${q(table)} ${where} ${orderBy} LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    if (opts.preview) applyPreviews(rows as Row[]);
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
      case "emptyTables": {
        const plan = await this.emptyPlan(op.tables, op.ignoreForeignKeys === true);
        const statements = plan.statements.map((sql) => ({ sql, params: [] }));
        if (plan.checks) return statements;
        return [{ sql: "SET FOREIGN_KEY_CHECKS = 0", params: [] }, ...statements, { sql: "SET FOREIGN_KEY_CHECKS = 1", params: [] }];
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
    }, { backslashEscapes: true });
  }

  async aggregate(table: string, query: RowQuery, specs: { column: string; fn: AggregateFn }[]) {
    if (specs.length === 0) return {};
    const meta = await this.getTable(table);
    const { sql, params, keys } = buildAggregate("mysql", meta, query, specs, await loadRelatedTables(meta, query, (t) => this.getTable(t)));
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(sql, params);
    return aggregateResult(keys, rows[0]);
  }

  async distinctValues(table: string, column: string, query?: string, options: { via?: string[]; within?: RowQuery } = {}) {
    const meta = await this.getTable(table);
    const lookup = await loadRelatedTables(meta, distinctQueryTables(column, options.via, options.within), (t) => this.getTable(t));
    const { sql, params } = buildDistinctValues("mysql", meta, column, query, 500, { ...options, lookup });
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(sql, params);
    return topDistinct(distinctRows(rows as { value: unknown; count: unknown; id?: unknown }[]), query);
  }

  async selectRowsByPk(table: string, pkColumn: string, pkValues: unknown[]): Promise<Row[]> {
    if (pkValues.length === 0) return [];
    assertKnownColumn(await this.describeTable(table), pkColumn);
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
    await this.withForeignKeyChecks(!ignoreForeignKeys, [`DROP TABLE ${tables.map(q).join(", ")}`]);
  }

  async emptyTables(tables: string[], { ignoreForeignKeys = false }: DropTablesOptions = {}): Promise<void> {
    const plan = await this.emptyPlan(tables, ignoreForeignKeys);
    await this.withForeignKeyChecks(plan.checks, plan.statements);
  }

  /**
   * TRUNCATE (fast, restarts AUTO_INCREMENT) refuses any table a foreign key points
   * to, even from a table emptied alongside. When every such key comes from the
   * tables being emptied, nothing can be left orphaned: TRUNCATE with the checks off.
   * When a table outside points to them, DELETE referencing tables first with the
   * checks on, so it fails only if rows there still point in, then restart the counters.
   */
  private async emptyPlan(tables: string[], ignoreForeignKeys: boolean): Promise<{ checks: boolean; statements: string[] }> {
    tables.forEach(assertValidIdentifier);
    const truncate = { checks: false, statements: tables.map((table) => `TRUNCATE TABLE ${q(table)}`) };
    if (ignoreForeignKeys) return truncate;
    const [keys] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME AS fromTable, REFERENCED_TABLE_NAME AS toTable FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IN (?)`,
      [this.database, this.database, tables],
    );
    const references = keys as { fromTable: string; toTable: string }[];
    if (references.every((r) => tables.includes(r.fromTable))) return truncate;
    const order = referencingFirst(tables, references);
    return {
      checks: true,
      statements: [...order.map((table) => `DELETE FROM ${q(table)}`), ...order.map((table) => `ALTER TABLE ${q(table)} AUTO_INCREMENT = 1`)],
    };
  }

  /** Runs the statements on one connection, with foreign key checks off for them when `checks` is false. */
  private async withForeignKeyChecks(checks: boolean, statements: string[]): Promise<void> {
    const ignoreForeignKeys = !checks;
    // FOREIGN_KEY_CHECKS is per session: set and restore it on one pooled connection.
    const conn = await this.pool.getConnection();
    let restored = true;
    try {
      if (ignoreForeignKeys) {
        restored = false;
        await conn.query("SET FOREIGN_KEY_CHECKS = 0");
      }
      for (const sql of statements) await conn.query(sql);
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

  async bulkInsert(table: string, rows: Row[], { onConflict = "error" }: BulkInsertOptions = {}): Promise<number> {
    if (rows.length === 0) return 0;
    // Columns only: counting the rows would scan the table at every batch of a big copy.
    const meta = await this.describeTable(table);
    rows = rows.map((r) => coerceRowValues(meta, r));
    const cols = Object.keys(rows[0]).filter((k) => meta.columns.some((c) => c.name === k));
    cols.forEach((c) => assertKnownColumn(meta, c));
    const pk = meta.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
    const updated = cols.filter((c) => !pk.includes(c));
    // A no-op update rather than INSERT IGNORE, which would also swallow other errors
    // (a NULL in a NOT NULL column, a value too long…).
    const suffix =
      onConflict === "replace" && updated.length > 0
        ? ` ON DUPLICATE KEY UPDATE ${updated.map((c) => `${q(c)} = VALUES(${q(c)})`).join(", ")}`
        : onConflict !== "error"
          ? ` ON DUPLICATE KEY UPDATE ${q(cols[0])} = ${q(cols[0])}`
          : "";
    const sql = `INSERT INTO ${q(table)} (${cols.map(q).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})${suffix}`;
    const conn = await this.pool.getConnection();
    let written = 0;
    try {
      await conn.beginTransaction();
      // mysql2 reports found rather than changed rows: a skipped row would count as
      // written. With a one-column key, the rows already there are left out beforehand.
      if (onConflict === "skip" && pk.length === 1 && cols.includes(pk[0])) {
        const [existing] = await conn.query<mysql.RowDataPacket[]>(
          `SELECT ${q(pk[0])} AS k FROM ${q(table)} WHERE ${q(pk[0])} IN (${rows.map(() => "?").join(", ")})`,
          rows.map((r) => r[pk[0]])
        );
        const taken = new Set(existing.map((r) => String(r.k)));
        rows = rows.filter((r) => !taken.has(String(r[pk[0]])));
      }
      for (const row of rows) {
        const [result] = await conn.query<mysql.ResultSetHeader>(sql, cols.map((c) => row[c]));
        // 1 for an insert, 2 for an update; a row left as it was counts as found.
        if (result.affectedRows > 0) written += 1;
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return written;
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

  async openScriptSession(): Promise<ScriptSession> {
    const connection = await this.pool.getConnection();
    let lost: Error | null = null;
    connection.on("error", (err: Error) => (lost = err));
    connection.on("end", () => (lost ??= new Error("fermée par le serveur")));
    // Batches ride on autocommit off plus a COMMIT now and then, rather than START
    // TRANSACTION, which would release the LOCK TABLES dumps put around their INSERTs.
    await connection.query("SET autocommit = 0");
    // The script's own transaction, or its own autocommit off: it commits, not us.
    let scriptTransaction = false;
    let scriptAutocommitOff = false;
    let pending = 0;
    let batchStarted = Date.now();
    const scriptInCharge = () => scriptTransaction || scriptAutocommitOff;
    // Set once a rollback turns out not to undo everything (MyISAM): groups can't be replayed then.
    let nonTransactional = false;
    const query = async (sql: string) => {
      if (lost) throw new ScriptSessionLost(lost, pending);
      try {
        return (await connection.query(sql))[0];
      } catch (err) {
        if (lost || (err as { fatal?: boolean }).fatal) throw new ScriptSessionLost(lost ?? err, pending);
        throw err;
      }
    };
    const commit = async () => {
      if (pending > 0) await query("COMMIT");
      pending = 0;
      batchStarted = Date.now();
    };
    const counted = async (statements: number) => {
      if (scriptInCharge()) return;
      pending += statements;
      if (pending >= SCRIPT_BATCH_SIZE || Date.now() - batchStarted > SCRIPT_BATCH_MS) await commit();
    };
    const session: ScriptSession = {
      runMany: async (statements) => {
        const results: unknown[] = [];
        for (const { start, end, together } of groupStatements(statements, leadingKeyword)) {
          const group = statements.slice(start, end);
          if (together && !nonTransactional) {
            try {
              await query(`SAVEPOINT overlook_group;\n${group.map(normalizeMysqlDateLiterals).join("\n;\n")}\n;\nRELEASE SAVEPOINT overlook_group`);
              results.push(...group.map(() => null));
              await counted(group.length);
              continue;
            } catch (err) {
              if (err instanceof ScriptSessionLost) throw err;
              if ((err as { errno?: number }).errno === 1213) {
                // A deadlock rolled the whole transaction back: stop, saying what was lost.
                throw new Error(`${errorText(err)} (MySQL a annulé le lot en cours : les ${pending + group.length} dernière(s) instruction(s) ne sont pas enregistrées)`);
              }
              // One of them failed: undo the group, then run it one by one to know which.
              const undo = (await query("ROLLBACK TO SAVEPOINT overlook_group")) as { warningStatus?: number };
              if (undo?.warningStatus) {
                // Part of the group stayed in a non-transactional table: running it again would double it.
                nonTransactional = true;
                results.push(...group.map(() => new Error(`${errorText(err)} (groupe d'instructions interrompu sur une table non transactionnelle : certaines ont pu s'exécuter, à vérifier)`)));
                continue;
              }
            }
          }
          results.push(...(await runOneByOne(session, group)));
        }
        return results;
      },
      run: async (sql) => {
        const control = transactionControl(sql);
        if (control && !scriptInCharge()) await commit();
        try {
          await query(normalizeMysqlDateLiterals(sql));
        } catch (err) {
          // A deadlock rolls the whole transaction back, not just the statement.
          if ((err as { errno?: number }).errno === 1213 && pending > 0) {
            const lostCount = pending;
            pending = 0;
            throw new Error(`${errorText(err)} (MySQL a aussi annulé les ${lostCount} instruction(s) précédente(s) de son lot)`);
          }
          throw err;
        }
        if (control === "begin") scriptTransaction = true;
        else if (control === "end") scriptTransaction = false;
        else if (control === "autocommitOff") scriptAutocommitOff = true;
        else if (control === "autocommitOn") {
          // Back to one commit per statement for the script; we keep batching.
          scriptAutocommitOff = false;
          await query("SET autocommit = 0");
        }
        if (!control) await counted(1);
      },
      close: async () => {
        try {
          // What the script left uncommitted is rolled back, as the mysql client does on exit.
          if (!lost) await query(scriptInCharge() ? "ROLLBACK" : "COMMIT");
        } finally {
          // Thrown away rather than handed back to the pool: a dump's SET FOREIGN_KEY_CHECKS=0 would stick to it.
          connection.destroy();
        }
      },
    };
    return session;
  }

  async close(): Promise<void> {
    await Promise.all([this.pool.end(), this.singleStatementPool.end()]);
  }
}
