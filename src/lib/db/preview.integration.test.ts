import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRUNCATED_KEY, type Engine } from "../types";
import type { DatabaseAdapter } from "./adapter";
import type { AdapterConnection } from "./network";

/*
 * Grid previews against real databases. SQLite always runs; PostgreSQL and MySQL
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

const TABLE = "overlook_preview_test";
const SCHEMA: Record<Engine, string> = {
  sqlite: `CREATE TABLE ${TABLE} (id INTEGER PRIMARY KEY, body TEXT, file BLOB, n INTEGER)`,
  postgres: `CREATE TABLE ${TABLE} (id integer PRIMARY KEY, body text, file bytea, n integer)`,
  mysql: `CREATE TABLE ${TABLE} (id int PRIMARY KEY, body longtext, file longblob, n int)`,
};
const blob = (engine: Engine, bytes: number) =>
  engine === "postgres" ? `decode(repeat('ab', ${bytes}), 'hex')` : engine === "mysql" ? `UNHEX(REPEAT('AB', ${bytes}))` : `zeroblob(${bytes})`;
const repeat = (engine: Engine, text: string, times: number) => (engine === "sqlite" ? `replace(hex(zeroblob(${times})), '00', '${text}')` : `REPEAT('${text}', ${times})`);

for (const target of targets) {
  describe.skipIf(!target.enabled)(`grid previews on ${target.engine}`, () => {
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
      const e = target.engine;
      await adapter.runStatement(`DROP TABLE IF EXISTS ${TABLE}`);
      await adapter.runStatement(SCHEMA[e]);
      // Rows 1 and 2 share their first 3000 characters: only the full value tells them apart.
      const longText = (last: string) => (e === "mysql" ? `CONCAT(REPEAT('x', 3000), '${last}')` : `${repeat(e, "x", 3000)} || '${last}'`);
      await adapter.runStatement(`INSERT INTO ${TABLE} VALUES (1, ${longText("b")}, ${blob(e, 5000)}, 7)`);
      await adapter.runStatement(`INSERT INTO ${TABLE} VALUES (2, ${longText("a")}, NULL, 8)`);
      await adapter.runStatement(`INSERT INTO ${TABLE} VALUES (3, 'short', ${blob(e, 10)}, NULL)`);
    });

    afterAll(async () => {
      if (!adapter) return;
      await adapter.runStatement(`DROP TABLE IF EXISTS ${TABLE}`);
      await adapter.close();
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("cuts long values and says so, leaving short ones alone", async () => {
      const { rows, total } = await adapter.selectRows(TABLE, { preview: true, sorts: [{ column: "id", dir: "asc" }] });
      expect(total).toBe(3);
      const [one, two, three] = rows;
      expect(typeof one.body).toBe("string");
      expect((one.body as string).length).toBe(500);
      expect(one.file).toBeNull();
      expect(one[TRUNCATED_KEY]).toEqual({ body: 3001, file: 5000 });
      expect(two[TRUNCATED_KEY]).toEqual({ body: 3001 });
      expect(two.file).toBeNull();
      expect(three.body).toBe("short");
      expect(three[TRUNCATED_KEY]).toBeUndefined();
      expect(Buffer.from(three.file as Uint8Array).length).toBe(10);
      expect(Number(one.n)).toBe(7);
      expect(three.n).toBeNull();
      expect(Object.keys(one).filter((k) => k.startsWith("__overlook_") && k !== TRUNCATED_KEY)).toEqual([]);
    });

    it("sorts a cut column by its full value", async () => {
      const { rows } = await adapter.selectRows(TABLE, { preview: true, sorts: [{ column: "body", dir: "asc" }] });
      // "short" first; then 2 before 1, which differ only after the preview's end.
      expect(rows.map((r) => Number(r.id))).toEqual([3, 2, 1]);
    });

    it("still gives whole values without preview", async () => {
      const { rows } = await adapter.selectRows(TABLE, { sorts: [{ column: "id", dir: "asc" }] });
      expect((rows[0].body as string).length).toBe(3001);
      expect(rows[0][TRUNCATED_KEY]).toBeUndefined();
    });
  });
}
