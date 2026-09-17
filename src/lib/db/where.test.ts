import { describe, expect, it } from "vitest";
import type { ColumnMeta, LogicalType, RowFilter, TableMeta } from "../types";
import { buildDistinctValues, buildOrderBy, buildWhere, dateSpanEnd, describeSelect, isActiveFilter, opsFor, topDistinct } from "./where";

function col(name: string, logicalType: LogicalType, nativeType = "text"): ColumnMeta {
  return { name, logicalType, nativeType, nullable: true, isPrimaryKey: name === "id" };
}

const meta: TableMeta = {
  name: "orders",
  rowCount: 0,
  columns: [col("id", "number", "integer"), col("status", "text"), col("roles", "json", "json"), col("amount", "number", "numeric"), col("created_at", "date", "timestamp"), col("day", "date", "date")],
};

const where = (filters: RowFilter[], engine: "postgres" | "mysql" | "sqlite" = "postgres", match: "all" | "any" = "all", search?: string) => buildWhere(engine, meta, filters, search, match);

describe("dateSpanEnd", () => {
  it("ends a day at the next midnight", () => {
    expect(dateSpanEnd("2026-09-17")).toBe("2026-09-18");
    expect(dateSpanEnd("2026-12-31")).toBe("2027-01-01");
    expect(dateSpanEnd("2028-02-28")).toBe("2028-02-29");
  });

  it("ends a minute at the next minute, keeping the offset", () => {
    expect(dateSpanEnd("2026-09-17 14:05")).toBe("2026-09-17 14:06:00");
    expect(dateSpanEnd("2026-09-17 23:59:00")).toBe("2026-09-18 00:00:00");
    expect(dateSpanEnd("2026-09-17 14:05:00+02:00")).toBe("2026-09-17 14:06:00+02:00");
  });

  it("ends an instant with seconds one second later", () => {
    expect(dateSpanEnd("2026-09-17 14:05:42")).toBe("2026-09-17 14:05:43");
  });

  it("returns null for anything else", () => {
    expect(dateSpanEnd("yesterday")).toBeNull();
    expect(dateSpanEnd("17/09/2026")).toBeNull();
  });
});

describe("isActiveFilter", () => {
  it("ignores filters still being filled in", () => {
    expect(isActiveFilter({ column: "status", op: "eq", value: "" })).toBe(false);
    expect(isActiveFilter({ column: "status", op: "in", value: "", values: [] })).toBe(false);
    expect(isActiveFilter({ column: "status", op: "in", value: "", values: [""] })).toBe(false);
    expect(isActiveFilter({ column: "amount", op: "between", value: "", value2: "" })).toBe(false);
  });

  it("keeps complete ones", () => {
    expect(isActiveFilter({ column: "status", op: "empty", value: "" })).toBe(true);
    expect(isActiveFilter({ column: "amount", op: "between", value: "", value2: "10" })).toBe(true);
    expect(isActiveFilter({ column: "status", op: "in", value: "", values: ["paid"] })).toBe(true);
  });
});

describe("opsFor", () => {
  it("offers ranges on numbers and dates only", () => {
    expect(opsFor("number")).toContain("between");
    expect(opsFor("date")).toContain("between");
    expect(opsFor("text")).not.toContain("between");
    expect(opsFor("text")).toContain("in");
    expect(opsFor("date")).not.toContain("in");
  });
});

