import { describe, expect, it } from "vitest";
import type { ColumnMeta, FilterGroup, LogicalType, RowFilter, TableMeta } from "../types";
import { aggregateResult, buildAggregate, buildDistinctValues, buildOrderBy, buildWhere, dateSpanEnd, describeSelect, isActiveFilter, likeContains, opsFor, topDistinct, type TableLookup } from "./where";

function col(name: string, logicalType: LogicalType, nativeType = "text"): ColumnMeta {
  return { name, logicalType, nativeType, nullable: true, isPrimaryKey: name === "id" };
}

const meta: TableMeta = {
  name: "orders",
  rowCount: 0,
  columns: [col("id", "number", "integer"), col("status", "text"), col("roles", "json", "json"), col("amount", "number", "numeric"), col("created_at", "date", "timestamp"), col("day", "date", "date")],
};

const where = (filters: RowFilter[], engine: "postgres" | "mysql" | "sqlite" = "postgres", filterMatch: "all" | "any" = "all", search?: string, filterGroups?: FilterGroup[]) =>
  buildWhere(engine, meta, { filters, filterMatch, search, filterGroups });

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
    expect(where([{ column: "status", op: "contains", value: "pa" }])).toEqual({ where: `WHERE "status"::text ILIKE $1 ESCAPE '!'`, params: ["%pa%"] });
  });

  it("keeps NULLs in does-not-contain", () => {
    expect(where([{ column: "status", op: "notContains", value: "pa" }], "sqlite").where).toBe(`WHERE ("status" IS NULL OR CAST("status" AS TEXT) NOT LIKE ? ESCAPE '!')`);
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
      where: `WHERE ("created_at" >= $1 AND "created_at" < $2)`,
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
      where: "WHERE (CAST(`roles` AS CHAR) IN (?) OR CAST(`roles` AS CHAR) LIKE ? ESCAPE '!')",
      params: ["ROLE_ADMIN", '%"ROLE!_ADMIN"%'],
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
    expect(where(f, "postgres", "any", "x").where).toBe(
      `WHERE ("status"::text = $1 OR "amount" > $2) AND ("id"::text ILIKE $3 ESCAPE '!' OR "status"::text ILIKE $3 ESCAPE '!' OR "roles"::text ILIKE $3 ESCAPE '!' OR "amount"::text ILIKE $3 ESCAPE '!' OR "created_at"::text ILIKE $3 ESCAPE '!' OR "day"::text ILIKE $3 ESCAPE '!')`,
    );
  });

  it("does not OR a single filter", () => {
    expect(where([{ column: "status", op: "eq", value: "paid" }], "postgres", "any").where).toBe(`WHERE "status"::text = $1`);
  });

  it("takes % and _ literally in contains and search", () => {
    expect(likeContains("100%_off!")).toBe("%100!%!_off!!%");
    expect(where([{ column: "status", op: "contains", value: "user_id" }], "mysql")).toEqual({ where: "WHERE CAST(`status` AS CHAR) LIKE ? ESCAPE '!'", params: ["%user!_id%"] });
  });

  it("skips disabled filters", () => {
    expect(where([{ column: "status", op: "eq", value: "paid", disabled: true }])).toEqual({ where: "", params: [] });
  });

  it("puts groups between parentheses with their own all/any", () => {
    const groups: FilterGroup[] = [{ id: "g1", match: "any" }];
    const filters: RowFilter[] = [
      { column: "status", op: "eq", value: "paid", group: "g1" },
      { column: "amount", op: "gt", value: "100" },
      { column: "status", op: "eq", value: "pending", group: "g1" },
    ];
    expect(where(filters, "mysql", "all", undefined, groups)).toEqual({
      where: "WHERE (CAST(`status` AS CHAR) = ? OR CAST(`status` AS CHAR) = ?) AND `amount` > ?",
      params: ["paid", "pending", "100"],
    });
    expect(where(filters, "postgres", "all", undefined, groups)).toEqual({
      where: `WHERE ("status"::text = $1 OR "status"::text = $2) AND "amount" > $3`,
      params: ["paid", "pending", "100"],
    });
    expect(where(filters, "postgres", "any", undefined, [{ id: "g1", match: "all" }]).where).toBe(`WHERE (("status"::text = $1 AND "status"::text = $2) OR "amount" > $3)`);
  });

  it("drops an empty group and treats an unknown group as top level", () => {
    const groups: FilterGroup[] = [{ id: "g1", match: "any" }];
    expect(where([{ column: "status", op: "eq", value: "", group: "g1" }, { column: "amount", op: "gt", value: "1" }], "postgres", "all", undefined, groups).where).toBe(`WHERE "amount" > $1`);
    expect(where([{ column: "status", op: "eq", value: "paid", group: "gone" }]).where).toBe(`WHERE "status"::text = $1`);
  });

  it("refuses unknown columns", () => {
    expect(() => where([{ column: "nope", op: "eq", value: "x" }])).toThrow(/Unknown column/);
    expect(() => where([{ column: 'x" OR 1=1 --', op: "eq", value: "x" }])).toThrow();
  });
});

