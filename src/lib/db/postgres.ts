import { Pool, type PoolClient } from "pg";
import type { Connection, ColumnMeta, LogicalType, QueryResult, Row, TableMeta } from "../types";
import {
  assertKnownColumn,
  assertValidIdentifier,
  filterOpToSql,
  primaryKeyOf,
  type DatabaseAdapter,
  type ImportReport,
  type SelectOptions,
} from "./adapter";
import { splitSqlStatements } from "./splitSqlStatements";

const CREATABLE_TYPE_SQL: Record<Exclude<LogicalType, "relation" | "unknown">, string> = {
  text: "text",
  number: "double precision",
  select: "text",
  date: "timestamptz",
  checkbox: "boolean",
  json: "jsonb",
};

function nativeToLogical(nativeType: string): LogicalType {
  const t = nativeType.toLowerCase();
  if (t === "boolean") return "checkbox";
  if (t.includes("timestamp") || t === "date") return "date";
  if (["integer", "bigint", "smallint", "numeric", "decimal", "real", "double precision"].includes(t))
    return "number";
  if (t === "json" || t === "jsonb") return "json";
  if (t === "user-defined") return "select";
  if (["text", "character varying", "character", "uuid", "varchar", "char"].includes(t)) return "text";
  return "unknown";
}

function q(ident: string): string {
  assertValidIdentifier(ident);
  return `"${ident}"`;
}

export class PostgresAdapter implements DatabaseAdapter {
  private pool: Pool;

  constructor(conn: Connection & { password?: string }) {
    this.pool = new Pool({
      host: conn.host,
      port: conn.port ?? 5432,
      database: conn.database,
      user: conn.user,
      password: conn.password,
      ssl: conn.ssl ? { rejectUnauthorized: false } : undefined,
      max: 5,
    });
  }

  async testConnection(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
  }

