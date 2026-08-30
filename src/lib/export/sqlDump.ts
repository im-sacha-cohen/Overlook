import type { Engine, Row, TableMeta } from "../types";

export function quoteIdent(engine: Engine, ident: string): string {
  return engine === "mysql" ? `\`${ident}\`` : `"${ident}"`;
}

function escapeString(value: string): string {
  return value.replace(/'/g, "''");
}

export function formatSqlValue(engine: Engine, value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") {
    if (engine === "postgres") return value ? "TRUE" : "FALSE";
    return value ? "1" : "0";
  }
  if (value instanceof Date) return `'${escapeString(value.toISOString().replace("T", " ").replace("Z", ""))}'`;
  if (Buffer.isBuffer(value)) return `X'${value.toString("hex")}'`;
  if (typeof value === "object") return `'${escapeString(JSON.stringify(value))}'`;
  return `'${escapeString(String(value))}'`;
}

export function sqlDumpHeader(engine: Engine): string {
  return [
    `-- Overlook export (${engine}) -- ${new Date().toISOString()}`,
    `-- Structure approximative (types de colonnes + clés étrangères) : les autres`,
    `-- contraintes et index ne sont pas reconstruits par cet export.`,
    "",
    "",
  ].join("\n");
}

export function sqlCreateTable(engine: Engine, table: TableMeta): string {
  const colDefs = table.columns.map((c) => {
    const pk = c.isPrimaryKey ? " PRIMARY KEY" : "";
    return `  ${quoteIdent(engine, c.name)} ${c.nativeType}${pk}`;
  });
  // SQLite can't ADD a foreign key after the fact (ALTER TABLE is very
  // limited) — its FK constraints have to be declared inline at creation.
  // MySQL/Postgres get theirs from sqlForeignKeys() instead, once every
  // table exists and its data is loaded, so insertion order never matters.
  const fkDefs =
    engine === "sqlite"
      ? table.columns
          .filter((c) => c.references)
          .map(
            (c) =>
              `  FOREIGN KEY (${quoteIdent(engine, c.name)}) REFERENCES ${quoteIdent(engine, c.references!.table)} (${quoteIdent(engine, c.references!.column)})`
          )
      : [];
  return [
    `-- Table: ${table.name}`,
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(engine, table.name)} (`,
    [...colDefs, ...fkDefs].join(",\n"),
    ");",
    "",
    "",
  ].join("\n");
}

export function sqlForeignKeys(engine: Engine, table: TableMeta): string {
  if (engine === "sqlite") return "";
  const lines = table.columns
    .filter((c) => c.references)
    .map((c) => {
      const ref = c.references!;
      const constraintName = `fk_${table.name}_${c.name}`;
      return `ALTER TABLE ${quoteIdent(engine, table.name)} ADD CONSTRAINT ${quoteIdent(engine, constraintName)} FOREIGN KEY (${quoteIdent(engine, c.name)}) REFERENCES ${quoteIdent(engine, ref.table)} (${quoteIdent(engine, ref.column)});`;
    });
  return lines.length ? lines.join("\n") + "\n" : "";
}

export function sqlInsertBatch(engine: Engine, table: TableMeta, rows: Row[]): string {
  if (rows.length === 0) return "";
  const colNames = table.columns.map((c) => c.name);
  const quotedCols = colNames.map((c) => quoteIdent(engine, c)).join(", ");
  const lines = rows.map((row) => {
    const values = colNames.map((c) => formatSqlValue(engine, row[c]));
    return `INSERT INTO ${quoteIdent(engine, table.name)} (${quotedCols}) VALUES (${values.join(", ")});`;
  });
  return lines.join("\n") + "\n";
}

export function sqlProgressComment(tableName: string, rows: number): string {
  return `-- @@progress table="${tableName}" rows=${rows}\n\n`;
}