describe("filters through foreign keys", () => {
  const client: TableMeta = { name: "client", rowCount: 0, columns: [col("id", "number"), col("nom", "text")] };
  const dossier: TableMeta = {
    name: "dossier",
    rowCount: 0,
    columns: [col("id", "number"), col("public_id", "text"), col("created_at", "date", "timestamp"), { ...col("client_id", "relation", "int"), references: { table: "client", column: "id" } }],
  };
  const document: TableMeta = {
    name: "document",
    rowCount: 0,
    columns: [col("id", "number"), col("libelle", "text"), { ...col("dossier_id", "relation", "int"), references: { table: "dossier", column: "id" } }],
  };
  const lookup: TableLookup = (name) => ({ client, dossier, document })[name as "client"];

  it("keeps rows whose foreign key points at a matching row", () => {
    expect(buildWhere("postgres", document, { filters: [{ column: "public_id", via: ["dossier_id"], op: "eq", value: "ABC" }] }, lookup)).toEqual({
      where: `WHERE "dossier_id" IN (SELECT "id" FROM "dossier" WHERE "public_id"::text = $1)`,
      params: ["ABC"],
    });
  });

  it("follows several hops and uses the related column's type", () => {
    expect(buildWhere("mysql", document, { filters: [{ column: "nom", via: ["dossier_id", "client_id"], op: "contains", value: "Rue" }] }, lookup).where).toBe(
      "WHERE `dossier_id` IN (SELECT `id` FROM `dossier` WHERE `client_id` IN (SELECT `id` FROM `client` WHERE CAST(`nom` AS CHAR) LIKE ? ESCAPE '!'))",
    );
    expect(buildWhere("postgres", document, { filters: [{ column: "created_at", via: ["dossier_id"], op: "eq", value: "2026-09-16" }] }, lookup).params).toEqual(["2026-09-16", "2026-09-17"]);
  });

  it("mixes with plain filters in reading order", () => {
    const { where, params } = buildWhere(
      "sqlite",
      document,
      {
        filters: [
          { column: "libelle", op: "contains", value: "kbis" },
          { column: "public_id", via: ["dossier_id"], op: "in", value: "", values: ["A", "B"] },
        ],
      },
      lookup,
    );
    expect(where).toBe(`WHERE CAST("libelle" AS TEXT) LIKE ? ESCAPE '!' AND "dossier_id" IN (SELECT "id" FROM "dossier" WHERE CAST("public_id" AS TEXT) IN (?, ?))`);
    expect(params).toEqual(["%kbis%", "A", "B"]);
  });

  it("refuses a column that isn't a foreign key, an unknown table or column", () => {
    expect(() => buildWhere("postgres", document, { filters: [{ column: "id", via: ["libelle"], op: "eq", value: "1" }] }, lookup)).toThrow(/Not a foreign key/);
    expect(() => buildWhere("postgres", document, { filters: [{ column: "nope", via: ["dossier_id"], op: "eq", value: "1" }] }, lookup)).toThrow(/Unknown column/);
    expect(() => buildWhere("postgres", document, { filters: [{ column: "public_id", via: ["dossier_id"], op: "eq", value: "1" }] })).toThrow(/Unknown table/);
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
      sql: `SELECT t0."status"::text AS value, COUNT(*) AS count, CASE WHEN COUNT(DISTINCT t0."id") = 1 THEN MIN(t0."id") END AS id FROM "orders" t0 WHERE t0."status" IS NOT NULL AND t0."status"::text <> '' AND t0."status"::text ILIKE $1 ESCAPE '!' GROUP BY t0."status"::text ORDER BY COUNT(*) DESC, t0."status"::text LIMIT 10`,
      params: ["%pa%"],
    });
  });

  it("counts on the rows the other filters keep, numbering placeholders after theirs", () => {
    const { sql, params } = buildDistinctValues("postgres", meta, "status", "pa", 10, { within: { filters: [{ column: "amount", op: "gt", value: "5" }] } });
    expect(sql).toContain(`FROM (SELECT * FROM "orders" WHERE "amount" > $1) t0 WHERE`);
    expect(sql).toContain(`ILIKE $2 ESCAPE '!'`);
    expect(params).toEqual(["5", "%pa%"]);
  });

  it("counts rows of the table on screen for a related column, with the related key as id", () => {
    const dossier: TableMeta = { name: "dossier", rowCount: 0, columns: [col("id", "number"), col("public_id", "text")] };
    const document: TableMeta = { name: "document", rowCount: 0, columns: [col("id", "number"), { ...col("dossier_id", "relation", "int"), references: { table: "dossier", column: "id" } }] };
    expect(buildDistinctValues("mysql", document, "public_id", "", 50, { via: ["dossier_id"], lookup: (n) => (n === "dossier" ? dossier : undefined) }).sql).toBe(
      "SELECT CAST(t1.`public_id` AS CHAR) AS value, COUNT(*) AS count, CASE WHEN COUNT(DISTINCT t1.`id`) = 1 THEN MIN(t1.`id`) END AS id FROM `document` t0 JOIN `dossier` t1 ON t0.`dossier_id` = t1.`id` WHERE t1.`public_id` IS NOT NULL AND CAST(t1.`public_id` AS CHAR) <> '' GROUP BY CAST(t1.`public_id` AS CHAR) ORDER BY COUNT(*) DESC, CAST(t1.`public_id` AS CHAR) LIMIT 50",
    );
  });
});

