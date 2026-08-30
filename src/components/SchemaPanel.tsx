"use client";

import { useState } from "react";
import { iconFor, ddlPreview } from "@/lib/client/format";
import type { LogicalType, TableMeta } from "@/lib/types";
import { useLang } from "@/lib/i18n/LanguageProvider";

interface Props {
  table: TableMeta;
  locked: boolean;
  onUnlock: () => void;
  onRenameColumn: (oldName: string, newName: string) => void;
  onChangeColumnType: (name: string, type: LogicalType) => void;
  onToggleHidden: (name: string) => void;
  onAddColumn: (name: string, type: LogicalType) => void;
  onDropColumn: (name: string) => void;
  onClose: () => void;
}

export function SchemaPanel({ table, locked, onUnlock, onRenameColumn, onChangeColumnType, onToggleHidden, onAddColumn, onDropColumn, onClose }: Props) {
  const { t } = useLang();
  const [newColName, setNewColName] = useState("");
  const [newColType, setNewColType] = useState<LogicalType>("text");
  const TYPE_OPTIONS: [LogicalType, string][] = [
    ["text", t("schemaPanel.typeText")],
    ["number", t("schemaPanel.typeNumber")],
    ["select", t("schemaPanel.typeSelect")],
    ["date", t("schemaPanel.typeDate")],
    ["checkbox", t("schemaPanel.typeCheckbox")],
    ["json", t("schemaPanel.typeJson")],
  ];

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(35,31,24,0.14)", display: "flex", justifyContent: "flex-end", zIndex: 45, animation: "om-fade 0.12s ease" }}
    >
      <div onClick={(e) => e.stopPropagation()} className="om-sb" style={{ width: 520, background: "#fff", borderLeft: "1px solid #e5e2db", overflowY: "auto", animation: "om-pop 0.16s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "15px 20px", borderBottom: "1px solid #f2f0ea", position: "sticky", top: 0, background: "#fff" }}>
          <div style={{ fontWeight: 600 }}>{t("schemaPanel.title")}</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#a8a39a" }}>{table.name}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ width: 26, height: 26, background: "transparent", border: "none", borderRadius: 6, color: "#8b877e", cursor: "pointer" }}>
            ✕
          </button>
        </div>

        {locked && (
          <div style={{ margin: "16px 20px 0", padding: "10px 12px", background: "var(--env-prod-bg)", border: "1px solid var(--env-prod-border)", borderRadius: 9, fontSize: 12.5, color: "var(--env-prod-fg)", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1 }}>{t("schemaPanel.locked")}</span>
            <button
              onClick={onUnlock}
              style={{ padding: "5px 10px", background: "var(--env-prod-strong)", border: "none", borderRadius: 6, color: "#fff", fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {t("schemaPanel.unlock")}
            </button>
          </div>
        )}

        <div style={{ padding: "18px 20px 40px", display: "flex", flexDirection: "column", gap: 8, opacity: locked ? 0.55 : 1, pointerEvents: locked ? "none" : "auto" }}>
          {table.columns.map((c) => (
            <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "1px solid #f0eeE9", borderRadius: 9 }}>
              <span style={{ color: "#c2bdb3", fontFamily: "var(--font-mono)", fontSize: 11 }}>{iconFor(c.logicalType)}</span>
              <input
                defaultValue={c.name}
                onBlur={(e) => {
                  if (e.target.value && e.target.value !== c.name) onRenameColumn(c.name, e.target.value);
                }}
                disabled={c.isPrimaryKey}
                style={{ flex: 1, minWidth: 0, border: "1px solid transparent", borderRadius: 6, padding: "4px 6px", background: "transparent", outline: "none" }}
              />
              <select
                value={c.logicalType === "relation" ? "relation" : TYPE_OPTIONS.some(([v]) => v === c.logicalType) ? c.logicalType : "text"}
                onChange={(e) => onChangeColumnType(c.name, e.target.value as LogicalType)}
                disabled={c.isPrimaryKey || c.logicalType === "relation"}
                style={{ border: "1px solid #eceae4", borderRadius: 6, padding: "4px 6px", background: "#fff", fontSize: 12.5, cursor: "pointer" }}
              >
                {c.logicalType === "relation" && <option value="relation">{t("schemaPanel.relation")}</option>}
                {TYPE_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#bdb8ae", width: 90, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.nativeType}
              </span>
              <button
                onClick={() => onToggleHidden(c.name)}
                style={{ padding: "3px 8px", background: "#fff", border: "1px solid #eceae4", borderRadius: 6, fontSize: 12, color: "#8b877e", cursor: "pointer" }}
              >
                {c.hidden ? t("schemaPanel.hidden") : t("schemaPanel.visible")}
              </button>
              {!c.isPrimaryKey && (
                <button
                  onClick={() => {
                    if (window.confirm(t("schemaPanel.confirmDropColumn", { name: c.name }))) onDropColumn(c.name);
                  }}
                  style={{ padding: "3px 8px", background: "#fff", border: "1px solid #eceae4", borderRadius: 6, fontSize: 12, color: "var(--env-prod-fg)", cursor: "pointer" }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}

          <div style={{ display: "flex", gap: 8, paddingTop: 6 }}>
            <input
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              placeholder={t("schemaPanel.namePlaceholder")}
              style={{ flex: 1, border: "1px solid #e8e5df", borderRadius: 8, padding: "7px 9px", outline: "none" }}
            />
            <select value={newColType} onChange={(e) => setNewColType(e.target.value as LogicalType)} style={{ border: "1px solid #e8e5df", borderRadius: 8, padding: "0 8px", background: "#fff", cursor: "pointer" }}>
              {TYPE_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                if (!newColName.trim()) return;
                onAddColumn(newColName.trim(), newColType);
                setNewColName("");
              }}
              style={{ padding: "7px 12px", background: "var(--accent)", border: "1px solid var(--accent-hover)", borderRadius: 8, color: "#fff", fontWeight: 500, cursor: "pointer" }}
            >
              {t("schemaPanel.add")}
            </button>
          </div>

          <div style={{ marginTop: 18, padding: "12px 14px", background: "#f7f6f2", borderRadius: 9, fontFamily: "var(--font-mono)", fontSize: 12, color: "#6f6b62", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            {ddlPreview(table.name, table.columns)}
          </div>
        </div>
      </div>
    </div>
  );
}
