"use client";

import { useMemo, useState } from "react";
import { parseCsv } from "@/lib/client/csv";
import type { ColumnMeta, Row } from "@/lib/types";
import { useLang } from "@/lib/i18n/LanguageProvider";

interface Props {
  tableName: string;
  columns: ColumnMeta[];
  onImport: (rows: Row[]) => Promise<void>;
  onClose: () => void;
}

export function CsvImportModal({ tableName, columns, onImport, onClose }: Props) {
  const { t } = useLang();
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    const rows = parseCsv(csvText.trim());
    if (rows.length < 2) return { count: 0, cols: 0, mappedRows: [] as Row[] };
    const headers = rows[0].map((h) => h.trim());
    const mapping = headers.map((h) => columns.find((c) => c.name.toLowerCase() === h.toLowerCase()));
    const mappedRows: Row[] = rows.slice(1).map((line) => {
      const obj: Row = {};
      mapping.forEach((col, i) => {
        if (!col) return;
        const raw = line[i] ?? "";
        if (col.logicalType === "number") obj[col.name] = raw === "" ? null : Number(raw);
        else if (col.logicalType === "checkbox") obj[col.name] = raw.toLowerCase() === "true" || raw === "1";
        else obj[col.name] = raw;
      });
      return obj;
    });
    return { count: rows.length - 1, cols: headers.length, mappedRows };
  }, [csvText, columns]);

  async function handleImport() {
    setError(null);
    if (parsed.mappedRows.length === 0) {
      setError(t("csvImport.nothingToImport"));
      return;
    }
    setImporting(true);
    try {
      await onImport(parsed.mappedRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(35,31,24,0.14)", display: "grid", placeItems: "center", zIndex: 45, animation: "om-fade 0.12s ease" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 620, background: "#fff", border: "1px solid #e5e2db", borderRadius: 13, boxShadow: "var(--shadow-pop)", overflow: "hidden", animation: "om-pop 0.14s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid #f2f0ea" }}>
          <div style={{ fontWeight: 600 }}>{t("csvImport.title")}</div>
          <div style={{ fontSize: 12.5, color: "#a8a39a" }}>{t("csvImport.toTable", { table: tableName })}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ width: 26, height: 26, background: "transparent", border: "none", borderRadius: 6, color: "#8b877e", cursor: "pointer" }}>
            ✕
          </button>
        </div>
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12.5, color: "#8b877e" }}>
            {t("csvImport.hint")}
          </div>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            spellCheck={false}
            style={{ height: 190, resize: "none", border: "1px solid #e8e5df", borderRadius: 9, padding: "10px 12px", fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.7, outline: "none" }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#a8a39a" }}>
              {parsed.count > 0 ? t("csvImport.rowsDetected", { count: parsed.count, cols: parsed.cols }) : t("csvImport.noRows")}
            </div>
            <div style={{ flex: 1 }} />
            {error && <div style={{ fontSize: 12.5, color: "var(--env-prod-fg)" }}>{error}</div>}
            <button onClick={onClose} style={{ padding: "7px 12px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 8, cursor: "pointer", color: "#4b473f" }}>
              {t("common.cancel")}
            </button>
            <button
              onClick={handleImport}
              disabled={importing}
              style={{ padding: "7px 13px", background: "var(--accent)", border: "1px solid var(--accent-hover)", borderRadius: 8, color: "#fff", fontWeight: 500, cursor: "pointer" }}
            >
              {importing ? t("csvImport.importing") : t("csvImport.importAction")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