describe("buildAggregate", () => {
  it("computes every summary in one statement, over the filtered rows", () => {
    const { sql, params, keys } = buildAggregate("mysql", meta, { filters: [{ column: "status", op: "eq", value: "paid" }] }, [
      { column: "amount", fn: "sum" },
      { column: "status", fn: "empty" },
      { column: "status", fn: "unique" },
    ]);
    expect(sql).toBe(
      "SELECT SUM(`amount`) AS `a0`, SUM(CASE WHEN `status` IS NULL OR CAST(`status` AS CHAR) = '' THEN 1 ELSE 0 END) AS `a1`, COUNT(DISTINCT CASE WHEN CAST(`status` AS CHAR) <> '' THEN CAST(`status` AS CHAR) END) AS `a2` FROM `orders` WHERE CAST(`status` AS CHAR) = ?",
    );
    expect(params).toEqual(["paid"]);
    expect(keys).toEqual(["amount:sum", "status:empty", "status:unique"]);
  });

  it("refuses summaries that don't fit the column", () => {
    expect(() => buildAggregate("postgres", meta, {}, [{ column: "status", fn: "sum" }])).toThrow(/Unsupported/);
  });

  it("returns numbers as numbers and dates as text", () => {
    expect(aggregateResult(["a:sum", "b:max", "c:min", "d:avg"], { a0: "12.50", a1: "2026-09-16 10:27:17", a2: null, a3: BigInt(3) })).toEqual({ "a:sum": 12.5, "b:max": "2026-09-16 10:27:17", "c:min": null, "d:avg": 3 });
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
