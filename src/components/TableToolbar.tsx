"use client";

import type { ColumnMeta, RowFilter, RowSort } from "@/lib/types";

export type ViewKind = "table" | "board" | "calendar" | "gallery";

const VIEWS: [ViewKind, string][] = [
  ["table", "Table"],
  ["board", "Tableau"],
  ["calendar", "Calendrier"],
  ["gallery", "Galerie"],
];

const OPS: [RowFilter["op"], string][] = [
  ["eq", "est"],
  ["neq", "n'est pas"],
  ["contains", "contient"],
];

interface Props {
  view: ViewKind;
  onSetView: (v: ViewKind) => void;
  columns: ColumnMeta[];
  groupBy: string;
  onSetGroupBy: (col: string) => void;
  filters: RowFilter[];
  onFiltersChange: (f: RowFilter[]) => void;
  sorts: RowSort[];
  onSortsChange: (s: RowSort[]) => void;
  onAddRow: () => void;
}

const smallBtn: React.CSSProperties = {
  flex: "none",
  whiteSpace: "nowrap",
  minHeight: 27,
  padding: "0 9px",
  background: "#fff",
  border: "1px solid #e8e5df",
  borderRadius: 7,
  color: "#4b473f",
  fontSize: 12.5,
  cursor: "pointer",
};

export function TableToolbar({ view, onSetView, columns, groupBy, onSetGroupBy, filters, onFiltersChange, sorts, onSortsChange, onAddRow }: Props) {
  const selectableCols = columns.filter((c) => !c.hidden);
  const groupableCols = columns.filter((c) => c.logicalType === "select" || c.logicalType === "checkbox");

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", rowGap: 8, alignItems: "center", gap: 4, marginTop: 16, borderBottom: "1px solid var(--border)" }}>
        {VIEWS.map(([v, label]) => (
          <button
            key={v}
            onClick={() => onSetView(v)}
            style={{
              padding: "7px 11px",
              marginBottom: -1,
              background: "transparent",
              border: "none",
              borderBottom: `2px solid ${view === v ? "#26241f" : "transparent"}`,
              color: view === v ? "#26241f" : "#8b877e",
              fontWeight: view === v ? 600 : 400,
              fontSize: 13.5,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
        <div style={{ display: "flex", flex: "0 1 auto", minWidth: 0, flexWrap: "wrap", justifyContent: "flex-end", marginLeft: "auto", alignItems: "center", gap: 6, paddingBottom: 6 }}>
          <select value={groupBy} onChange={(e) => onSetGroupBy(e.target.value)} style={{ ...smallBtn, height: 27, padding: "0 6px", cursor: "pointer" }}>
            <option value="">Sans groupe</option>
            {groupableCols.map((c) => (
              <option key={c.name} value={c.name}>
                Grouper par {c.name}
              </option>
            ))}
          </select>
          <button style={smallBtn} onClick={() => onFiltersChange([...filters, { column: selectableCols[0]?.name ?? "", op: "contains", value: "" }])}>
            + Filtre
          </button>
          <button style={smallBtn} onClick={() => onSortsChange([...sorts, { column: selectableCols[0]?.name ?? "", dir: "asc" }])}>
            + Tri
          </button>
          <button
            onClick={onAddRow}
            style={{ flex: "none", whiteSpace: "nowrap", minHeight: 27, padding: "0 10px", background: "var(--accent)", border: "1px solid var(--accent-hover)", borderRadius: 7, color: "#fff", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}
          >
            Nouvelle ligne
          </button>
        </div>
      </div>

      {(filters.length > 0 || sorts.length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7, padding: "12px 0 0" }}>
          {filters.map((f, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, height: 28, padding: "0 4px 0 8px", background: "var(--accent-bg)", border: "1px solid var(--accent-border)", borderRadius: 8, fontSize: 12.5 }}>
              <span style={{ color: "oklch(0.5 0.1 250)", fontWeight: 500 }}>où</span>
              <select
                value={f.column}
                onChange={(e) => onFiltersChange(filters.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)))}
                style={{ border: "none", background: "transparent", cursor: "pointer", color: "#26241f", fontSize: 12.5 }}
              >
                {selectableCols.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={f.op}
                onChange={(e) => onFiltersChange(filters.map((x, j) => (j === i ? { ...x, op: e.target.value as RowFilter["op"] } : x)))}
                style={{ border: "none", background: "transparent", cursor: "pointer", color: "#6f6b62", fontSize: 12.5 }}
              >
                {OPS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <input
                value={f.value}
                onChange={(e) => onFiltersChange(filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                placeholder="valeur"
                style={{ width: 92, border: "none", background: "#fff", borderRadius: 5, padding: "3px 6px", fontSize: 12.5, outline: "none" }}
              />
              <button
                onClick={() => onFiltersChange(filters.filter((_, j) => j !== i))}
                style={{ width: 20, height: 20, display: "grid", placeItems: "center", background: "transparent", border: "none", borderRadius: 5, color: "#9a958b", cursor: "pointer" }}
              >
                ×
              </button>
            </div>
          ))}
          {sorts.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, height: 28, padding: "0 4px 0 8px", background: "#f6f4ef", border: "1px solid #e8e5df", borderRadius: 8, fontSize: 12.5 }}>
              <span style={{ color: "#8b877e", fontWeight: 500 }}>trier</span>
              <select
                value={s.column}
                onChange={(e) => onSortsChange(sorts.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)))}
                style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 12.5 }}
              >
                {selectableCols.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => onSortsChange(sorts.map((x, j) => (j === i ? { ...x, dir: x.dir === "asc" ? "desc" : "asc" } : x)))}
                style={{ padding: "2px 7px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 5, fontSize: 12, color: "#4b473f", cursor: "pointer" }}
              >
                {s.dir === "asc" ? "A → Z" : "Z → A"}
              </button>
              <button
                onClick={() => onSortsChange(sorts.filter((_, j) => j !== i))}
                style={{ width: 20, height: 20, display: "grid", placeItems: "center", background: "transparent", border: "none", borderRadius: 5, color: "#9a958b", cursor: "pointer" }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
