import { describe, expect, it } from "vitest";
import { leadingKeyword, splitSqlStatements, SqlStatementSplitter } from "./splitSqlStatements";

const SCRIPT = `-- header; with a semicolon
CREATE TABLE "a;b" (id int, label text);
/* block ; comment */ INSERT INTO t VALUES ('it''s; fine', "q"";x", \`b;t\`);
INSERT INTO t VALUES ('back\\'slash; still inside');
INSERT INTO t VALUES ('*/ not a comment end -- nor a line comment');
SELECT 1 - -1, 4/2;
/* trailing ** */ SELECT '-';
-- last line without a semicolon
SELECT 'end'`;

const EXPECTED = [
  `-- header; with a semicolon\nCREATE TABLE "a;b" (id int, label text)`,
  `/* block ; comment */ INSERT INTO t VALUES ('it''s; fine', "q"";x", \`b;t\`)`,
  `INSERT INTO t VALUES ('back\\'slash; still inside')`,
  `INSERT INTO t VALUES ('*/ not a comment end -- nor a line comment')`,
  `SELECT 1 - -1, 4/2`,
  `/* trailing ** */ SELECT '-'`,
  `-- last line without a semicolon\nSELECT 'end'`,
];

function splitInPieces(text: string, size: number): string[] {
  const splitter = new SqlStatementSplitter();
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(...splitter.push(text.slice(i, i + size)));
  out.push(...splitter.end());
  return out;
}

describe("splitSqlStatements", () => {
  it("splits on top-level semicolons only", () => {
    expect(splitSqlStatements(SCRIPT)).toEqual(EXPECTED);
  });

  it("gives the same statements whatever the pieces the script arrives in", () => {
    for (let size = 1; size <= SCRIPT.length; size++) {
      expect(splitInPieces(SCRIPT, size), `pieces of ${size}`).toEqual(EXPECTED);
    }
  });

  it("returns each statement as soon as its semicolon arrives", () => {
    const splitter = new SqlStatementSplitter();
    expect(splitter.push("SELECT 1; SELECT")).toEqual(["SELECT 1"]);
    expect(splitter.push(" 2")).toEqual([]);
    expect(splitter.push(";")).toEqual(["SELECT 2"]);
    expect(splitter.end()).toEqual([]);
  });

  it("only keeps the unfinished statement in memory", () => {
    const splitter = new SqlStatementSplitter();
    for (let i = 0; i < 1000; i++) splitter.push(`INSERT INTO t VALUES (${i}, 'row ${i}');\n`);
    expect(splitter.pendingLength).toBeLessThan(40);
  });

  it("does not take the opening /* for a closing */", () => {
    expect(splitSqlStatements("/*/ ; */ SELECT 1; SELECT 2")).toEqual(["/*/ ; */ SELECT 1", "SELECT 2"]);
  });

  it("skips empty statements", () => {
    expect(splitSqlStatements(" ; ;\n;SELECT 1;;")).toEqual(["SELECT 1"]);
  });
});

describe("leadingKeyword", () => {
  it("reads the first word past comments", () => {
    expect(leadingKeyword("  -- note\n/* a * b */ begin transaction")).toBe("BEGIN");
    expect(leadingKeyword("PRAGMA foreign_keys=OFF")).toBe("PRAGMA");
    expect(leadingKeyword("(SELECT 1)")).toBe("");
  });

  it("stays fast on text it can't match", () => {
    const started = Date.now();
    leadingKeyword(" ".repeat(50_000) + "/* ".repeat(5_000) + "(");
    expect(Date.now() - started).toBeLessThan(200);
  });
});
