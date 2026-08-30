"use client";

import type { ColumnMeta, Row } from "@/lib/types";
import { formatValue, pillStyle } from "@/lib/client/format";
import { groupRows } from "@/lib/client/group";
import { useLang } from "@/lib/i18n/LanguageProvider";

interface Props {
  columns: ColumnMeta[];
  rows: Row[];
  boardColumn?: ColumnMeta;
  onRowOpen: (row: Row) => void;
  onAddCard: (groupValue: string) => void;
}

export function BoardView({ columns, rows, boardColumn, onRowOpen, onAddCard }: Props) {
  const { t, lang } = useLang();
  if (!boardColumn) {
    return <div style={{ padding: 20, color: "#a8a39a", fontSize: 13 }}>{t("boardView.noGroupColumn")}</div>;
  }
  const groups = groupRows(rows, boardColumn);
  const tagCols = columns.filter((c) => c.logicalType === "select" || c.logicalType === "number").slice(0, 2);
  const titleCol = columns.find((c) => c.logicalType === "text") ?? columns[0];
  const subCol = columns.filter((c) => c !== titleCol)[0];

  return (
    <div data-clarity-mask="true" style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      {groups.map((g) => (
        <div key={g.key} style={{ width: 262, flex: "none", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 2px 4px" }}>
            <span style={pillStyle(g.key)}>{g.key}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#b4afa5" }}>{g.rows.length}</span>
          </div>
          {g.rows.map((row, i) => (
            <div
              key={i}
              onClick={() => onRowOpen(row)}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 7,
                padding: "11px 12px",
                background: "#fff",
                border: "1px solid #eceae4",
                borderRadius: 10,
                cursor: "pointer",
                boxShadow: "var(--shadow-card)",
                transition: "border-color 0.12s ease, box-shadow 0.12s ease, transform 0.12s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#d9d5cd";
                e.currentTarget.style.boxShadow = "0 6px 16px rgba(35,31,24,0.08)";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#eceae4";
                e.currentTarget.style.boxShadow = "var(--shadow-card)";
                e.currentTarget.style.transform = "none";
              }}
            >
              <div style={{ fontWeight: 500 }}>{titleCol ? formatValue(row[titleCol.name], titleCol, lang) || t("detailPanel.untitled") : t("detailPanel.untitled")}</div>
              {subCol && (
                <div style={{ fontSize: 12.5, color: "#8b877e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {formatValue(row[subCol.name], subCol, lang)}
                </div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {tagCols.map((c) =>
                  row[c.name] !== undefined && row[c.name] !== null && row[c.name] !== "" ? (
                    <span key={c.name} style={pillStyle(formatValue(row[c.name], c, lang))}>
                      {formatValue(row[c.name], c, lang)}
                    </span>
                  ) : null
                )}
              </div>
            </div>
          ))}
          <div
            onClick={() => onAddCard(g.key)}
            style={{ padding: "8px 12px", color: "#b4afa5", fontSize: 12.5, cursor: "pointer", borderRadius: 8 }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f4f2ed";
              e.currentTarget.style.color = "#4b473f";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "#b4afa5";
            }}
          >
            + {t("common.add")}
          </div>
        </div>
      ))}
    </div>
  );
}
