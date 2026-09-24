import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Connection } from "../types";

// The metadata database is opened once from DATA_DIR: point it at a temporary
// folder before importing the store, so tests never touch a real install.
let store: typeof import("./metadata");
let prefs: typeof import("./prefs");
let dir = "";

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "overlook-prefs-"));
  process.env.DATA_DIR = dir;
  process.env.OVERLOOK_SQLITE_DIRS = dir;
  store = await import("./metadata");
  prefs = await import("./prefs");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function add(name: string, folder?: string): Connection {
  return store.createConnection({ name, envType: "local", engine: "postgres", database: "db", host: "127.0.0.1", folder });
}

describe("table preferences shared by folder", () => {
  it("gives a table the same layout in every connection of the folder", () => {
    const prod = add("prod", "Shop");
    const local = add("local", "Shop");
    prefs.saveTablePrefs(prod.id, "users", { columnWidths: { email: 320 }, columnOrder: ["email", "id"] });
    expect(prefs.listTablePrefs(local.id).users.columnWidths).toEqual({ email: 320 });
    expect(prefs.listTablePrefs(local.id).users.columnOrder).toEqual(["email", "id"]);

    // Back to the defaults from either side resets it for both.
    prefs.saveTablePrefs(local.id, "users", {});
    expect(prefs.listTablePrefs(prod.id).users).toBeUndefined();
  });

  it("keeps connections outside a folder, or in another one, apart", () => {
    const loose = add("loose");
    const other = add("other", "Blog");
    const shop = add("shop", "Shop");
    prefs.saveTablePrefs(loose.id, "posts", { hiddenColumns: ["body"] });
    prefs.saveTablePrefs(other.id, "posts", { hiddenColumns: ["title"] });
    expect(prefs.listTablePrefs(shop.id).posts).toBeUndefined();
    expect(prefs.listTablePrefs(loose.id).posts.hiddenColumns).toEqual(["body"]);
    expect(prefs.listTablePrefs(other.id).posts.hiddenColumns).toEqual(["title"]);
  });

  it("picks up the folder's layout when a connection joins it, without imported prefs taking over", () => {
    const a = add("a", "Crm");
    prefs.saveTablePrefs(a.id, "deals", { frozenColumns: ["name"] });
    const b = add("b");
    prefs.replaceTablePrefs(b.id, { deals: { frozenColumns: ["amount"] } });
    store.updateConnection(b.id, { folder: "Crm" });
    expect(prefs.listTablePrefs(b.id).deals.frozenColumns).toEqual(["name"]);
  });
});
