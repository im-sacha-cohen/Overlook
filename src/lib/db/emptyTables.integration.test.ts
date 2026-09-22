import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Engine } from "../types";
import type { DatabaseAdapter } from "./adapter";
import type { AdapterConnection } from "./network";

/*
 * Emptying tables against real databases. SQLite always runs; PostgreSQL and MySQL
 * run when OVERLOOK_TEST_POSTGRES / OVERLOOK_TEST_MYSQL hold a URL (npm run test:db).
 */

function connection(engine: Engine, url?: string): AdapterConnection {
  const base = { id: `test-${engine}`, name: engine, envType: "local" as const, engine, createdAt: new Date().toISOString() };
  if (!url) return { ...base, database: "" };
  const u = new URL(url);
  return { ...base, host: u.hostname, port: Number(u.port), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1), sslMode: "disable" };
}

const targets: { engine: Engine; url?: string; enabled: boolean }[] = [
  { engine: "sqlite", enabled: true },
  { engine: "postgres", url: process.env.OVERLOOK_TEST_POSTGRES, enabled: !!process.env.OVERLOOK_TEST_POSTGRES },
  { engine: "mysql", url: process.env.OVERLOOK_TEST_MYSQL, enabled: !!process.env.OVERLOOK_TEST_MYSQL },
];

const SCHEMA: Record<Engine, string[]> = {
  sqlite: [
    "CREATE TABLE overlook_empty_parent (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)",
    "CREATE TABLE overlook_empty_child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES overlook_empty_parent(id))",
  ],
  postgres: [
    "CREATE TABLE overlook_empty_parent (id serial PRIMARY KEY, name text)",
    "CREATE TABLE overlook_empty_child (id integer PRIMARY KEY, parent_id integer REFERENCES overlook_empty_parent(id))",
  ],
  mysql: [
    "CREATE TABLE overlook_empty_parent (id int AUTO_INCREMENT PRIMARY KEY, name varchar(20)) ENGINE=InnoDB",
    "CREATE TABLE overlook_empty_child (id int PRIMARY KEY, parent_id int, FOREIGN KEY (parent_id) REFERENCES overlook_empty_parent(id)) ENGINE=InnoDB",
  ],
};

for (const target of targets) {
  describe.skipIf(!target.enabled)(`emptying tables on ${target.engine}`, () => {
    let adapter: DatabaseAdapter;
    let tmpDir = "";

    beforeAll(async () => {
      if (target.engine === "sqlite") {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "overlook-test-"));
        process.env.OVERLOOK_SQLITE_DIRS = tmpDir;
        const file = path.join(tmpDir, "test.sqlite");
        new Database(file).close();
        const { SqliteAdapter } = await import("./sqlite");
        adapter = new SqliteAdapter({ ...connection("sqlite"), database: file });
      } else if (target.engine === "postgres") {
        const { PostgresAdapter } = await import("./postgres");
        adapter = new PostgresAdapter(connection("postgres", target.url));
      } else {
        const { MySqlAdapter } = await import("./mysql");
        adapter = new MySqlAdapter(connection("mysql", target.url));
      }
    });

    beforeEach(async () => {
      await adapter.runStatement("DROP TABLE IF EXISTS overlook_empty_child");
      await adapter.runStatement("DROP TABLE IF EXISTS overlook_empty_parent");
      for (const sql of SCHEMA[target.engine]) await adapter.runStatement(sql);
      await adapter.runStatement("INSERT INTO overlook_empty_parent (name) VALUES ('a'), ('b')");
      await adapter.runStatement("INSERT INTO overlook_empty_child VALUES (1, 1)");
    });

    afterAll(async () => {
      if (!adapter) return;
      await adapter.runStatement("DROP TABLE IF EXISTS overlook_empty_child");
      await adapter.runStatement("DROP TABLE IF EXISTS overlook_empty_parent");
      await adapter.close();
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const count = async (table: string) => Number((await adapter.runRawQuery(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);

    it("empties the tables, keeps them, and restarts their counters", async () => {
      await adapter.emptyTables(["overlook_empty_child", "overlook_empty_parent"]);
      expect(await count("overlook_empty_parent")).toBe(0);
      expect(await count("overlook_empty_child")).toBe(0);
      await adapter.runStatement("INSERT INTO overlook_empty_parent (name) VALUES ('fresh')");
      expect(Number((await adapter.runRawQuery("SELECT id FROM overlook_empty_parent")).rows[0].id)).toBe(1);
    });

    it("refuses a table other rows point to, unless foreign keys are ignored", async () => {
      await expect(adapter.emptyTables(["overlook_empty_parent"])).rejects.toThrow();
      expect(await count("overlook_empty_parent")).toBe(2);
      await adapter.emptyTables(["overlook_empty_parent"], { ignoreForeignKeys: true });
      expect(await count("overlook_empty_parent")).toBe(0);
      // PostgreSQL's CASCADE empties the referencing table too; the others leave its rows orphaned.
      expect(await count("overlook_empty_child")).toBe(target.engine === "postgres" ? 0 : 1);
    });

    it("empties a table pointed to from outside when no row there points in", async () => {
      await adapter.runStatement("DELETE FROM overlook_empty_child");
      await adapter.emptyTables(["overlook_empty_parent"]);
      expect(await count("overlook_empty_parent")).toBe(0);
      await adapter.runStatement("INSERT INTO overlook_empty_parent (name) VALUES ('fresh')");
      expect(Number((await adapter.runRawQuery("SELECT id FROM overlook_empty_parent")).rows[0].id)).toBe(1);
    });

    it("previews what it will run and how many rows go", async () => {
      const preview = await adapter.previewWrite({ kind: "emptyTables", tables: ["overlook_empty_child", "overlook_empty_parent"] });
      expect(preview.rows).toBe(3);
      expect(preview.sql).toMatch(target.engine === "sqlite" ? /DELETE FROM/ : /TRUNCATE/);
    });
  });
}
