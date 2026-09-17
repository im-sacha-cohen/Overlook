import { describe, expect, it } from "vitest";
import { EMPTY_PREFS, isEmptyPrefs, sanitizeTablePrefs } from "./prefs";
import { decodeSharedView, encodeSharedView } from "./client/sharedView";

describe("table preferences", () => {
  it("keeps a table whose only setting is a frozen column, a summary or a group", () => {
    expect(isEmptyPrefs(EMPTY_PREFS)).toBe(true);
    expect(isEmptyPrefs({ ...EMPTY_PREFS, frozenColumns: ["name"] })).toBe(false);
    expect(isEmptyPrefs({ ...EMPTY_PREFS, columnSummaries: { amount: "sum" } })).toBe(false);
    expect(isEmptyPrefs({ ...EMPTY_PREFS, filterGroups: [{ id: "g", match: "any" }] })).toBe(false);
  });

  it("sanitizes the new fields", () => {
    const p = sanitizeTablePrefs({
      frozenColumns: ["name", 3],
      columnSummaries: { amount: "sum", status: "drop table" },
      filterGroups: [{ id: "g", match: "any" }, { match: "all" }],
      filters: [{ column: "status", op: "eq", value: "x", disabled: true, group: "g" }],
    });
    expect(p.frozenColumns).toEqual(["name"]);
    expect(p.columnSummaries).toEqual({ amount: "sum" });
    expect(p.filterGroups).toEqual([{ id: "g", match: "any" }]);
    expect(p.filters).toEqual([{ column: "status", op: "eq", value: "x", disabled: true, group: "g" }]);
  });
});

describe("shared view links", () => {
  it("round-trips filters, groups, sorts and layout, accents included", () => {
    const view = {
      filters: [{ column: "name", op: "contains" as const, value: "Hélène", group: "g" }],
      filterMatch: "any" as const,
      filterGroups: [{ id: "g", match: "all" as const }],
      sorts: [{ column: "id", dir: "desc" as const }],
      groupBy: "",
      view: "board" as const,
    };
    expect(decodeSharedView(encodeSharedView(view))).toEqual(view);
  });

  it("ignores a broken parameter", () => {
    expect(decodeSharedView("not-base64!")).toBeNull();
    expect(decodeSharedView(null)).toBeNull();
  });
});
