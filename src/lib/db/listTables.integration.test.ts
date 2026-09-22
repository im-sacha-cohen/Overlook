import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../types";
import type { DatabaseAdapter } from "./adapter";
import type { AdapterConnection } from "./network";

/*
 * The table list's counts against real servers: exact for small tables, the
 * database's estimate for big ones. Runs when OVERLOOK_TEST_POSTGRES /
 * OVERLOOK_TEST_MYSQL hold a URL (npm run test:db); SQLite always counts exactly.
 */

function connection(engine: Engine, url: string): AdapterConnection {
  const u = new URL(url);
  return { id: `test-${engine}`, name: engine, envType: "local", engine, createdAt: new Date().toISOString(), host: u.hostname, port: Number(u.port), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1), sslMode: "disable" };
}

const targets: { engine: Engine; url?: string }[] = [
  { engine: "postgres", url: process.env.OVERLOOK_TEST_POSTGRES },
  { engine: "mysql", url: process.env.OVERLOOK_TEST_MYSQL },
];

const BIG = 120_000;

for (const target of targets) {
  describe.skipIf(!target.url)(`table list on ${target.engine}`, () => {
    let adapter: DatabaseAdapter;

    beforeAll(async () => {
      if (target.engine === "postgres") {
        const { PostgresAdapter } = await import("./postgres");
        adapter = new PostgresAdapter(connection("postgres", target.url!));
      } else {
        const { MySqlAdapter } = await import("./mysql");
        adapter = new MySqlAdapter(connection("mysql", target.url!));
      }
      for (const t of ["overlook_list_big", "overlook_list_small"]) await adapter.runStatement(`DROP TABLE IF EXISTS ${t}`);
      await adapter.runStatement("CREATE TABLE overlook_list_small (id integer PRIMARY KEY, label varchar(20))");
      await adapter.runStatement("INSERT INTO overlook_list_small VALUES (1, 'a'), (2, 'b'), (3, 'c')");
      // MySQL ignores REFERENCES written on the column: the table-level form works on both.
      await adapter.runStatement("CREATE TABLE overlook_list_big (id integer PRIMARY KEY, small_id integer, FOREIGN KEY (small_id) REFERENCES overlook_list_small(id))");
      if (target.engine === "postgres") {
        await adapter.runStatement(`INSERT INTO overlook_list_big SELECT i, 1 FROM generate_series(1, ${BIG}) AS i`);
        await adapter.runStatement("ANALYZE overlook_list_big");
      } else {
        // MySQL stops a recursive query after 1000 steps: 400 × 400 rows instead.
        await adapter.runStatement(`INSERT INTO overlook_list_big WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 399) SELECT a.i * 400 + b.i + 1, 1 FROM n a, n b WHERE a.i * 400 + b.i < ${BIG}`);
        await adapter.runStatement("ANALYZE TABLE overlook_list_big");
      }
    }, 120_000);

    afterAll(async () => {
      if (!adapter) return;
      for (const t of ["overlook_list_big", "overlook_list_small"]) await adapter.runStatement(`DROP TABLE IF EXISTS ${t}`);
      await adapter.close();
    });

    it("counts small tables exactly and estimates big ones", async () => {
      const tables = await adapter.listTables();
      const small = tables.find((t) => t.name === "overlook_list_small")!;
      const big = tables.find((t) => t.name === "overlook_list_big")!;
      expect(small.rowCount).toBe(3);
      expect(small.rowCountEstimated).toBeFalsy();
      expect(big.rowCountEstimated).toBe(true);
      expect(big.rowCount).toBeGreaterThan(BIG / 2);
      expect(big.rowCount).toBeLessThan(BIG * 2);
    });

    it("describes every table as getTable does", async () => {
      const tables = await adapter.listTables();
      for (const name of ["overlook_list_small", "overlook_list_big"]) {
        const listed = tables.find((t) => t.name === name)!;
        expect(listed.columns).toEqual((await adapter.getTable(name)).columns);
      }
      const fk = tables.find((t) => t.name === "overlook_list_big")!.columns.find((c) => c.name === "small_id")!;
      expect(fk.references).toEqual({ table: "overlook_list_small", column: "id" });
    });
  });
}
