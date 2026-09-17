import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine, FilterGroup, FilterMatch, RowFilter } from "../types";
import type { DatabaseAdapter } from "./adapter";
import type { AdapterConnection } from "./network";

/*
 * Filters run against real databases. SQLite always runs; PostgreSQL and MySQL run
 * when OVERLOOK_TEST_POSTGRES / OVERLOOK_TEST_MYSQL hold a URL (npm run test:db
 * starts the docker-compose databases and sets them).
 */

const TABLE = "overlook_filter_test";

const ROWS = [
  { id: 1, status: "paid", roles: '["ROLE_USER"]', amount: 10, created_at: "2026-09-14 10:58:38" },
  { id: 2, status: "pending", roles: '["ROLE_ADMIN", "ROLE_USER"]', amount: 250, created_at: "2026-09-16 10:27:17" },
  { id: 3, status: "paid", roles: '["ROLE_ADMIN"]', amount: 99.5, created_at: "2026-09-16 10:27:45" },
  { id: 4, status: null, roles: "[]", amount: null, created_at: "2026-09-16 23:59:59" },
  { id: 5, status: "", roles: '["ROLE_USER"]', amount: 0, created_at: "2026-09-17 00:00:00" },
];

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

for (const target of targets) {
  describe.skipIf(!target.enabled)(`filters on ${target.engine}`, () => {
    let adapter: DatabaseAdapter;
    let tmpDir = "";

    beforeAll(async () => {
      if (target.engine === "sqlite") {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "overlook-test-"));
        process.env.OVERLOOK_SQLITE_DIRS = tmpDir;
        const file = path.join(tmpDir, "test.sqlite");
        const db = new Database(file);
        db.exec(`CREATE TABLE ${TABLE} (id INTEGER PRIMARY KEY, status TEXT, roles JSON, amount REAL, created_at TEXT)`);
        const insert = db.prepare(`INSERT INTO ${TABLE} VALUES (@id, @status, @roles, @amount, @created_at)`);
        for (const r of ROWS) insert.run(r);
        db.close();
        const { SqliteAdapter } = await import("./sqlite");
        adapter = new SqliteAdapter({ ...connection("sqlite"), database: file });
        return;
      }
      if (target.engine === "postgres") {
        const { PostgresAdapter } = await import("./postgres");
        adapter = new PostgresAdapter(connection("postgres", target.url));
        await adapter.runStatement(`DROP TABLE IF EXISTS ${TABLE}`);
        await adapter.runStatement(`CREATE TABLE ${TABLE} (id integer PRIMARY KEY, status text, roles jsonb, amount numeric, created_at timestamp)`);
      } else {
        const { MySqlAdapter } = await import("./mysql");
        adapter = new MySqlAdapter(connection("mysql", target.url));
        await adapter.runStatement(`DROP TABLE IF EXISTS ${TABLE}`);
        await adapter.runStatement(`CREATE TABLE ${TABLE} (id int PRIMARY KEY, status varchar(32), roles json, amount decimal(10,2), created_at datetime)`);
      }
      for (const r of ROWS) await adapter.insertRow(TABLE, r);
    });

    afterAll(async () => {
      if (!adapter) return;
      if (target.engine !== "sqlite") await adapter.runStatement(`DROP TABLE IF EXISTS ${TABLE}`);
      await adapter.close();
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const ids = async (filters: RowFilter[], filterMatch: FilterMatch = "all", filterGroups?: FilterGroup[], search?: string) => {
      const { rows, total } = await adapter.selectRows(TABLE, { filters, filterMatch, filterGroups, search, sorts: [{ column: "id", dir: "asc" }] });
      expect(total).toBe(rows.length);
      return rows.map((r) => Number(r.id));
    };

    it("is / is not / contains / does not contain", async () => {
      expect(await ids([{ column: "status", op: "eq", value: "paid" }])).toEqual([1, 3]);
      expect(await ids([{ column: "status", op: "neq", value: "paid" }])).toEqual([2, 5]);
      expect(await ids([{ column: "status", op: "contains", value: "PEND" }])).toEqual([2]);
      expect(await ids([{ column: "status", op: "notContains", value: "pai" }])).toEqual([2, 4, 5]);
    });

    it("ignores a filter without a value", async () => {
      expect(await ids([{ column: "status", op: "eq", value: "" }])).toEqual([1, 2, 3, 4, 5]);
    });

    it("empty / not empty", async () => {
      expect(await ids([{ column: "status", op: "empty", value: "" }])).toEqual([4, 5]);
      expect(await ids([{ column: "amount", op: "notEmpty", value: "" }])).toEqual([1, 2, 3, 5]);
    });

    it("compares numbers as numbers", async () => {
      expect(await ids([{ column: "amount", op: "gt", value: "99" }])).toEqual([2, 3]);
      expect(await ids([{ column: "amount", op: "lt", value: "10" }])).toEqual([5]);
      expect(await ids([{ column: "amount", op: "between", value: "10", value2: "99.5" }])).toEqual([1, 3]);
    });

    it("is one of, on values and inside JSON lists", async () => {
      expect(await ids([{ column: "id", op: "in", value: "", values: ["2", "4"] }])).toEqual([2, 4]);
      expect(await ids([{ column: "status", op: "notIn", value: "", values: ["paid", "pending"] }])).toEqual([4, 5]);
      expect(await ids([{ column: "roles", op: "in", value: "", values: ["ROLE_ADMIN"] }])).toEqual([2, 3]);
    });

    it("matches any filter in OR mode", async () => {
      const filters: RowFilter[] = [
        { column: "status", op: "eq", value: "pending" },
        { column: "amount", op: "lt", value: "10" },
      ];
      expect(await ids(filters)).toEqual([]);
      expect(await ids(filters, "any")).toEqual([2, 5]);
    });

    it("takes % and _ literally", async () => {
      expect(await ids([{ column: "status", op: "contains", value: "_" }])).toEqual([]);
      expect(await ids([], "all", undefined, "%")).toEqual([]);
      expect(await ids([{ column: "status", op: "notContains", value: "_" }])).toEqual([1, 2, 3, 4, 5]);
    });

    it("skips disabled filters", async () => {
      expect(await ids([{ column: "status", op: "eq", value: "paid", disabled: true }])).toEqual([1, 2, 3, 4, 5]);
    });

    it("groups conditions", async () => {
      const filters: RowFilter[] = [
        { column: "status", op: "eq", value: "paid", group: "g" },
        { column: "amount", op: "gt", value: "50" },
        { column: "status", op: "eq", value: "pending", group: "g" },
      ];
      expect(await ids(filters, "all", [{ id: "g", match: "any" }])).toEqual([2, 3]);
      expect(await ids(filters, "any", [{ id: "g", match: "all" }])).toEqual([2, 3]);
      expect(await ids([...filters, { column: "id", op: "eq", value: "1" }], "any", [{ id: "g", match: "any" }])).toEqual([1, 2, 3]);
    });

    it("summarises columns over the filtered rows", async () => {
      expect(
        await adapter.aggregate(TABLE, {}, [
          { column: "amount", fn: "sum" },
          { column: "amount", fn: "avg" },
          { column: "amount", fn: "min" },
          { column: "amount", fn: "max" },
          { column: "status", fn: "filled" },
          { column: "status", fn: "empty" },
          { column: "status", fn: "unique" },
        ]),
      ).toEqual({ "amount:sum": 359.5, "amount:avg": 89.875, "amount:min": 0, "amount:max": 250, "status:filled": 3, "status:empty": 2, "status:unique": 2 });
      expect(await adapter.aggregate(TABLE, { filters: [{ column: "status", op: "eq", value: "paid" }] }, [{ column: "amount", fn: "sum" }])).toEqual({ "amount:sum": 109.5 });
    });

    it("suggests frequent values and the elements of JSON lists", async () => {
      expect(await adapter.distinctValues(TABLE, "status")).toEqual([
        { value: "paid", count: 2 },
        { value: "pending", count: 1, id: "2" },
      ]);
      expect(await adapter.distinctValues(TABLE, "status", "", { within: { filters: [{ column: "amount", op: "gt", value: "50" }] } })).toEqual([
        { value: "paid", count: 1, id: "3" },
        { value: "pending", count: 1, id: "2" },
      ]);
      expect(await adapter.distinctValues(TABLE, "roles", "ADMIN")).toEqual([{ value: "ROLE_ADMIN", count: 2 }]);
    });

    describe.skipIf(target.engine === "sqlite")("dates", () => {
      it("a day or a minute is a span", async () => {
        expect(await ids([{ column: "created_at", op: "eq", value: "2026-09-16" }])).toEqual([2, 3, 4]);
        expect(await ids([{ column: "created_at", op: "eq", value: "2026-09-16 10:27:00" }])).toEqual([2, 3]);
        expect(await ids([{ column: "created_at", op: "neq", value: "2026-09-16" }])).toEqual([1, 5]);
      });

      it("after / before / between include whole days", async () => {
        expect(await ids([{ column: "created_at", op: "gt", value: "2026-09-16" }])).toEqual([5]);
        expect(await ids([{ column: "created_at", op: "gt", value: "2026-09-16 10:27:00" }])).toEqual([4, 5]);
        expect(await ids([{ column: "created_at", op: "lt", value: "2026-09-16" }])).toEqual([1]);
        expect(await ids([{ column: "created_at", op: "between", value: "2026-09-14", value2: "2026-09-16" }])).toEqual([1, 2, 3, 4]);
      });
    });
  });
}

