import type { CSSProperties } from "react";
import type { ColumnMeta, LogicalType } from "../types";
import type { Lang } from "../i18n/translations";

export function iconFor(type: LogicalType): string {
  return { text: "T", number: "#", select: "◇", date: "▭", checkbox: "☑", relation: "↗", json: "{}", unknown: "?" }[
    type
  ];
}

const MONTHS_FR = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Raw cell value → plain text. Drivers hand back JSON/JSONB and array columns as
// objects, which String() would render as "[object Object]".
export function toText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

// Text shown in an editable field: same as toText, but JSON is pretty-printed.
export function toEditableText(value: unknown, column: ColumnMeta): string {
  if (column.logicalType !== "json" || value === undefined || value === null) return toText(value);
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// A DATE column carries no time; everything else (datetime, timestamp…) does.
export function isDateOnlyColumn(column: ColumnMeta): boolean {
  return column.nativeType.trim().toLowerCase() === "date";
}

export function parseDateValue(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const raw = value instanceof Date ? value : String(value);
  const dateOnly = typeof raw === "string" ? DATE_ONLY_RE.exec(raw) : null;
  // "2024-03-01" would parse as UTC midnight and can land on the previous day locally.
  const d = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Columns that store an instant rather than a wall-clock reading: a value sent
// without an offset would be read in the *database's* timezone, which is rarely
// the user's (a UTC container, say).
export function isTimeZoneAwareColumn(column: ColumnMeta): boolean {
  const t = column.nativeType.trim().toLowerCase();
  return t.includes("with time zone") || t === "timestamptz" || t === "timestamp";
}

function localOffset(d: Date): string {
  const minutes = -d.getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  return `${sign}${pad2(Math.floor(Math.abs(minutes) / 60))}:${pad2(Math.abs(minutes) % 60)}`;
}

// Shape a picked date the way drivers accept it, matching nowForColumn below.
export function formatDateForDb(d: Date, column: ColumnMeta): string {
  const day = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  if (isDateOnlyColumn(column)) return day;
  const clock = `${day} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  return isTimeZoneAwareColumn(column) ? `${clock}${localOffset(d)}` : clock;
}

function formatDate(value: unknown, column: ColumnMeta, lang: Lang): string {
  const raw = value instanceof Date ? value : String(value);
  const dateOnlyMatch = typeof raw === "string" ? DATE_ONLY_RE.exec(raw) : null;
  const d = parseDateValue(value);
  if (!d) return toText(value);

  const months = lang === "fr" ? MONTHS_FR : MONTHS_EN;
  const day =
    lang === "fr" ? `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}` : `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  if (dateOnlyMatch || isDateOnlyColumn(column)) return day;

  const seconds = d.getSeconds();
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}${seconds ? `:${pad2(seconds)}` : ""}`;
  return `${day}, ${time}`;
}

export function formatValue(value: unknown, column: ColumnMeta, lang: Lang = "fr"): string {
  if (value === undefined || value === null || value === "") return "";
  if (column.logicalType === "date") return formatDate(value, column, lang);
  if (column.logicalType === "number") {
    const n = Number(value);
    return Number.isNaN(n) ? String(value) : n.toLocaleString(lang === "fr" ? "fr-FR" : "en-US");
  }
  if (column.logicalType === "checkbox") return value ? (lang === "fr" ? "Oui" : "Yes") : lang === "fr" ? "Non" : "No";
  return toText(value);
}

function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) % 360;
  return h;
}

export function toneFor(value: string): { bg: string; fg: string; border: string } {
  const hue = hashHue(value);
  return {
    bg: `oklch(0.95 0.035 ${hue})`,
    fg: `oklch(0.44 0.1 ${hue})`,
    border: `oklch(0.88 0.05 ${hue})`,
  };
}

export function pillStyle(value: string): CSSProperties {
  const t = toneFor(value);
  return {
    display: "inline-block",
    maxWidth: "100%",
    padding: "2px 9px",
    borderRadius: 999,
    fontSize: 12.5,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    background: t.bg,
    color: t.fg,
    border: `1px solid ${t.border}`,
  };
}

export function ddlPreview(tableName: string, columns: ColumnMeta[]): string {
  const lines = columns.map((c) => `  ${c.name} ${c.nativeType}`);
  return `-- ${tableName}\n${lines.join(",\n")}`;
}

// Value for a NOT NULL date column on a brand new row.
export function nowForColumn(column: ColumnMeta): string {
  return formatDateForDb(new Date(), column);
}
