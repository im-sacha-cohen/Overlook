import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../types";
import type { DatabaseAdapter } from "./adapter";
import type { AdapterConnection } from "./network";

/*
 * SQL scripts run on one connection kept for the whole script. SQLite always runs;
 * PostgreSQL and MySQL run when OVERLOOK_TEST_POSTGRES / OVERLOOK_TEST_MYSQL hold
 * a URL (npm run test:db starts the docker-compose databases and sets them).
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

const TABLE = "overlook_script_test";

for (const target of targets) {
  describe.skipIf(!target.enabled)(`script session on ${target.engine}`, () => {
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
      await adapter.runStatement(`DROP TABLE IF EXISTS ${TABLE}`);
      await adapter.runStatement(`CREATE TABLE ${TABLE} (id integer PRIMARY KEY, label varchar(50))`);
    });

    afterAll(async () => {
      if (!adapter) return;
      await adapter.runStatement(`DROP TABLE IF EXISTS ${TABLE}`);
      await adapter.close();
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const count = async () => Number((await adapter.runRawQuery(`SELECT COUNT(*) AS n FROM ${TABLE}`)).rows[0].n);

    it("keeps what one statement sets up for the next ones", async () => {
      if (target.engine === "sqlite") return;
      // A temporary table only exists on the connection that created it.
      const session = await adapter.openScriptSession();
      await session.run(`CREATE TEMPORARY TABLE overlook_script_tmp (id integer)`);
      await session.run(`INSERT INTO overlook_script_tmp VALUES (1)`);
      for (let i = 2; i < 20; i++) await session.run(`INSERT INTO overlook_script_tmp VALUES (${i})`);
      await session.close();
    });

    it("runs the script's own transactions and keeps failing statements apart", async () => {
      const session = await adapter.openScriptSession();
      await session.run(`INSERT INTO ${TABLE} VALUES (1, 'a')`);
      await expect(session.run(`INSERT INTO ${TABLE} VALUES (1, 'duplicate')`)).rejects.toThrow();
      await session.run(`BEGIN`);
      await session.run(`INSERT INTO ${TABLE} VALUES (2, 'b')`);
      await session.run(`COMMIT`);
      // Enough rows to go past SQLite's batch of 2000.
      for (let i = 3; i < 2500; i++) await session.run(`INSERT INTO ${TABLE} VALUES (${i}, 'row ${i}')`);
      await session.close();
      expect(await count()).toBe(2499);
    }, 30_000);

    it("does not let the script's settings outlive it", async () => {
      const session = await adapter.openScriptSession();
      if (target.engine === "mysql") await session.run("SET FOREIGN_KEY_CHECKS = 0");
      if (target.engine === "sqlite") await session.run("PRAGMA foreign_keys = OFF");
      if (target.engine === "postgres") await session.run("SET statement_timeout = 1");
      await session.close();
      // The pool is small: every connection gets checked.
      for (let i = 0; i < 6; i++) {
        const { rows } = await adapter.runRawQuery(
          target.engine === "mysql" ? "SELECT @@FOREIGN_KEY_CHECKS AS v" : target.engine === "sqlite" ? "PRAGMA foreign_keys" : "SHOW statement_timeout",
        );
        expect(String(Object.values(rows[0])[0])).toBe(target.engine === "postgres" ? "0" : "1");
      }
    });

    it("stops at the first statement once the connection is gone", async () => {
      if (target.engine === "sqlite") return;
      const session = await adapter.openScriptSession();
      const { ScriptSessionLost } = await import("./adapter");
      // The session's connection kills itself, as a server restart would.
      await expect(session.run(target.engine === "postgres" ? "SELECT pg_terminate_backend(pg_backend_pid())" : "KILL CONNECTION_ID()")).rejects.toThrow();
      await expect(session.run("SELECT 1")).rejects.toBeInstanceOf(ScriptSessionLost);
      await session.close();
      expect(await count()).toBeGreaterThan(0);
    });

    it("keeps a batch when a statement in it fails, whatever the error", async () => {
      await adapter.runStatement(`DELETE FROM ${TABLE} WHERE id >= 10000`);
      const before = await count();
      const session = await adapter.openScriptSession();
      await session.run(`INSERT INTO ${TABLE} VALUES (10001, 'a')`);
      await expect(session.run(`INSERT INTO ${TABLE} VALUES (10001, 'duplicate')`)).rejects.toThrow();
      await expect(session.run(`INSERT INTO nowhere VALUES (1)`)).rejects.toThrow();
      await expect(session.run(`INSERT INTO ${TABLE} VALUES (`)).rejects.toThrow();
      await session.run(`INSERT INTO ${TABLE} VALUES (10002, 'b') -- trailing comment`);
      await session.close();
      expect(await count()).toBe(before + 2);
    });

    it("runs a dump's LOCK TABLES and its own commits", async () => {
      await adapter.runStatement(`DELETE FROM ${TABLE} WHERE id >= 10000`);
      const before = await count();
      const session = await adapter.openScriptSession();
      if (target.engine === "mysql") {
        await session.run(`LOCK TABLES ${TABLE} WRITE`);
        await session.run(`INSERT INTO ${TABLE} VALUES (10003, 'locked')`);
        await session.run("UNLOCK TABLES");
        await session.run("SET autocommit = 0");
        await session.run(`INSERT INTO ${TABLE} VALUES (10004, 'no autocommit')`);
        await session.run("COMMIT");
        await session.run("SET autocommit = 1");
      }
      await session.run(target.engine === "sqlite" ? "BEGIN" : "START TRANSACTION");
      await session.run(`INSERT INTO ${TABLE} VALUES (10005, 'own transaction')`);
      await session.run("COMMIT");
      await session.run(`INSERT INTO ${TABLE} VALUES (10006, 'batched again')`);
      await session.close();
      expect(await count()).toBe(before + (target.engine === "mysql" ? 4 : 2));
    });

    it("runs what can't go in a transaction on its own", async () => {
      if (target.engine !== "postgres") return;
      const session = await adapter.openScriptSession();
      await session.run(`INSERT INTO ${TABLE} VALUES (10007, 'before vacuum')`);
      await session.run(`VACUUM ${TABLE}`);
      await session.close();
      expect(Number((await adapter.runRawQuery(`SELECT COUNT(*) AS n FROM ${TABLE} WHERE id = 10007`)).rows[0].n)).toBe(1);
    });

    it("goes fast on single-row INSERTs", async () => {
      await adapter.runStatement(`DELETE FROM ${TABLE} WHERE id >= 20000`);
      const session = await adapter.openScriptSession();
      const started = Date.now();
      for (let i = 20000; i < 30000; i++) await session.run(`INSERT INTO ${TABLE} VALUES (${i}, 'row ${i}')`);
      await session.close();
      const ms = Date.now() - started;
      console.log(`${target.engine}: 10000 single-row INSERTs in ${ms} ms`);
      expect(await count()).toBeGreaterThanOrEqual(10000);
    }, 60_000);

    it("sends row changes together and still says which one failed", async () => {
      await adapter.runStatement(`DELETE FROM ${TABLE} WHERE id >= 30000`);
      const before = await count();
      const session = await adapter.openScriptSession();
      const statements = [
        `INSERT INTO ${TABLE} VALUES (30001, 'a')`,
        `INSERT INTO ${TABLE} VALUES (30002, 'b')`,
        `INSERT INTO ${TABLE} VALUES (30001, 'duplicate')`,
        `UPDATE ${TABLE} SET label = 'changed' WHERE id = 30002`,
        `CREATE TABLE IF NOT EXISTS overlook_script_side (id integer)`,
        `INSERT INTO nowhere VALUES (1)`,
        `DELETE FROM ${TABLE} WHERE id = 30002 -- trailing comment`,
        `INSERT INTO ${TABLE} VALUES (30003, 'it''s')`,
      ];
      const errors = await session.runMany(statements);
      await session.close();
      await adapter.runStatement("DROP TABLE IF EXISTS overlook_script_side");
      expect(errors.map((e) => (e ? "error" : "ok"))).toEqual(["ok", "ok", "error", "ok", "ok", "error", "ok", "ok"]);
      expect(await count()).toBe(before + 2);
    });

    it("goes fast on single-row INSERTs sent together", async () => {
      await adapter.runStatement(`DELETE FROM ${TABLE} WHERE id >= 40000`);
      const session = await adapter.openScriptSession();
      const started = Date.now();
      const statements = Array.from({ length: 10000 }, (_, i) => `INSERT INTO ${TABLE} VALUES (${40000 + i}, 'row ${i}')`);
      for (let i = 0; i < statements.length; i += 200) await session.runMany(statements.slice(i, i + 200));
      await session.close();
      console.log(`${target.engine}: 10000 single-row INSERTs, grouped, in ${Date.now() - started} ms`);
      expect(Number((await adapter.runRawQuery(`SELECT COUNT(*) AS n FROM ${TABLE} WHERE id >= 40000`)).rows[0].n)).toBe(10000);
    }, 60_000);

    it("rolls back a transaction the script leaves open", async () => {
      const before = await count();
      const session = await adapter.openScriptSession();
      await session.run("BEGIN");
      await session.run(`INSERT INTO ${TABLE} VALUES (99999, 'never committed')`);
      await session.close();
      expect(await count()).toBe(before);
    });
  });
}
