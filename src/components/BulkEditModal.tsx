"use client";

import { useState } from "react";
import type { ColumnMeta } from "@/lib/types";
import { useLang } from "@/lib/i18n/LanguageProvider";

interface Props {
  count: number;
  columns: ColumnMeta[];
  onApply: (col: ColumnMeta, value: unknown) => Promise<void>;
  onClose: () => void;
}

export function BulkEditModal({ count, columns, onApply, onClose }: Props) {
  const { t } = useLang();
  const editable = columns.filter((c) => !c.isPrimaryKey && c.logicalType !== "relation");
  const [colName, setColName] = useState(editable[0]?.name ?? "");
  const [value, setValue] = useState("");
  const [checked, setChecked] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const col = editable.find((c) => c.name === colName);

  async function handleApply() {
    if (!col) return;
    setError(null);
    setRunning(true);
    try {
      let v: unknown = value;
      if (col.logicalType === "number") v = value === "" ? null : Number(value);
      else if (col.logicalType === "checkbox") v = checked;
      await onApply(col, v);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(35,31,24,0.14)", display: "grid", placeItems: "center", zIndex: 60, animation: "om-fade 0.12s ease" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 420, background: "#fff", border: "1px solid #e5e2db", borderRadius: 13, boxShadow: "var(--shadow-pop)", overflow: "hidden", animation: "om-pop 0.14s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid #f2f0ea" }}>
          <div style={{ fontWeight: 600 }}>{t("bulkEdit.title", { count })}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ width: 26, height: 26, background: "transparent", border: "none", borderRadius: 6, color: "#8b877e", cursor: "pointer" }}>
            ✕
          </button>
        </div>
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: "#8b877e", marginBottom: 4, display: "block" }}>{t("bulkEdit.column")}</label>
            <select
              value={colName}
              onChange={(e) => setColName(e.target.value)}
              style={{ width: "100%", border: "1px solid #e8e5df", borderRadius: 8, padding: "8px 10px", background: "#fff" }}
            >
              {editable.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#8b877e", marginBottom: 4, display: "block" }}>{t("bulkEdit.newValue")}</label>
            {col?.logicalType === "checkbox" ? (
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
                <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                {checked ? t("common.yes") : t("common.no")}
              </label>
            ) : col?.logicalType === "select" && col.options ? (
              <select value={value} onChange={(e) => setValue(e.target.value)} style={{ width: "100%", border: "1px solid #e8e5df", borderRadius: 8, padding: "8px 10px", background: "#fff" }}>
                <option value="" />
                {col.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                type={col?.logicalType === "number" ? "number" : "text"}
                style={{ width: "100%", border: "1px solid #e8e5df", borderRadius: 8, padding: "8px 10px", outline: "none" }}
              />
            )}
          </div>
          {error && <div style={{ fontSize: 12.5, color: "var(--env-prod-fg)" }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ padding: "7px 12px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 8, cursor: "pointer", color: "#4b473f" }}>
              {t("common.cancel")}
            </button>
            <button
              onClick={handleApply}
              disabled={running || !col}
              style={{ padding: "7px 13px", background: "var(--accent)", border: "1px solid var(--accent-hover)", borderRadius: 8, color: "#fff", fontWeight: 500, cursor: "pointer" }}
            >
              {running ? t("bulkEdit.applying") : t("bulkEdit.apply")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
