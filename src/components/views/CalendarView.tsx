"use client";

import { useState } from "react";
import type { ColumnMeta, Row } from "@/lib/types";
import { pillStyle } from "@/lib/client/format";
import { useLang } from "@/lib/i18n/LanguageProvider";

interface Props {
  rows: Row[];
  dateColumn?: ColumnMeta;
  titleColumn?: ColumnMeta;
  tagColumn?: ColumnMeta;
  onRowOpen: (row: Row) => void;
}

export function CalendarView({ rows, dateColumn, titleColumn, tagColumn, onRowOpen }: Props) {
  const { t } = useLang();
  const DAY_NAMES = t("calendarView.days").split(",");
  const MONTH_NAMES = t("calendarView.months").split(",");
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  if (!dateColumn) {
    return <div style={{ padding: 20, color: "#a8a39a", fontSize: 13 }}>{t("calendarView.noDateColumn")}</div>;
  }

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayIso = new Date().toISOString().slice(0, 10);

  const itemsByDay = new Map<string, Row[]>();
  rows.forEach((r) => {
    const v = r[dateColumn.name];
    if (!v) return;
    const iso = String(v).slice(0, 10);
    const list = itemsByDay.get(iso) ?? [];
    list.push(r);
    itemsByDay.set(iso, list);
  });

  const weeks: { num: string; iso: string; inMonth: boolean; items: Row[] }[][] = [];
  for (let w = 0; w < 6; w++) {
    const days: { num: string; iso: string; inMonth: boolean; items: Row[] }[] = [];
    for (let d = 0; d < 7; d++) {
      const n = w * 7 + d - startOffset + 1;
      const inMonth = n >= 1 && n <= daysInMonth;
      const dateObj = new Date(year, month, Math.max(1, Math.min(n, daysInMonth)));
      const iso = inMonth ? dateObj.toISOString().slice(0, 10) : "";
      days.push({ num: inMonth ? String(n) : "", iso, inMonth, items: inMonth ? itemsByDay.get(iso) ?? [] : [] });
    }
    weeks.push(days);
  }
  while (weeks.length > 0 && weeks[weeks.length - 1].every((d) => !d.inMonth)) weeks.pop();

  return (
    <div data-clarity-mask="true" style={{ border: "1px solid #eceae4", borderRadius: 11, overflow: "hidden", background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: "1px solid #f0eeE9" }}>
        <button
          onClick={() => setCursor(new Date(year, month - 1, 1))}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "#8b877e", fontSize: 14, padding: "2px 6px" }}
        >
          ‹
        </button>
        <div style={{ fontWeight: 600 }}>
          {MONTH_NAMES[month]} {year}
        </div>
        <button
          onClick={() => setCursor(new Date(year, month + 1, 1))}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "#8b877e", fontSize: 14, padding: "2px 6px" }}
        >
          ›
        </button>
        <div style={{ fontSize: 12.5, color: "#a8a39a" }}>{t("calendarView.by", { column: dateColumn.name })}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid #f0eeE9" }}>
        {DAY_NAMES.map((d) => (
          <div key={d} style={{ padding: "7px 10px", fontSize: 11.5, color: "#a8a39a" }}>
            {d}
          </div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
          {week.map((day, di) => (
            <div
              key={di}
              style={{
                minHeight: 92,
                padding: "6px 7px",
                borderRight: "1px solid #f4f2ed",
                borderBottom: "1px solid #f4f2ed",
                background: day.inMonth ? "#fff" : "#fcfbf9",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: day.iso === todayIso ? "var(--accent)" : "#b4afa5",
                  fontWeight: day.iso === todayIso ? 600 : 400,
                }}
              >
                {day.num}
              </div>
              {day.items.map((row, i) => {
                const label = titleColumn ? String(row[titleColumn.name] ?? "") : String(row[Object.keys(row)[0]] ?? "");
                const tagVal = tagColumn ? row[tagColumn.name] : undefined;
                return (
                  <div
                    key={i}
                    onClick={() => onRowOpen(row)}
                    style={{
                      marginTop: 3,
                      padding: "2px 6px",
                      borderRadius: 5,
                      fontSize: 11.5,
                      cursor: "pointer",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      display: "block",
                      ...pillStyle(String(tagVal ?? label)),
                    }}
                  >
                    {label}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
