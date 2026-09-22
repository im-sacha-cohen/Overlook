// Splits a SQL script into individual statements on top-level `;`, ignoring
// semicolons inside string/identifier literals and comments so that each
// statement can be executed independently (one bad row shouldn't block the rest).
export function splitSqlStatements(sql: string): string[] {
  const splitter = new SqlStatementSplitter();
  return [...splitter.push(sql), ...splitter.end()];
}

/**
 * The same split, fed piece by piece: a script of any size goes through with
 * only the statement being read held in memory. A literal, comment or `;`
 * cut between two pieces is picked up where it left off.
 */
const BACKSLASH = 92;

export class SqlStatementSplitter {
  private buf = "";
  /** Where scanning resumes in `buf`: everything before it has been classified. */
  private pos = 0;
  private quote: '"' | "'" | "`" | null = null;
  private inLineComment = false;
  private inBlockComment = false;

  /** Adds text and returns the statements it completed. */
  push(text: string): string[] {
    this.buf += text;
    return this.scan(false);
  }

  /** Returns what is left once the script has been fully read. */
  end(): string[] {
    return this.scan(true);
  }

  /** Characters received but not yet returned as part of a statement. */
  get pendingLength(): number {
    return this.buf.length;
  }

  private scan(final: boolean): string[] {
    const statements: string[] = [];
    const buf = this.buf;
    const n = buf.length;
    let start = 0;
    let i = this.pos;
    // A character whose meaning depends on the next one waits for it, unless nothing else is coming.
    const waiting = () => i + 1 >= n && !final;

    scanning: while (i < n) {
      if (this.inLineComment) {
        const nl = buf.indexOf("\n", i);
        if (nl < 0) {
          i = n;
          break;
        }
        this.inLineComment = false;
        i = nl + 1;
        continue;
      }
      if (this.inBlockComment) {
        const star = buf.indexOf("*/", i);
        if (star < 0) {
          // Keep a trailing "*" in view: its "/" may be in the next piece.
          i = buf[n - 1] === "*" && !final ? n - 1 : n;
          break;
        }
        this.inBlockComment = false;
        i = star + 2;
        continue;
      }
      if (this.quote) {
        const quote = this.quote;
        while (i < n) {
          const ch = buf.charCodeAt(i);
          if (ch === BACKSLASH && quote !== "`") {
            if (waiting()) break scanning;
            i += 2;
            continue;
          }
          if (buf[i] === quote) {
            if (waiting()) break scanning;
            if (buf[i + 1] === quote) {
              i += 2;
              continue;
            }
            this.quote = null;
            i++;
            continue scanning;
          }
          i++;
        }
        break;
      }

      const ch = buf[i];
      if (ch === "-" || ch === "/") {
        if (waiting()) break;
        const next = buf[i + 1];
        if (ch === "-" && next === "-") {
          this.inLineComment = true;
          i += 2;
          continue;
        }
        if (ch === "/" && next === "*") {
          this.inBlockComment = true;
          i += 2;
          continue;
        }
        i++;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") {
        this.quote = ch;
        i++;
        continue;
      }
      if (ch === ";") {
        const statement = buf.slice(start, i).trim();
        if (statement) statements.push(statement);
        start = i + 1;
      }
      i++;
    }

    if (final) {
      const rest = buf.slice(start).trim();
      if (rest) statements.push(rest);
      this.buf = "";
      this.pos = 0;
      this.quote = null;
      this.inLineComment = false;
      this.inBlockComment = false;
    } else {
      this.buf = buf.slice(start);
      this.pos = i - start;
    }
    return statements;
  }
}

/** The statement's first word, past any leading comments, in upper case. Each alternative matches one way only, so it can't backtrack for long. */
export function leadingKeyword(sql: string): string {
  const match = /^(?:\s|--[^\n]*|\/\*(?:[^*]|\*(?!\/))*\*\/)*([A-Za-z]+)/.exec(sql);
  return match ? match[1].toUpperCase() : "";
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
