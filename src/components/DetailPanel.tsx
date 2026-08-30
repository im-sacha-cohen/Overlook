"use client";

import { useRef, useState } from "react";
import type { ColumnMeta, Row } from "@/lib/types";
import { iconFor } from "@/lib/client/format";
import type { HistoryEntry } from "@/lib/client/history";
import { useLang } from "@/lib/i18n/LanguageProvider";

interface Props {
  row: Row;
  columns: ColumnMeta[];
  pkColumn: string | null;
  tableName: string;
  onFieldCommit: (col: ColumnMeta, value: unknown) => void;
  onClose: () => void;
  onDelete: () => void;
  recentHistory: HistoryEntry[];
}

const WIDTH_KEY = "overlook:detailPanelWidth";
const DEFAULT_WIDTH = 392;
const MIN_WIDTH = 300;
const MAX_WIDTH = 760;

function loadWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    const n = raw ? Number(raw) : DEFAULT_WIDTH;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function saveWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    // best-effort only
  }
}

const fieldInputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #e8e5df",
  borderRadius: 6,
  padding: "5px 7px",
  background: "#fdfcfb",
  outline: "none",
  fontSize: 13.5,
  transition: "border-color 0.1s ease, background 0.1s ease",
};

export function DetailPanel({ row, columns, pkColumn, tableName, onFieldCommit, onClose, onDelete, recentHistory }: Props) {
  const { t } = useLang();
  const titleCol = columns.find((c) => c.logicalType === "text") ?? columns[0];
  const title = titleCol ? String(row[titleCol.name] ?? t("detailPanel.untitled")) : t("detailPanel.untitled");

  const [width, setWidth] = useState(loadWidth);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    drag.current = { startX: e.clientX, startWidth: width };
    let active = true;
    const onMove = (ev: MouseEvent) => {
      if (!active || !drag.current) return;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, drag.current.startWidth - (ev.clientX - drag.current.startX)));
      setWidth(next);
    };
    const onUp = () => {
      active = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setWidth((w) => {
        saveWidth(w);
        return w;
      });
      drag.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return (
    <div className="om-sb" data-clarity-mask="true" style={{ position: "relative", width, flex: "none", borderLeft: "1px solid var(--border)", background: "#fff", overflowY: "auto", animation: "om-fade 0.14s ease" }}>
      <div
        onMouseDown={startResize}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        style={{ position: "absolute", left: -3, top: 0, bottom: 0, width: 6, cursor: "col-resize", zIndex: 5, background: "transparent", transition: "background 0.1s ease" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid #f2f0ea", position: "sticky", top: 0, background: "#fff", zIndex: 1 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#a8a39a" }}>
          {tableName}.{pkColumn ? String(row[pkColumn]) : "?"}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={onDelete}
          style={{ padding: "4px 9px", background: "#fff", border: "1px solid #eceae4", borderRadius: 7, fontSize: 12.5, color: "#8b877e", cursor: "pointer" }}
        >
          {t("detailPanel.delete")}
        </button>
        <button onClick={onClose} style={{ width: 26, height: 26, background: "transparent", border: "none", borderRadius: 6, color: "#8b877e", cursor: "pointer" }}>
          ✕
        </button>
      </div>
      <div style={{ padding: "22px 20px 40px", display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em", paddingBottom: 14, overflowWrap: "anywhere" }}>{title}</div>
        {columns.map((c) => (
          <div key={c.name} style={{ display: "grid", gridTemplateColumns: "132px 1fr", gap: 10, alignItems: "center", minHeight: 34 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#8b877e", overflow: "hidden" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#c2bdb3" }}>{iconFor(c.logicalType)}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
            </div>
            <div>
              {c.isPrimaryKey ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 7px", borderRadius: 6, background: "#f6f4ef", fontFamily: "var(--font-mono)", fontSize: 12.5, color: "#6f6b62" }}>
                  {String(row[c.name] ?? "")}
                  <span style={{ fontSize: 10.5, color: "#bdb8ae" }}>{t("detailPanel.primaryKey")}</span>
                </span>
              ) : c.logicalType === "checkbox" ? (
                <span
                  onClick={() => onFieldCommit(c, !row[c.name])}
                  style={{
                    width: 18,
                    height: 18,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontSize: 11,
                    color: "#fff",
                    background: row[c.name] ? "var(--accent)" : "#fff",
                    border: `1px solid ${row[c.name] ? "var(--accent-hover)" : "#dcd9d2"}`,
                  }}
                >
                  {row[c.name] ? "✓" : ""}
                </span>
              ) : c.logicalType === "select" ? (
                <select
                  value={String(row[c.name] ?? "")}
                  onChange={(e) => onFieldCommit(c, e.target.value)}
                  style={{ border: "1px solid #eceae4", borderRadius: 6, padding: "4px 6px", background: "#fff", fontSize: 13, cursor: "pointer" }}
                >
                  <option value="" />
                  {(c.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  key={String(row[c.name])}
                  defaultValue={row[c.name] === undefined || row[c.name] === null ? "" : String(row[c.name])}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "#e8e5df";
                    if (e.target.value !== String(row[c.name] ?? "")) onFieldCommit(c, e.target.value);
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "oklch(0.7 0.1 250)")}
                  style={fieldInputStyle}
                />
              )}
            </div>
          </div>
        ))}
        <div style={{ height: 26 }} />
        <div style={{ borderTop: "1px solid #f2f0ea", paddingTop: 16, fontSize: 12.5, color: "#a8a39a" }}>{t("detailPanel.recentChanges")}</div>
        {recentHistory.length === 0 && <div style={{ padding: "8px 0", fontSize: 12.5, color: "#c2bdb3" }}>{t("detailPanel.noneYet")}</div>}
        {recentHistory.map((l, i) => (
          <div key={i} style={{ display: "flex", gap: 10, padding: "6px 0", fontSize: 12.5, color: "#6f6b62" }}>
            <span style={{ fontFamily: "var(--font-mono)", color: "#bdb8ae" }}>{l.time}</span>
            <span>{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
