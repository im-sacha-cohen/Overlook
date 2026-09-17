"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ColumnMeta } from "@/lib/types";
import { formatDateForDb, formatValue, isDateOnlyColumn, parseDateValue } from "@/lib/client/format";
import { useLang } from "@/lib/i18n/LanguageProvider";

interface Props {
  column: ColumnMeta;
  value: unknown;
  /** Open the calendar as soon as the field mounts (inline cell editing). */
  autoOpen?: boolean;
  onCommit: (value: string | null) => void;
  onClose?: () => void;
}

const fieldStyle: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 6,
  border: "1px solid #e8e5df",
  borderRadius: 6,
  padding: "5px 7px",
  background: "#fff",
  fontSize: 13.5,
  cursor: "pointer",
  textAlign: "left",
  color: "inherit",
};

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

const POPOVER_WIDTH = 252;
// Only used to decide whether to flip before the first measurement.
const POPOVER_HEIGHT = 300;

export function DateField({ column, value, autoOpen, onCommit, onClose }: Props) {
  const { t, lang } = useLang();
  const selected = parseDateValue(value);
  const withTime = !isDateOnlyColumn(column);

  const [open, setOpen] = useState(!!autoOpen);
  const [cursor, setCursor] = useState(() => startOfMonth(selected ?? new Date()));
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // The calendar is rendered in a portal: grid cells clip anything that overflows them.
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const height = popRef.current?.offsetHeight ?? POPOVER_HEIGHT;
    const flipUp = r.bottom + 4 + height > window.innerHeight && r.top - 4 - height > 0;
    setAnchor({
      top: flipUp ? Math.max(8, r.top - 4 - height) : r.bottom + 4,
      left: Math.max(8, Math.min(r.left, window.innerWidth - POPOVER_WIDTH - 8)),
    });
  }, []);

  useEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    place();
    // Keep it stuck to the field while the page moves under it.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  // Clicking away or pressing Escape leaves the field as it was.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!wrapRef.current?.contains(target) && !popRef.current?.contains(target)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    onClose?.();
  }

  function commit(d: Date | null) {
    onCommit(d ? formatDateForDb(d, column) : null);
  }

  function pickDay(day: Date) {
    const next = new Date(day);
    if (withTime && selected) next.setHours(selected.getHours(), selected.getMinutes(), selected.getSeconds(), 0);
    commit(next);
    close();
  }

  function pickTime(hhmm: string) {
    const [h, m] = hhmm.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    const next = new Date(selected ?? new Date());
    next.setHours(h, m, 0, 0);
    commit(next);
  }

  const dayNames = t("calendarView.days").split(",");
  const monthNames = t("calendarView.months").split(",");
  const today = new Date();
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const navBtn: React.CSSProperties = {
    width: 24,
    height: 24,
    display: "grid",
    placeItems: "center",
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: 6,
    color: "#8b877e",
    cursor: "pointer",
    fontSize: 13,
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ ...fieldStyle, borderColor: open ? "oklch(0.7 0.1 250)" : "#e8e5df" }}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selected ? "inherit" : "#b4afa5" }}>
          {selected ? formatValue(value, column, lang) : t("dateField.empty")}
        </span>
        <span style={{ color: "#c2bdb3", fontSize: 12 }}>▭</span>
      </button>

      {open && anchor !== null && createPortal(
        <div
          ref={popRef}
          data-clarity-mask="true"
          style={{
            position: "fixed",
            top: anchor.top,
            left: anchor.left,
            zIndex: 80,
            width: POPOVER_WIDTH,
            padding: 10,
            background: "#fff",
            border: "1px solid #e5e2db",
            borderRadius: 10,
            boxShadow: "var(--shadow-pop)",
            cursor: "default",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
            <button type="button" onClick={() => setCursor(new Date(year, month - 1, 1))} style={navBtn} aria-label={t("dateField.previousMonth")}>
              ‹
            </button>
            <div style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 500 }}>
              {monthNames[month]} {year}
            </div>
            <button type="button" onClick={() => setCursor(new Date(year, month + 1, 1))} style={navBtn} aria-label={t("dateField.nextMonth")}>
              ›
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {dayNames.map((d) => (
              <div key={d} style={{ textAlign: "center", fontSize: 10.5, color: "#b4afa5", padding: "2px 0" }}>
                {d}
              </div>
            ))}
            {cells.map((day, i) => {
              if (!day) return <div key={i} />;
              const isSelected = !!selected && sameDay(day, selected);
              const isToday = sameDay(day, today);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => pickDay(day)}
                  style={{
                    height: 28,
                    borderRadius: 6,
                    fontSize: 12.5,
                    cursor: "pointer",
                    background: isSelected ? "var(--accent)" : "transparent",
                    color: isSelected ? "#fff" : "#4b473f",
                    border: `1px solid ${isSelected ? "var(--accent-hover)" : isToday ? "var(--accent-border)" : "transparent"}`,
                    fontWeight: isToday && !isSelected ? 600 : 400,
                  }}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          {withTime && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              <span style={{ fontSize: 12, color: "#8b877e" }}>{t("dateField.time")}</span>
              <input
                type="time"
                value={selected ? `${pad2(selected.getHours())}:${pad2(selected.getMinutes())}` : ""}
                onChange={(e) => pickTime(e.target.value)}
                style={{ flex: 1, border: "1px solid #e8e5df", borderRadius: 6, padding: "4px 6px", fontSize: 13, background: "#fff" }}
              />
            </div>
          )}

          <div style={{ display: "flex", gap: 6, marginTop: 10, borderTop: "1px solid #f2f0ea", paddingTop: 8 }}>
            <button
              type="button"
              onClick={() => pickDay(new Date())}
              style={{ flex: 1, padding: "5px 8px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 7, fontSize: 12.5, color: "#4b473f", cursor: "pointer" }}
            >
              {t("dateField.today")}
            </button>
            <button
              type="button"
              onClick={() => {
                commit(null);
                close();
              }}
              style={{ flex: 1, padding: "5px 8px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 7, fontSize: 12.5, color: "#8b877e", cursor: "pointer" }}
            >
              {t("dateField.clear")}
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
