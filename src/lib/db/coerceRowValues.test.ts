import { describe, expect, it } from "vitest";
import { coerceRowValues } from "./adapter";
import type { ColumnMeta, TableMeta } from "../types";

const col = (name: string, logicalType: ColumnMeta["logicalType"]): ColumnMeta => ({ name, logicalType, nativeType: "", nullable: true, isPrimaryKey: false });
const meta: TableMeta = { name: "t", rowCount: 0, columns: [col("data", "json"), col("tags", "json"), col("n", "number"), col("s", "text")] };

describe("coerceRowValues", () => {
  it("turns parsed JSON values back into text, so a copied row can be inserted", () => {
    expect(coerceRowValues(meta, { data: { a: 1 }, tags: [] })).toEqual({ data: '{"a":1}', tags: "[]" });
  });

  it("keeps JSON text and nulls as they are", () => {
    expect(coerceRowValues(meta, { data: '{"a":1}', tags: null })).toEqual({ data: '{"a":1}', tags: null });
  });

  it("empties a non-text value to NULL", () => {
    expect(coerceRowValues(meta, { n: "", s: "" })).toEqual({ n: null, s: "" });
  });
});
