import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Connection } from "../types";

// The metadata database is opened once from DATA_DIR: point it at a temporary
// folder before importing the store, so tests never touch a real install.
let store: typeof import("./metadata");
let dir = "";

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "overlook-store-"));
  process.env.DATA_DIR = dir;
  process.env.OVERLOOK_SQLITE_DIRS = dir;
  store = await import("./metadata");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function add(name: string, folder?: string): Connection {
  return store.createConnection({ name, envType: "local", engine: "postgres", database: "db", host: "127.0.0.1", folder });
}

describe("connection folders", () => {
  it("files a connection under a folder, and trims the name", () => {
    const c = add("one", "  Clients  ");
    expect(c.folder).toBe("Clients");
    expect(store.listConnectionFolders()).toEqual(["Clients"]);
  });

  it("keeps an empty folder, created on its own", () => {
    expect(store.createConnectionFolder(" Archives ")).toEqual(["Clients", "Archives"]);
    expect(() => store.createConnectionFolder("  ")).toThrow();
    // Creating the same folder twice doesn't duplicate it.
    expect(store.createConnectionFolder("Archives")).toEqual(["Clients", "Archives"]);
  });

  it("moves a connection in and out of a folder", () => {
    const c = add("two");
    expect(c.folder).toBeUndefined();
    expect(store.updateConnection(c.id, { folder: "Archives" })?.folder).toBe("Archives");
    expect(store.updateConnection(c.id, { folder: "" })?.folder).toBeUndefined();
    // Leaving the field out keeps the folder.
    store.updateConnection(c.id, { folder: "Archives" });
    expect(store.updateConnection(c.id, { name: "two renamed" })?.folder).toBe("Archives");
  });

  it("renames a folder and its connections together", () => {
    store.renameConnectionFolder("Archives", "Archivés");
    expect(store.listConnectionFolders()).toEqual(["Clients", "Archivés"]);
    expect(store.listConnections().find((c) => c.name === "two renamed")?.folder).toBe("Archivés");
  });

  it("deletes a folder but keeps its connections", () => {
    store.deleteConnectionFolder("Archivés");
    expect(store.listConnectionFolders()).toEqual(["Clients"]);
    const kept = store.listConnections().find((c) => c.name === "two renamed");
    expect(kept).toBeTruthy();
    expect(kept?.folder).toBeUndefined();
  });

  it("lists a folder a connection still names even if it was never created", () => {
    add("three", "Ad hoc");
    expect(store.listConnectionFolders()).toEqual(["Clients", "Ad hoc"]);
  });
});
