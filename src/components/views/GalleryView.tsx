"use client";

import type { ColumnMeta, Row } from "@/lib/types";
import { formatValue, pillStyle } from "@/lib/client/format";
import { useLang } from "@/lib/i18n/LanguageProvider";

interface Props {
  columns: ColumnMeta[];
  rows: Row[];
  onRowOpen: (row: Row) => void;
}

export function GalleryView({ columns, rows, onRowOpen }: Props) {
  const { t, lang } = useLang();
  const titleCol = columns.find((c) => c.logicalType === "text") ?? columns[0];
  const subCol = columns.filter((c) => c !== titleCol)[0];
  const tagCols = columns.filter((c) => c.logicalType === "select").slice(0, 2);

  return (
    <div data-clarity-mask="true" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(232px, 1fr))", gap: 14 }}>
      {rows.map((row, i) => (
        <div
          key={i}
          onClick={() => onRowOpen(row)}
          style={{
            display: "flex",
            flexDirection: "column",
            background: "#fff",
            border: "1px solid #eceae4",
            borderRadius: 11,
            overflow: "hidden",
            cursor: "pointer",
            transition: "border-color 0.12s ease, box-shadow 0.12s ease, transform 0.12s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#d9d5cd";
            e.currentTarget.style.boxShadow = "0 6px 16px rgba(35,31,24,0.06)";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "#eceae4";
            e.currentTarget.style.boxShadow = "none";
            e.currentTarget.style.transform = "none";
          }}
        >
          <div
            style={{
              height: 92,
              background: "repeating-linear-gradient(135deg, #f6f4ef 0 8px, #f1efe9 8px 16px)",
              display: "grid",
              placeItems: "center",
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "#b4afa5",
            }}
          >
            {t("galleryView.visual")}
          </div>
          <div style={{ padding: "11px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ fontWeight: 500 }}>{titleCol ? formatValue(row[titleCol.name], titleCol, lang) || t("detailPanel.untitled") : t("detailPanel.untitled")}</div>
            {subCol && <div style={{ fontSize: 12.5, color: "#8b877e" }}>{formatValue(row[subCol.name], subCol, lang)}</div>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {tagCols.map((c) =>
                row[c.name] ? (
                  <span key={c.name} style={pillStyle(String(row[c.name]))}>
                    {String(row[c.name])}
                  </span>
                ) : null
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
