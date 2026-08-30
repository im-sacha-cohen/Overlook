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

export function formatValue(value: unknown, column: ColumnMeta, lang: Lang = "fr"): string {
  if (value === undefined || value === null || value === "") return "";
  if (column.logicalType === "date") {
    const d = new Date(String(value));
    if (!Number.isNaN(d.getTime())) {
      const months = lang === "fr" ? MONTHS_FR : MONTHS_EN;
      return lang === "fr"
        ? `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
        : `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    }
    return String(value);
  }
  if (column.logicalType === "number") {
    const n = Number(value);
    return Number.isNaN(n) ? String(value) : n.toLocaleString(lang === "fr" ? "fr-FR" : "en-US");
  }
  if (column.logicalType === "checkbox") return value ? (lang === "fr" ? "Oui" : "Yes") : lang === "fr" ? "Non" : "No";
  if (column.logicalType === "json") return typeof value === "string" ? value : JSON.stringify(value);
  return String(value);
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