for (const target of targets) {
  describe.skipIf(!target.enabled)(`filters through foreign keys on ${target.engine}`, () => {
    let adapter: DatabaseAdapter;
    let tmpDir = "";
    const statements = [
      "CREATE TABLE overlook_fk_dossier (id INTEGER PRIMARY KEY, public_id VARCHAR(32))",
      // Table-level FOREIGN KEY: MySQL ignores REFERENCES written on the column itself.
      "CREATE TABLE overlook_fk_document (id INTEGER PRIMARY KEY, libelle VARCHAR(64), dossier_id INTEGER, FOREIGN KEY (dossier_id) REFERENCES overlook_fk_dossier(id))",
      "INSERT INTO overlook_fk_dossier VALUES (1, 'DOS-A'), (2, 'DOS-B')",
      "INSERT INTO overlook_fk_document VALUES (10, 'kbis', 1), (11, 'statuts', 1), (12, 'kbis', 2), (13, 'orphelin', NULL)",
    ];

    beforeAll(async () => {
      if (target.engine === "sqlite") {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "overlook-fk-"));
        process.env.OVERLOOK_SQLITE_DIRS = tmpDir;
        const file = path.join(tmpDir, "fk.sqlite");
        const db = new Database(file);
        for (const sql of statements) db.exec(sql);
        db.close();
        const { SqliteAdapter } = await import("./sqlite");
        adapter = new SqliteAdapter({ ...connection("sqlite"), database: file });
        return;
      }
      if (target.engine === "postgres") {
        const { PostgresAdapter } = await import("./postgres");
        adapter = new PostgresAdapter(connection("postgres", target.url));
      } else {
        const { MySqlAdapter } = await import("./mysql");
        adapter = new MySqlAdapter(connection("mysql", target.url));
      }
      await adapter.runStatement("DROP TABLE IF EXISTS overlook_fk_document");
      await adapter.runStatement("DROP TABLE IF EXISTS overlook_fk_dossier");
      for (const sql of statements) await adapter.runStatement(sql);
    });

    afterAll(async () => {
      if (!adapter) return;
      if (target.engine !== "sqlite") {
        await adapter.runStatement("DROP TABLE IF EXISTS overlook_fk_document");
        await adapter.runStatement("DROP TABLE IF EXISTS overlook_fk_dossier");
      }
      await adapter.close();
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const ids = async (filters: RowFilter[]) => {
      const { rows, total } = await adapter.selectRows("overlook_fk_document", { filters, sorts: [{ column: "id", dir: "asc" }] });
      expect(total).toBe(rows.length);
      return rows.map((r) => Number(r.id));
    };

    it("finds documents by their dossier's public id", async () => {
      expect(await ids([{ column: "public_id", via: ["dossier_id"], op: "eq", value: "DOS-A" }])).toEqual([10, 11]);
      expect(await ids([{ column: "public_id", via: ["dossier_id"], op: "contains", value: "b" }, { column: "libelle", op: "eq", value: "kbis" }])).toEqual([12]);
      expect(await ids([{ column: "public_id", via: ["dossier_id"], op: "in", value: "", values: ["DOS-A", "DOS-B"] }])).toEqual([10, 11, 12]);
    });

    it("suggests a related column's values with the documents they would keep", async () => {
      expect(await adapter.distinctValues("overlook_fk_document", "public_id", "", { via: ["dossier_id"] })).toEqual([
        { value: "DOS-A", count: 2, id: "1" },
        { value: "DOS-B", count: 1, id: "2" },
      ]);
      expect(await adapter.distinctValues("overlook_fk_document", "public_id", "dos", { via: ["dossier_id"], within: { filters: [{ column: "libelle", op: "eq", value: "kbis" }] } })).toEqual([
        { value: "DOS-A", count: 1, id: "1" },
        { value: "DOS-B", count: 1, id: "2" },
      ]);
    });

    it("summarises over the related filter too", async () => {
      expect(await adapter.aggregate("overlook_fk_document", { filters: [{ column: "public_id", via: ["dossier_id"], op: "eq", value: "DOS-A" }] }, [{ column: "libelle", fn: "unique" }])).toEqual({ "libelle:unique": 2 });
    });
  });
}