describe("buildWhere", () => {
  it("returns nothing without active filters or search", () => {
    expect(where([{ column: "status", op: "eq", value: "" }])).toEqual({ where: "", params: [] });
  });

  it("uses each engine's placeholders, quoting and text cast", () => {
    const f: RowFilter[] = [{ column: "status", op: "eq", value: "paid" }];
    expect(where(f, "postgres").where).toBe(`WHERE "status"::text = $1`);
    expect(where(f, "mysql").where).toBe("WHERE CAST(`status` AS CHAR) = ?");
    expect(where(f, "sqlite").where).toBe(`WHERE CAST("status" AS TEXT) = ?`);
  });

  it("matches contains case-insensitively on PostgreSQL", () => {
    expect(where([{ column: "status", op: "contains", value: "pa" }])).toEqual({ where: `WHERE "status"::text ILIKE $1`, params: ["%pa%"] });
  });

  it("keeps NULLs in does-not-contain", () => {
    expect(where([{ column: "status", op: "notContains", value: "pa" }], "sqlite").where).toBe(`WHERE ("status" IS NULL OR CAST("status" AS TEXT) NOT LIKE ?)`);
  });

  it("turns a day into a whole-day range", () => {
    expect(where([{ column: "created_at", op: "eq", value: "2026-09-16" }])).toEqual({
      where: `WHERE ("created_at" >= $1 AND "created_at" < $2)`,
      params: ["2026-09-16", "2026-09-17"],
    });
    expect(where([{ column: "created_at", op: "gt", value: "2026-09-16" }]).params).toEqual(["2026-09-17"]);
    expect(where([{ column: "created_at", op: "neq", value: "2026-09-16 10:27:00" }])).toEqual({
      where: `WHERE ("created_at" < $1 OR "created_at" >= $2)`,
      params: ["2026-09-16 10:27:00", "2026-09-16 10:28:00"],
    });
  });

  it("builds between with either bound, the upper one inclusive", () => {
    expect(where([{ column: "created_at", op: "between", value: "2026-09-14", value2: "2026-09-16" }])).toEqual({
      where: `WHERE "created_at" >= $1 AND "created_at" < $2`,
      params: ["2026-09-14", "2026-09-17"],
    });
    expect(where([{ column: "amount", op: "between", value: "", value2: "100" }])).toEqual({ where: `WHERE "amount" <= $1`, params: ["100"] });
    expect(where([{ column: "amount", op: "between", value: "5", value2: "" }])).toEqual({ where: `WHERE "amount" >= $1`, params: ["5"] });
  });

  it("compares numbers natively", () => {
    expect(where([{ column: "amount", op: "gt", value: "10" }], "mysql")).toEqual({ where: "WHERE `amount` > ?", params: ["10"] });
  });

  it("matches is-one-of on plain values and inside JSON lists", () => {
    expect(where([{ column: "roles", op: "in", value: "", values: ["ROLE_ADMIN", "ROLE_ADMIN", ""] }], "mysql")).toEqual({
      where: "WHERE (CAST(`roles` AS CHAR) IN (?) OR CAST(`roles` AS CHAR) LIKE ?)",
      params: ["ROLE_ADMIN", '%"ROLE_ADMIN"%'],
    });
    expect(where([{ column: "status", op: "in", value: "", values: ["paid"] }])).toEqual({ where: `WHERE "status"::text IN ($1)`, params: ["paid"] });
    expect(where([{ column: "id", op: "in", value: "", values: ["1", "2"] }])).toEqual({ where: `WHERE "id"::text IN ($1, $2)`, params: ["1", "2"] });
    expect(where([{ column: "id", op: "notIn", value: "", values: ["1"] }]).where).toBe(`WHERE ("id" IS NULL OR NOT "id"::text IN ($1))`);
  });

  it("tests emptiness as NULL or empty text", () => {
    expect(where([{ column: "status", op: "empty", value: "" }]).where).toBe(`WHERE ("status" IS NULL OR "status"::text = '')`);
    expect(where([{ column: "status", op: "notEmpty", value: "" }]).where).toBe(`WHERE ("status" IS NOT NULL AND "status"::text <> '')`);
  });

  it("joins filters with AND by default and OR in any mode, the search always ANDed", () => {
    const f: RowFilter[] = [
      { column: "status", op: "eq", value: "paid" },
      { column: "amount", op: "gt", value: "10" },
    ];
    expect(where(f).where).toBe(`WHERE "status"::text = $1 AND "amount" > $2`);
    expect(where(f, "postgres", "any", "x").where).toBe(`WHERE ("status"::text = $1 OR "amount" > $2) AND ("id"::text ILIKE $3 OR "status"::text ILIKE $3 OR "roles"::text ILIKE $3 OR "amount"::text ILIKE $3 OR "created_at"::text ILIKE $3 OR "day"::text ILIKE $3)`);
  });

  it("does not OR a single filter", () => {
    expect(where([{ column: "status", op: "eq", value: "paid" }], "postgres", "any").where).toBe(`WHERE "status"::text = $1`);
  });

  it("refuses unknown columns", () => {
    expect(() => where([{ column: "nope", op: "eq", value: "x" }])).toThrow(/Unknown column/);
    expect(() => where([{ column: 'x" OR 1=1 --', op: "eq", value: "x" }])).toThrow();
  });
});

describe("buildOrderBy", () => {
  it("orders by known columns", () => {
    expect(buildOrderBy("mysql", meta, [{ column: "amount", dir: "desc" }, { column: "id", dir: "asc" }])).toBe("ORDER BY `amount` DESC, `id` ASC");
    expect(buildOrderBy("postgres", meta, [])).toBe("");
  });
});

describe("describeSelect", () => {
  it("inlines the values of the statement a view runs", () => {
    expect(
      describeSelect("postgres", meta, { filters: [{ column: "status", op: "eq", value: "it's" }], sorts: [{ column: "id", dir: "desc" }], limit: 100, offset: 200 }),
    ).toBe(`SELECT * FROM "orders" WHERE "status"::text = 'it''s' ORDER BY "id" DESC LIMIT 100 OFFSET 200;`);
  });
});

describe("buildDistinctValues", () => {
  it("groups non-empty values, optionally narrowed", () => {
    expect(buildDistinctValues("postgres", meta, "status", "pa", 10)).toEqual({
      sql: `SELECT "status"::text AS value, COUNT(*) AS count FROM "orders" WHERE "status" IS NOT NULL AND "status"::text <> '' AND "status"::text ILIKE $1 GROUP BY "status"::text ORDER BY COUNT(*) DESC, "status"::text LIMIT 10`,
      params: ["%pa%"],
    });
  });
});

describe("topDistinct", () => {
  it("keeps plain values as they are", () => {
    const rows = [
      { value: "paid", count: 3 },
      { value: "[not json", count: 1 },
    ];
    expect(topDistinct(rows)).toEqual(rows);
  });

  it("counts the elements of JSON lists", () => {
    expect(
      topDistinct([
        { value: '["ROLE_USER"]', count: 10 },
        { value: '["ROLE_ADMIN", "ROLE_USER"]', count: 2 },
        { value: "[]", count: 1 },
      ]),
    ).toEqual([
      { value: "ROLE_USER", count: 12 },
      { value: "ROLE_ADMIN", count: 2 },
    ]);
  });

  it("keeps only the elements matching the search", () => {
    expect(topDistinct([{ value: '["ROLE_ADMIN", "ROLE_USER"]', count: 2 }], "admin")).toEqual([{ value: "ROLE_ADMIN", count: 2 }]);
  });
});
