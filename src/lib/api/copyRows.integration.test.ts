import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Engine } from "../types";
import type { DatabaseAdapter } from "../db/adapter";
import type { AdapterConnection } from "../db/network";
import { analyzeCopy, copyRows, type CopyEvent, type CopyPlan } from "./copyRows";

/*
 * Copies from a SQLite source into each target engine. SQLite always runs;
 * PostgreSQL and MySQL run when OVERLOOK_TEST_POSTGRES / OVERLOOK_TEST_MYSQL hold
 * a URL (npm run test:db starts the docker-compose databases and sets them).
 */

function connection(engine: Engine, url?: string): AdapterConnection {
  const base = { id: `copy-${engine}`, name: engine, envType: "local" as const, engine, createdAt: new Date().toISOString() };
  if (!url) return { ...base, database: "" };
  const u = new URL(url);
  return { ...base, host: u.hostname, port: Number(u.port), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1), sslMode: "disable" };
}

const targets: { engine: Engine; url?: string; enabled: boolean }[] = [
  { engine: "sqlite", enabled: true },
  { engine: "postgres", url: process.env.OVERLOOK_TEST_POSTGRES, enabled: !!process.env.OVERLOOK_TEST_POSTGRES },
  { engine: "mysql", url: process.env.OVERLOOK_TEST_MYSQL, enabled: !!process.env.OVERLOOK_TEST_MYSQL },
];

const COUNTRIES = "overlook_copy_countries";
const AUTHORS = "overlook_copy_authors";
const BOOKS = "overlook_copy_books";
// Points to authors in the source only: the target has no constraint on it.
const REVIEWS = "overlook_copy_reviews";

let tmpDir = "";
let source: DatabaseAdapter;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "overlook-copy-"));
  process.env.OVERLOOK_SQLITE_DIRS = tmpDir;
  const file = path.join(tmpDir, "source.sqlite");
  const db = new Database(file);
  db.exec(`
    CREATE TABLE ${COUNTRIES} (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE ${AUTHORS} (id INTEGER PRIMARY KEY, name TEXT NOT NULL, notes TEXT, country_id INTEGER REFERENCES ${COUNTRIES}(id));
    CREATE TABLE ${BOOKS} (id INTEGER PRIMARY KEY, author_id INTEGER REFERENCES ${AUTHORS}(id), title TEXT, meta TEXT);
    CREATE TABLE ${REVIEWS} (id INTEGER PRIMARY KEY, author_id INTEGER REFERENCES ${AUTHORS}(id), stars INTEGER);
  `);
  db.prepare(`INSERT INTO ${COUNTRIES} (id, name) VALUES (1, 'France'), (2, 'Italie')`).run();
  const author = db.prepare(`INSERT INTO ${AUTHORS} (id, name, notes, country_id) VALUES (?, ?, ?, ?)`);
  for (let i = 1; i <= 3; i++) author.run(i, `Author ${i}`, `note ${i}`, i === 3 ? 2 : 1);
  db.prepare(`INSERT INTO ${REVIEWS} (id, author_id, stars) VALUES (1, 1, 5), (2, 3, 4)`).run();
  const book = db.prepare(`INSERT INTO ${BOOKS} (id, author_id, title, meta) VALUES (?, ?, ?, ?)`);
  // More than two pages of a whole-table read, to go through the paging.
  for (let i = 1; i <= 4500; i++) book.run(i, (i % 3) + 1, `Book ${i}`, `{"n":${i}}`);
  db.close();
  const { SqliteAdapter } = await import("../db/sqlite");
  source = new SqliteAdapter({ ...connection("sqlite"), id: "copy-source", database: file });
});

