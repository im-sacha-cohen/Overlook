import { Pool, types as pgTypes, type CustomTypesConfig, type PoolClient } from "pg";
import type { Connection, ColumnMeta, LogicalType, QueryResult, Row, TableMeta } from "../types";
import {
  assertKnownColumn,
  coerceRowValues,
  assertValidIdentifier,
  filterOpToSql,
  primaryKeyOf,
  assertCreatableType,
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

// DATE and TIMESTAMP (without time zone) hold a wall-clock reading, not an instant.
// node-postgres would parse them in the Overlook server's timezone (UTC in Docker)
// and the browser would convert them again, shifting every hour. Hand them over
// verbatim instead; TIMESTAMPTZ keeps being parsed, since it is a real instant.
const WALL_CLOCK_TYPE_OIDS = new Set([pgTypes.builtins.DATE, pgTypes.builtins.TIMESTAMP]);
const TYPE_PARSERS: CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: "text" | "binary") =>
    WALL_CLOCK_TYPE_OIDS.has(oid) && format !== "binary"
      ? (value: string) => value
      : pgTypes.getTypeParser(oid, format as "text")) as CustomTypesConfig["getTypeParser"],
};

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
      types: TYPE_PARSERS,
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
    const search = opts.search?.trim();
    if (filters.length === 0 && !search) return { where: "", params: [] };
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
    if (search && meta.columns.length > 0) {
      params.push(`%${search}%`);
      clauses.push(`(${meta.columns.map((c) => `${q(c.name)}::text ILIKE $${params.length}`).join(" OR ")})`);
    }
    return { where: `WHERE ${clauses.join(" AND ")}`, params };
  }

  async insertRow(table: string, values: Row): Promise<Row> {
    const meta = await this.getTable(table);
    values = coerceRowValues(meta, values);
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
    values = coerceRowValues(meta, values);
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

  async buildWrite(op: WriteOp): Promise<SqlStatement[]> {
    switch (op.kind) {
      case "updateRows": {
        const meta = await this.getTable(op.table);
        assertKnownColumn(meta, op.pkColumn);
        const values = coerceRowValues(meta, op.values);
        const cols = Object.keys(values).filter((k) => meta.columns.some((c) => c.name === k));
        if (cols.length === 0 || op.pkValues.length === 0) return [];
        const setClause = cols.map((c, i) => `${q(c)} = $${i + 1}`).join(", ");
        const pkPlaceholders = op.pkValues.map((_, i) => `$${cols.length + i + 1}`).join(", ");
        return [
          {
            sql: `UPDATE ${q(op.table)} SET ${setClause} WHERE ${q(op.pkColumn)} IN (${pkPlaceholders})`,
            params: [...cols.map((c) => values[c]), ...op.pkValues],
          },
        ];
      }
      case "deleteRows": {
        const meta = await this.getTable(op.table);
        assertKnownColumn(meta, op.pkColumn);
        if (op.pkValues.length === 0) return [];
        const placeholders = op.pkValues.map((_, i) => `$${i + 1}`).join(", ");
        return [{ sql: `DELETE FROM ${q(op.table)} WHERE ${q(op.pkColumn)} IN (${placeholders})`, params: op.pkValues }];
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
        const sqlType = CREATABLE_TYPE_SQL[op.type];
        return [{ sql: `ALTER TABLE ${q(op.table)} ALTER COLUMN ${q(op.column)} TYPE ${sqlType} USING ${q(op.column)}::text::${sqlType}`, params: [] }];
      }
      case "dropColumn": {
        assertKnownColumn(await this.getTable(op.table), op.column);
        return [{ sql: `ALTER TABLE ${q(op.table)} DROP COLUMN ${q(op.column)}`, params: [] }];
      }
      case "dropTables":
        op.tables.forEach(assertValidIdentifier);
        return [{ sql: `DROP TABLE ${op.tables.map(q).join(", ")}${op.ignoreForeignKeys ? " CASCADE" : ""}`, params: [] }];
    }
  }

  previewWrite(op: WriteOp): Promise<WritePreview> {
    return previewWithAdapter(this, op, "dollar", async (table, pkColumn, pkValues) => {
      const placeholders = pkValues.map((_, i) => `$${i + 1}`).join(", ");
      const client = await this.pool.connect();
      try {
        const res = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${q(table)} WHERE ${q(pkColumn)} IN (${placeholders})`, pkValues);
        return Number(res.rows[0]?.count ?? 0);
      } finally {
        client.release();
      }
    });
  }

  private async runStatements(statements: SqlStatement[]): Promise<number> {
    const client = await this.pool.connect();
    try {
      let affected = 0;
      for (const st of statements) affected += (await client.query(st.sql, st.params)).rowCount ?? 0;
      return affected;
    } finally {
      client.release();
    }
  }

  async updateRows(table: string, pkColumn: string, pkValues: unknown[], values: Row): Promise<number> {
    return this.runStatements(await this.buildWrite({ kind: "updateRows", table, pkColumn, pkValues, values }));
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
    return this.runStatements(await this.buildWrite({ kind: "deleteRows", table, pkColumn, pkValues }));
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
    await this.runStatements(await this.buildWrite({ kind: "dropTables", tables, ignoreForeignKeys }));
  }

  async bulkInsert(table: string, rows: Row[]): Promise<number> {
    if (rows.length === 0) return 0;
    const meta = await this.getTable(table);
    rows = rows.map((r) => coerceRowValues(meta, r));
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
