// Splits a SQL script into individual statements on top-level `;`, ignoring
// semicolons inside string/identifier literals and comments so that each
// statement can be executed independently (one bad row shouldn't block the rest).
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  let quote: '"' | "'" | "`" | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      current += ch;
      if (ch === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      current += ch;
      if (ch === "*" && next === "/") {
        current += next;
        i += 2;
        inBlockComment = false;
        continue;
      }
      i++;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === "\\" && quote !== "`") {
        // escaped char, consume next literally
        if (next !== undefined) {
          current += next;
          i += 2;
          continue;
        }
      }
      if (ch === quote) {
        if (next === quote) {
          current += next;
          i += 2;
          continue;
        }
        quote = null;
      }
      i++;
      continue;
    }

    if (ch === "-" && next === "-") {
      inLineComment = true;
      current += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      current += ch;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      current += ch;
      i++;
      continue;
    }
    if (ch === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

// MySQL rejects ISO 8601 datetime literals with a trailing "Z" (and some
// versions choke on the "T" separator too), even though that's exactly what
// JS Date#toISOString() produces and what many SQL dumps use. Rewrite them to
// MySQL's own 'YYYY-MM-DD HH:MM:SS[.fff]' format wherever they appear as
// quoted string literals, so imports don't fail on a format MySQL itself
// can't parse.
const ISO_DATETIME_RE = /'(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)Z?'/g;

export function normalizeMysqlDateLiterals(sql: string): string {
  return sql.replace(ISO_DATETIME_RE, "'$1 $2'");
}
