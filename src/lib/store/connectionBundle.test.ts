import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConnectionBundle } from "../connectionBundle";

// Same setup as connectionFolders.test: a throwaway DATA_DIR before the store loads.
let store: typeof import("./metadata");
let bundles: typeof import("./connectionBundle");
let dir = "";

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "overlook-bundle-"));
  process.env.DATA_DIR = dir;
  process.env.OVERLOOK_SQLITE_DIRS = dir;
  store = await import("./metadata");
  bundles = await import("./connectionBundle");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function bundleOf(connections: ConnectionBundle["connections"]): ConnectionBundle {
  return { format: "overlook-connections", version: 1, exportedAt: "", encryption: null, connections };
}

const api = { name: "api", envType: "dev", engine: "postgres", host: "db.local", database: "app", ssl: false } as const;

describe("importing a connections file", () => {
  it("adds to the connections already there, copying a duplicate under another name", () => {
    store.createConnection({ ...api, folder: "Old" });
    store.createConnectionFolder("Empty");
    const [copy] = bundles.importBundle(bundleOf([api]), [0], undefined);
    expect(copy.name).toBe("api (2)");
    expect(store.listConnections()).toHaveLength(2);
  });

  it("replaces everything: connections and folders, in the file's order", () => {
    const file = bundleOf([
      { ...api, name: "b", folder: "Zeta" },
      { ...api, name: "a", folder: "Alpha" },
      { ...api, name: "skipped", folder: "Skipped" },
    ]);
    const created = bundles.importBundle(file, [0, 1], undefined, true);
    expect(store.listConnections().map((c) => c.name)).toEqual(["b", "a"]);
    expect(store.listConnections().map((c) => c.id)).toEqual(created.map((c) => c.id));
    expect(store.listConnectionFolders()).toEqual(["Zeta", "Alpha"]);
  });

  it("keeps the old list when the import fails", () => {
    const before = store.listConnections();
    const bad = bundleOf([{ ...api, engine: "sqlite", database: "/nowhere/allowed.sqlite" }]);
    expect(() => bundles.importBundle(bad, [0], undefined, true)).toThrow();
    expect(store.listConnections()).toEqual(before);
  });
});
