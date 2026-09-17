"use client";

import { useState } from "react";
import type { TableMeta } from "@/lib/types";
import { useLang } from "@/lib/i18n/LanguageProvider";

export interface ExportChoice {
  format: "sql" | "ndjson" | "csv";
  /** Only the current table, with the view's filters, search and sort. */
  view?: boolean;
  includeStructure: boolean;
  includeData: boolean;
  tables: string[];
}

interface Props {
  connectionName: string;
  tables: TableMeta[];
  initialSelected: string[];
  /** Opened from a table view: export that table as the view shows it. */
  view?: { table: string; rowCount: number; filtered: boolean };
  onExport: (choice: ExportChoice) => void;
  onClose: () => void;
}

export function ExportModal({ connectionName, tables, initialSelected, view, onExport, onClose }: Props) {
  const { t, lang } = useLang();
  const [format, setFormat] = useState<ExportChoice["format"]>(view ? "csv" : "sql");
  const [includeStructure, setIncludeStructure] = useState(true);
  const [includeData, setIncludeData] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialSelected.length > 0 ? initialSelected : tables.map((t) => t.name))
  );
  const [error, setError] = useState<string | null>(null);

  const totalRows = view ? view.rowCount : tables.filter((t) => selected.has(t.name)).reduce((sum, t) => sum + t.rowCount, 0);
  // A CSV file holds one table.
  const csvAllowed = !!view || selected.size === 1;

  function toggleTable(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === tables.length ? new Set() : new Set(tables.map((t) => t.name))));
  }

  function handleSubmit() {
    setError(null);
    if (view) return onExport({ format, includeStructure: format !== "csv" && includeStructure, includeData: true, tables: [view.table], view: true });
    if (format === "csv" && !csvAllowed) return setError(t("export.csvOneTable"));
    if (format !== "csv" && !includeStructure && !includeData) return setError(t("export.needStructureOrData"));
    if (selected.size === 0) return setError(t("export.needTable"));
    onExport({ format, includeStructure, includeData, tables: [...selected] });
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(35,31,24,0.14)", display: "grid", placeItems: "center", zIndex: 60, animation: "om-fade 0.12s ease" }}>
      <div onClick={(e) => e.stopPropagation()} className="om-sb" style={{ width: 460, maxHeight: "84vh", overflowY: "auto", background: "#fff", border: "1px solid #e5e2db", borderRadius: 13, boxShadow: "var(--shadow-pop)", animation: "om-pop 0.14s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid #f2f0ea" }}>
          <div style={{ fontWeight: 600 }}>{view ? t("export.viewTitle", { table: view.table }) : t("export.title")}</div>
          <div style={{ fontSize: 12.5, color: "#a8a39a" }}>{connectionName}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ width: 26, height: 26, background: "transparent", border: "none", borderRadius: 6, color: "#8b877e", cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: "#8b877e", marginBottom: 6 }}>{t("export.format")}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <FormatButton label="CSV (.csv)" active={format === "csv"} disabled={!csvAllowed} onClick={() => setFormat("csv")} />
              <FormatButton label="SQL (.sql)" active={format === "sql"} onClick={() => setFormat("sql")} />
              <FormatButton label="NDJSON (.ndjson)" active={format === "ndjson"} onClick={() => setFormat("ndjson")} />
            </div>
            {!csvAllowed && <div style={{ fontSize: 11.5, color: "#a8a39a", marginTop: 5 }}>{t("export.csvOneTable")}</div>}
          </div>

          {view && (
            <div style={{ padding: "9px 11px", borderRadius: 8, background: "var(--accent-bg)", border: "1px solid var(--accent-border)", fontSize: 12.5, color: "#4b473f" }}>
              {view.filtered ? t("export.viewFiltered") : t("export.viewAll")}
            </div>
          )}

          {format !== "csv" && (
          <div>
            <div style={{ fontSize: 12, color: "#8b877e", marginBottom: 6 }}>{t("export.content")}</div>
            <div style={{ display: "flex", gap: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13 }}>
                <input type="checkbox" checked={includeStructure} onChange={(e) => setIncludeStructure(e.target.checked)} />
                {t("export.structure")}
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13 }}>
                <input type="checkbox" checked={includeData} onChange={(e) => setIncludeData(e.target.checked)} />
                {t("export.data")}
              </label>
            </div>
          </div>
          )}

          {!view && (
          <div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 12, color: "#8b877e" }}>{t("export.tables", { selected: selected.size, total: tables.length })}</div>
              <div style={{ flex: 1 }} />
              <button onClick={toggleAll} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 12 }}>
                {selected.size === tables.length ? t("export.deselectAll") : t("export.selectAll")}
              </button>
            </div>
            <div className="om-sb" style={{ maxHeight: 180, overflowY: "auto", border: "1px solid #f0eeE9", borderRadius: 8, padding: 6 }}>
              {tables.map((t) => (
                <label key={t.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={selected.has(t.name)} onChange={() => toggleTable(t.name)} />
                  <span style={{ flex: 1 }}>{t.name}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#b4afa5" }}>{t.rowCount}</span>
                </label>
              ))}
            </div>
          </div>
          )}

          <div style={{ fontSize: 12, color: "#a8a39a" }}>
            {includeData || format === "csv" || view ? t("export.estimateRows", { count: totalRows.toLocaleString(lang === "fr" ? "fr-FR" : "en-US") }) : t("export.structureOnly")}
          </div>

          {error && (
            <div style={{ padding: "8px 10px", borderRadius: 8, fontSize: 12.5, background: "var(--env-prod-bg)", color: "var(--env-prod-fg)", border: "1px solid var(--env-prod-border)" }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ padding: "7px 12px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 8, cursor: "pointer", color: "#4b473f" }}>
              {t("common.cancel")}
            </button>
            <button
              onClick={handleSubmit}
              style={{ padding: "7px 13px", background: "var(--accent)", border: "1px solid var(--accent-hover)", borderRadius: 8, color: "#fff", fontWeight: 500, cursor: "pointer" }}
            >
              {t("export.submit")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FormatButton({ label, active, disabled, onClick }: { label: string; active: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        padding: "7px 10px",
        borderRadius: 8,
        border: `1px solid ${active ? "var(--accent-hover)" : "#e8e5df"}`,
        background: active ? "var(--accent-bg)" : "#fff",
        color: active ? "oklch(0.5 0.1 250)" : "#4b473f",
        fontSize: 12.5,
        fontWeight: active ? 500 : 400,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {label}
    </button>
  );
}
