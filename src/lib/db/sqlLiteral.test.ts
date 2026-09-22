import { describe, expect, it } from "vitest";
import { formatStatements, sqlLiteral } from "./adapter";

describe("sqlLiteral", () => {
  const long = "a".repeat(300);

  it("cuts long values short for display only", () => {
    expect(sqlLiteral(long)).toBe(`'${"a".repeat(200)}…'`);
    expect(sqlLiteral(long, { full: true })).toBe(`'${long}'`);
  });

  it("escapes quotes, and backslashes where MySQL reads them as escapes", () => {
    expect(sqlLiteral("O'Brien \\ x", { full: true })).toBe("'O''Brien \\ x'");
    expect(sqlLiteral("O'Brien \\ x", { full: true, backslashEscapes: true })).toBe("'O''Brien \\\\ x'");
  });

  it("inlines every parameter of the statements to run", () => {
    const statements = [{ sql: "UPDATE t SET a = $1 WHERE id IN ($2, $3)", params: [null, 1, "x"] }];
    expect(formatStatements(statements, "dollar", { full: true })).toBe("UPDATE t SET a = NULL WHERE id IN (1, 'x');");
  });
});