afterAll(async () => {
  await source?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function run(target: DatabaseAdapter, engine: Engine, plan: CopyPlan): Promise<CopyEvent[]> {
  const events: CopyEvent[] = [];
  for await (const e of copyRows(source, target, engine, plan)) events.push(e);
  return events;
}

async function names(target: DatabaseAdapter): Promise<string[]> {
  const { rows } = await target.selectRows(AUTHORS, { limit: 100, sorts: [{ column: "id", dir: "asc" }] });
  return rows.map((r) => String(r.name));
}

for (const t of targets) {
  describe.skipIf(!t.enabled)(`copy from sqlite to ${t.engine}`, () => {
    let target: DatabaseAdapter;

    beforeAll(async () => {
      if (t.engine === "sqlite") {
        const file = path.join(tmpDir, "target.sqlite");
        new Database(file).close();
        const { SqliteAdapter } = await import("../db/sqlite");
        target = new SqliteAdapter({ ...connection("sqlite"), database: file });
      } else if (t.engine === "postgres") {
        const { PostgresAdapter } = await import("../db/postgres");
        target = new PostgresAdapter(connection("postgres", t.url));
      } else {
        const { MySqlAdapter } = await import("../db/mysql");
        target = new MySqlAdapter(connection("mysql", t.url));
      }
      const json = t.engine === "postgres" ? "jsonb" : t.engine === "mysql" ? "json" : "TEXT";
      const text = t.engine === "mysql" ? "VARCHAR(200)" : "TEXT";
      for (const table of [REVIEWS, BOOKS, AUTHORS, COUNTRIES]) await target.runStatement(`DROP TABLE IF EXISTS ${table}`);
      await target.runStatement(`CREATE TABLE ${COUNTRIES} (id INTEGER PRIMARY KEY, name ${text} NOT NULL)`);
      // The target has no "notes" column, and a column of its own.
      // Table-level FOREIGN KEY: MySQL ignores a REFERENCES written in the column definition.
      await target.runStatement(`CREATE TABLE ${AUTHORS} (id INTEGER PRIMARY KEY, name ${text} NOT NULL, country ${text}, country_id INTEGER, FOREIGN KEY (country_id) REFERENCES ${COUNTRIES}(id))`);
      await target.runStatement(`CREATE TABLE ${BOOKS} (id INTEGER PRIMARY KEY, author_id INTEGER, title ${text}, meta ${json}, FOREIGN KEY (author_id) REFERENCES ${AUTHORS}(id))`);
      await target.runStatement(`CREATE TABLE ${REVIEWS} (id INTEGER PRIMARY KEY, author_id INTEGER, stars INTEGER)`);
    });

    beforeEach(async () => {
      await target.emptyTables([REVIEWS, BOOKS, AUTHORS, COUNTRIES]);
      await target.insertRow(COUNTRIES, { id: 1, name: "France" });
    });

    afterAll(async () => {
      for (const table of [REVIEWS, BOOKS, AUTHORS, COUNTRIES]) await target.runStatement(`DROP TABLE IF EXISTS ${table}`).catch(() => {});
      await target.close();
    });

    it("copies whole tables, parents first, leaving out the columns the target lacks", async () => {
      const events = await run(target, t.engine, { tables: [BOOKS, AUTHORS, COUNTRIES], onConflict: "skip", emptyFirst: false });
      const plan = events[0];
      expect(plan.type === "plan" && plan.tables.map((x) => x.name)).toEqual([COUNTRIES, AUTHORS, BOOKS]);
      expect(plan.type === "plan" && plan.droppedColumns).toEqual({ [AUTHORS]: ["notes"] });
      expect(events.at(-1)).toEqual({ type: "done", read: 4505, written: 4504, added: 0, skipped: 0 });
      expect((await target.getTable(BOOKS)).rowCount).toBe(4500);
      const [book] = await target.selectRowsByPk(BOOKS, "id", [7]);
      expect(book.title).toBe("Book 7");
    });

    it("refuses to write anything when a row is already there, unless told to skip or replace it", async () => {
      await target.insertRow(AUTHORS, { id: 2, name: "Kept" });
      await expect(run(target, t.engine, { tables: [AUTHORS], onConflict: "error", emptyFirst: false })).rejects.toThrow(/existent déjà/);
      expect(await names(target)).toEqual(["Kept"]);

      const skipped = await run(target, t.engine, { tables: [AUTHORS], onConflict: "skip", emptyFirst: false, relations: "include" });
      expect(skipped.at(-1)).toEqual({ type: "done", read: 4, written: 3, added: 1, skipped: 0 });
      expect(await names(target)).toEqual(["Author 1", "Kept", "Author 3"]);

      await target.updateRow(AUTHORS, "id", 1, { name: "Changed" });
      const replaced = await run(target, t.engine, { tables: [AUTHORS], onConflict: "replace", emptyFirst: false, relations: "include" });
      expect(replaced.at(-1)).toMatchObject({ type: "done", read: 3 });
      expect(await names(target)).toEqual(["Author 1", "Author 2", "Author 3"]);
    });

    it("reads a big table page after page, each row once, and counts the rows already there", async () => {
      await run(target, t.engine, { tables: [AUTHORS], onConflict: "error", emptyFirst: false, relations: "include" });
      // "Cancel if already there" fails on a row read twice.
      const events = await run(target, t.engine, { tables: [BOOKS], onConflict: "error", emptyFirst: false });
      expect(events.at(-1)).toEqual({ type: "done", read: 4500, written: 4500, added: 0, skipped: 0 });
      const progress = events.filter((e) => e.type === "progress");
      expect(progress.length).toBe(3);

      await target.deleteRows(BOOKS, "id", ["10", "2500", "4500"]);
      await target.updateRow(BOOKS, "id", 7, { title: "Changed" });
      const skipped = await run(target, t.engine, { tables: [BOOKS], onConflict: "skip", emptyFirst: false });
      expect(skipped.at(-1)).toEqual({ type: "done", read: 4500, written: 3, added: 0, skipped: 0 });
      expect((await target.selectRowsByPk(BOOKS, "id", [7]))[0].title).toBe("Changed");

      const replaced = await run(target, t.engine, { tables: [BOOKS], onConflict: "replace", emptyFirst: false });
      expect(replaced.at(-1)).toMatchObject({ type: "done", read: 4500, written: 4500 });
      expect((await target.selectRowsByPk(BOOKS, "id", [7]))[0].title).toBe("Book 7");
    });

    it("copies only the chosen rows", async () => {
      await run(target, t.engine, { tables: [AUTHORS], onConflict: "error", emptyFirst: false, relations: "include" });
      const events = await run(target, t.engine, { tables: [BOOKS], ids: ["4", "5"], onConflict: "error", emptyFirst: false });
      expect(events.at(-1)).toEqual({ type: "done", read: 2, written: 2, added: 0, skipped: 0 });
      expect((await target.getTable(BOOKS)).rowCount).toBe(2);
    });

    it("empties the target tables first when asked", async () => {
      await target.insertRow(AUTHORS, { id: 9, name: "Gone" });
      await run(target, t.engine, { tables: [AUTHORS], onConflict: "error", emptyFirst: true, relations: "include" });
      expect(await names(target)).toEqual(["Author 1", "Author 2", "Author 3"]);
    });

    it("reports rows pointing to parents the target lacks, up the chain, without writing", async () => {
      // Books 2 and 5 are by author 3 (from Italy): neither is in the target.
      const analysis = await analyzeCopy(source, target, t.engine, { tables: [BOOKS], ids: ["1", "2", "5"], onConflict: "error", emptyFirst: false });
      const byColumn = Object.fromEntries(analysis.relations.map((r) => [`${r.fromTable}.${r.column}`, r]));
      expect(byColumn[`${BOOKS}.author_id`]).toMatchObject({ toTable: AUTHORS, enforced: true, rows: 3, missing: 2, unresolvable: 0 });
      expect(byColumn[`${AUTHORS}.country_id`]).toMatchObject({ toTable: COUNTRIES, enforced: true, rows: 1, missing: 1 });
      expect(analysis.extras).toEqual({ [AUTHORS]: 2, [COUNTRIES]: 1 });
      expect(analysis.orphans).toBe(3);
      expect((await target.getTable(AUTHORS)).rowCount).toBe(0);
    });

    it("brings the missing parents along, or leaves the rows pointing to them out", async () => {
      const included = await run(target, t.engine, { tables: [BOOKS], ids: ["1", "2", "5"], onConflict: "error", emptyFirst: false, relations: "include" });
      expect(included.at(-1)).toEqual({ type: "done", read: 6, written: 6, added: 3, skipped: 0 });
      expect((await target.getTable(COUNTRIES)).rowCount).toBe(2);

      await target.emptyTables([BOOKS, AUTHORS]);
      await target.insertRow(AUTHORS, { id: 1, name: "Author 1", country_id: 1 });
      const skipped = await run(target, t.engine, { tables: [BOOKS], ids: ["1", "2", "3", "5"], onConflict: "error", emptyFirst: false, relations: "skip" });
      // Books 1, 2 and 5 point to authors 2 and 3, absent: left out, nothing fails.
      expect(skipped.at(-1)).toEqual({ type: "done", read: 4, written: 1, added: 0, skipped: 3 });
    });

    it("warns about a link the target doesn't enforce, and still copies the row", async () => {
      const analysis = await analyzeCopy(source, target, t.engine, { tables: [REVIEWS], onConflict: "error", emptyFirst: false });
      expect(analysis.relations.find((r) => r.fromTable === REVIEWS)).toMatchObject({ toTable: AUTHORS, enforced: false, rows: 2, missing: 2 });
      const events = await run(target, t.engine, { tables: [REVIEWS], onConflict: "error", emptyFirst: false, relations: "skip" });
      expect(events.at(-1)).toMatchObject({ written: 2, skipped: 0 });
    });

    it("says which target tables must be emptied too, and empties them when asked", async () => {
      await run(target, t.engine, { tables: [AUTHORS, BOOKS], onConflict: "error", emptyFirst: false, relations: "include" });
      const analysis = await analyzeCopy(source, target, t.engine, { tables: [AUTHORS], onConflict: "error", emptyFirst: true });
      expect(analysis.emptyBlockers).toEqual([{ table: BOOKS, references: AUTHORS }]);
      await expect(run(target, t.engine, { tables: [AUTHORS], onConflict: "error", emptyFirst: true })).rejects.toThrow(/il faut aussi vider/);
      await run(target, t.engine, { tables: [AUTHORS], onConflict: "error", emptyFirst: true, emptyAlso: [BOOKS], relations: "include" });
      expect((await target.getTable(BOOKS)).rowCount).toBe(0);
      expect(await names(target)).toEqual(["Author 1", "Author 2", "Author 3"]);
    });

    it("skips a table the target doesn't have", async () => {
      const file = path.join(tmpDir, "source.sqlite");
      const db = new Database(file);
      db.exec("CREATE TABLE IF NOT EXISTS overlook_copy_only_here (id INTEGER PRIMARY KEY)");
      db.close();
      const events = await run(target, t.engine, { tables: ["overlook_copy_only_here"], onConflict: "error", emptyFirst: false });
      expect(events[0]).toMatchObject({ type: "plan", tables: [], missing: ["overlook_copy_only_here"] });
    });
  });
}
