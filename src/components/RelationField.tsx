"use client";

import { useEffect, useRef, useState } from "react";
import type { ColumnMeta, Row } from "@/lib/types";
import { useLang } from "@/lib/i18n/LanguageProvider";

export const fieldInputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #e8e5df",
  borderRadius: 6,
  padding: "5px 7px",
  background: "#fdfcfb",
  outline: "none",
  fontSize: 13.5,
  transition: "border-color 0.1s ease, background 0.1s ease",
};

export function RelationField({
  col,
  value,
  onCommit,
  onSearch,
  getLabel,
  autoOpen,
  onClose,
}: {
  col: ColumnMeta;
  value: unknown;
  onCommit: (value: unknown) => void;
  onSearch: (col: ColumnMeta, query: string) => Promise<Row[]>;
  getLabel: (col: ColumnMeta, row: Row) => string;
  autoOpen?: boolean;
  onClose?: () => void;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(!!autoOpen);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);
  const refCol = col.references?.column;
  const hasValue = value !== null && value !== undefined && value !== "";

  useEffect(() => {
    if (!open) return;
    const id = ++reqId.current;
    setLoading(true);
    const timer = setTimeout(() => {
      onSearch(col, query).then((rows) => {
        if (reqId.current !== id) return;
        setResults(rows);
        setLoading(false);
        setActiveIndex(0);
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [open, query, col, onSearch]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
        onClose?.();
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open, onClose]);

  function select(row: Row) {
    onCommit(refCol ? row[refCol] : null);
    setOpen(false);
    setQuery("");
  }

  function clear() {
    onCommit(null);
    setOpen(false);
    setQuery("");
  }

  function cancel() {
    setOpen(false);
    setQuery("");
    onClose?.();
  }

  return (
    <div ref={boxRef} style={{ position: "relative", width: "100%" }}>
      {open ? (
        <>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={hasValue ? String(value) : ""}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (results[activeIndex]) select(results[activeIndex]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            style={{ ...fieldInputStyle, borderColor: "oklch(0.7 0.1 250)" }}
          />
          <div
            className="om-sb"
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              marginTop: 4,
              maxHeight: 220,
              overflowY: "auto",
              background: "#fff",
              border: "1px solid #e5e2db",
              borderRadius: 8,
              boxShadow: "var(--shadow-pop)",
              zIndex: 30,
              padding: 4,
              animation: "om-fade 0.1s ease",
            }}
          >
            {loading ? (
              <div style={{ padding: "6px 8px", fontSize: 12.5, color: "#a8a39a" }}>{t("detailPanel.relationSearching")}</div>
            ) : results.length === 0 ? (
              <div style={{ padding: "6px 8px", fontSize: 12.5, color: "#a8a39a" }}>{t("detailPanel.relationNoResults")}</div>
            ) : (
              results.map((r, i) => (
                <div
                  key={String(refCol ? r[refCol] : i)}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(r);
                  }}
                  style={{
                    padding: "6px 8px",
                    borderRadius: 5,
                    fontSize: 13,
                    cursor: "pointer",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    background: i === activeIndex ? "var(--accent)" : "transparent",
                    color: i === activeIndex ? "#fff" : "inherit",
                  }}
                >
                  {getLabel(col, r)}
                </div>
              ))
            )}
            {hasValue && (
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  clear();
                }}
                style={{ padding: "6px 8px", borderRadius: 5, fontSize: 12.5, color: "#a8a39a", cursor: "pointer", borderTop: "1px solid #f2f0ea", marginTop: 2 }}
              >
                {t("detailPanel.relationClear")}
              </div>
            )}
          </div>
        </>
      ) : (
        <div
          onClick={() => setOpen(true)}
          style={{ ...fieldInputStyle, cursor: "pointer", display: "flex", alignItems: "center" }}
        >
          {hasValue ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%", padding: "2px 7px 2px 5px", background: "#f6f4ef", border: "1px solid #e8e5df", borderRadius: 6, fontSize: 12.5, overflow: "hidden" }}>
              <span style={{ color: "#b4afa5", fontFamily: "var(--font-mono)", fontSize: 10 }}>↗</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(value)}</span>
            </span>
          ) : (
            <span style={{ color: "#c2bdb3" }}>{t("detailPanel.relationEmpty")}</span>
          )}
        </div>
      )}
    </div>
  );
}