  async listTables(): Promise<TableMeta[]> {
    const client = await this.pool.connect();
    try {
      const { rows: tableRows } = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         ORDER BY table_name`
      );
      const tables: TableMeta[] = [];
      for (const t of tableRows) {
        tables.push(await this.loadTable(client, t.table_name));
      }
      return tables;
    } finally {
      client.release();
    }
  }

  async createTable(table: string, columns: { name: string; type: LogicalType }[]): Promise<void> {
    assertValidIdentifier(table);
    const colDefs = columns.map((c) => {
      assertValidIdentifier(c.name);
      if (c.type === "relation" || c.type === "unknown") throw new Error(`Cannot create a column of type ${c.type}`);
      return `${q(c.name)} ${CREATABLE_TYPE_SQL[c.type]}`;
    });
    const client = await this.pool.connect();
    try {
      await client.query(
        `CREATE TABLE ${q(table)} (id SERIAL PRIMARY KEY${colDefs.length ? ", " + colDefs.join(", ") : ""})`
      );
    } finally {
      client.release();
    }
  }

  async getTable(table: string): Promise<TableMeta> {
    const client = await this.pool.connect();
    try {
      return await this.loadTable(client, table);
    } finally {
      client.release();
    }
  }

  private async loadTable(client: PoolClient, table: string): Promise<TableMeta> {
    assertValidIdentifier(table);
    const { rows: colRows } = await client.query<{
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, udt_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [table]
    );

    const { rows: pkRows } = await client.query<{ column_name: string }>(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'`,
      [table]
    );
    const pkNames = new Set(pkRows.map((r) => r.column_name));

    const { rows: fkRows } = await client.query<{
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
    }>(
      `SELECT kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
       WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'FOREIGN KEY'`,
      [table]
    );
    const fkByColumn = new Map(fkRows.map((r) => [r.column_name, r]));

    const columns: ColumnMeta[] = [];
    for (const c of colRows) {
      let logicalType = nativeToLogical(c.data_type);
      let options: string[] | undefined;
      if (c.data_type.toLowerCase() === "user-defined") {
        const { rows: enumRows } = await client.query<{ enumlabel: string }>(
          `SELECT e.enumlabel FROM pg_type t
           JOIN pg_enum e ON t.oid = e.enumtypid
           WHERE t.typname = $1 ORDER BY e.enumsortorder`,
          [c.udt_name]
        );
        if (enumRows.length > 0) {
          logicalType = "select";
          options = enumRows.map((r) => r.enumlabel);
        }
      }
      const fk = fkByColumn.get(c.column_name);
      columns.push({
        name: c.column_name,
        logicalType: fk ? "relation" : logicalType,
        nativeType: c.data_type === "USER-DEFINED" ? c.udt_name : c.data_type,
        nullable: c.is_nullable === "YES",
        isPrimaryKey: pkNames.has(c.column_name),
        options,
        references: fk ? { table: fk.foreign_table_name, column: fk.foreign_column_name } : undefined,
      });
    }

    const { rows: countRows } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${q(table)}`
    );

    return { name: table, columns, rowCount: Number(countRows[0]?.count ?? 0) };
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

    const client = await this.pool.connect();
    try {
      const sql = `SELECT * FROM ${q(table)} ${where} ${orderBy ? `ORDER BY ${orderBy}` : ""} LIMIT ${limit} OFFSET ${offset}`;
      const { rows } = await client.query(sql, params);
      const countRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${q(table)} ${where}`,
        params
      );
      return { rows, total: Number(countRes.rows[0]?.count ?? 0) };
    } finally {
      client.release();
    }
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
      return `${q(f.column)}::text ${op} $${params.length}`;
    });
    return { where: `WHERE ${clauses.join(" AND ")}`, params };
  }

  async insertRow(table: string, values: Row): Promise<Row> {
    const meta = await this.getTable(table);
    const cols = Object.keys(values).filter((k) => meta.columns.some((c) => c.name === k));
    cols.forEach((c) => assertKnownColumn(meta, c));
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const client = await this.pool.connect();
    try {
      const sql =
        cols.length === 0
          ? `INSERT INTO ${q(table)} DEFAULT VALUES RETURNING *`
          : `INSERT INTO ${q(table)} (${cols.map(q).join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`;
      const { rows } = await client.query(sql, cols.map((c) => values[c]));
      return rows[0];
    } finally {
      client.release();
    }
  }

  async updateRow(table: string, pkColumn: string, pkValue: unknown, values: Row): Promise<void> {
    const meta = await this.getTable(table);
    const cols = Object.keys(values).filter((k) => meta.columns.some((c) => c.name === k));
    cols.forEach((c) => assertKnownColumn(meta, c));
    assertKnownColumn(meta, pkColumn);
    if (cols.length === 0) return;
    const setClause = cols.map((c, i) => `${q(c)} = $${i + 1}`).join(", ");
    const client = await this.pool.connect();
    try {
      const sql = `UPDATE ${q(table)} SET ${setClause} WHERE ${q(pkColumn)} = $${cols.length + 1}`;
      await client.query(sql, [...cols.map((c) => values[c]), pkValue]);
    } finally {
      client.release();
    }
  }

  async updateRows(table: string, pkColumn: string, pkValues: unknown[], values: Row): Promise<number> {
    if (pkValues.length === 0) return 0;
    const meta = await this.getTable(table);
    const cols = Object.keys(values).filter((k) => meta.columns.some((c) => c.name === k));
    cols.forEach((c) => assertKnownColumn(meta, c));
    assertKnownColumn(meta, pkColumn);
    if (cols.length === 0) return 0;
    const setClause = cols.map((c, i) => `${q(c)} = $${i + 1}`).join(", ");
    const pkPlaceholders = pkValues.map((_, i) => `$${cols.length + i + 1}`).join(", ");
    const client = await this.pool.connect();
    try {
      const sql = `UPDATE ${q(table)} SET ${setClause} WHERE ${q(pkColumn)} IN (${pkPlaceholders})`;
      const res = await client.query(sql, [...cols.map((c) => values[c]), ...pkValues]);
      return res.rowCount ?? 0;
    } finally {
      client.release();
    }
  }

  async deleteRow(table: string, pkColumn: string, pkValue: unknown): Promise<void> {
    const meta = await this.getTable(table);
    assertKnownColumn(meta, pkColumn);
    const client = await this.pool.connect();
    try {
      await client.query(`DELETE FROM ${q(table)} WHERE ${q(pkColumn)} = $1`, [pkValue]);
    } finally {
      client.release();
    }
  }

  async deleteRows(table: string, pkColumn: string, pkValues: unknown[]): Promise<number> {
    if (pkValues.length === 0) return 0;
    const meta = await this.getTable(table);
    assertKnownColumn(meta, pkColumn);
    const placeholders = pkValues.map((_, i) => `$${i + 1}`).join(", ");
    const client = await this.pool.connect();
    try {
      const res = await client.query(`DELETE FROM ${q(table)} WHERE ${q(pkColumn)} IN (${placeholders})`, pkValues);
      return res.rowCount ?? 0;
    } finally {
      client.release();
    }
  }

  async addColumn(table: string, name: string, type: LogicalType): Promise<void> {
    assertValidIdentifier(name);
    if (type === "relation" || type === "unknown") throw new Error(`Cannot create a column of type ${type}`);
    const client = await this.pool.connect();
    try {
      await client.query(`ALTER TABLE ${q(table)} ADD COLUMN ${q(name)} ${CREATABLE_TYPE_SQL[type]}`);
    } finally {
      client.release();
    }
  }

  async renameColumn(table: string, oldName: string, newName: string): Promise<void> {
    assertValidIdentifier(newName);
    const meta = await this.getTable(table);
    assertKnownColumn(meta, oldName);
    const client = await this.pool.connect();
    try {
      await client.query(`ALTER TABLE ${q(table)} RENAME COLUMN ${q(oldName)} TO ${q(newName)}`);
    } finally {
      client.release();
    }
  }

  async changeColumnType(table: string, column: string, type: LogicalType): Promise<void> {
    if (type === "relation" || type === "unknown") throw new Error(`Cannot change to type ${type}`);
    const meta = await this.getTable(table);
    assertKnownColumn(meta, column);
    const client = await this.pool.connect();
    try {
      await client.query(
        `ALTER TABLE ${q(table)} ALTER COLUMN ${q(column)} TYPE ${CREATABLE_TYPE_SQL[type]} USING ${q(column)}::text::${CREATABLE_TYPE_SQL[type]}`
      );
    } finally {
      client.release();
    }
  }

  async dropColumn(table: string, column: string): Promise<void> {
    const meta = await this.getTable(table);
    assertKnownColumn(meta, column);
    const client = await this.pool.connect();
    try {
      await client.query(`ALTER TABLE ${q(table)} DROP COLUMN ${q(column)}`);
    } finally {
      client.release();
    }
  }

  async dropTable(table: string): Promise<void> {
    assertValidIdentifier(table);
    const client = await this.pool.connect();
    try {
      await client.query(`DROP TABLE ${q(table)}`);
    } finally {
      client.release();
    }
  }

  async bulkInsert(table: string, rows: Row[]): Promise<number> {
    if (rows.length === 0) return 0;
    const meta = await this.getTable(table);
    const cols = Object.keys(rows[0]).filter((k) => meta.columns.some((c) => c.name === k));
    cols.forEach((c) => assertKnownColumn(meta, c));
    const client = await this.pool.connect();
    let inserted = 0;
    try {
      await client.query("BEGIN");
      for (const row of rows) {
        const placeholders = cols.map((_, i) => `$${i + 1}`);
        await client.query(
          `INSERT INTO ${q(table)} (${cols.map(q).join(", ")}) VALUES (${placeholders.join(", ")})`,
          cols.map((c) => row[c])
        );
        inserted += 1;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return inserted;
  }

  async runRawQuery(sql: string): Promise<QueryResult> {
    const client = await this.pool.connect();
    try {
      const res = await client.query(sql);
      const columns = res.fields?.map((f) => f.name) ?? Object.keys(res.rows[0] ?? {});
      return { columns, rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
    } finally {
      client.release();
    }
  }

  async runStatement(sql: string): Promise<void> {
    await this.pool.query(sql);
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

export { primaryKeyOf };
