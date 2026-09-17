// Tab-separated text, the format spreadsheets put on the clipboard.
import type { ColumnMeta } from "../types";

function quoteCell(text: string): string {
  return /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toTsv(matrix: string[][]): string {
  return matrix.map((row) => row.map(quoteCell).join("\t")).join("\n");
}

/** Parses spreadsheet clipboard text, including quoted cells with tabs or line breaks. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const input = text.replace(/\r\n?/g, "\n");
  while (i < input.length) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        cell += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
    i++;
  }
  // A trailing line break doesn't add an empty row.
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const TRUE_WORDS = ["true", "1", "yes", "oui", "x", "✓", "vrai"];

/** Turns pasted text into a value for the column, or undefined when it doesn't fit. */
export function pastedValue(text: string, col: ColumnMeta): unknown {
  const trimmed = text.trim();
  switch (col.logicalType) {
    case "checkbox":
      return TRUE_WORDS.includes(trimmed.toLowerCase());
    case "number": {
      if (trimmed === "") return null;
      // Accept "1 234,5" as pasted from a French spreadsheet.
      const n = Number(trimmed.replace(/[\s  ]/g, "").replace(",", "."));
      return Number.isFinite(n) ? n : undefined;
    }
    case "date":
    case "relation":
    case "select":
      return trimmed === "" ? null : trimmed;
    case "unknown":
      return undefined;
    default:
      return text;
  }
}
