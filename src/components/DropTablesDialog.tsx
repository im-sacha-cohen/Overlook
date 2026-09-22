"use client";

import { useState } from "react";
import type { Engine } from "@/lib/types";
import { useLang } from "@/lib/i18n/LanguageProvider";
import { WritePreviewBox } from "./WritePreviewBox";

interface Props {
  /** Drop the tables, or only empty them (rows go, the tables stay). */
  mode: "drop" | "empty";
  names: string[];
  engine: Engine;
  connectionId: string;
  onConfirm: (options: { ignoreForeignKeys: boolean }) => Promise<void>;
  onCancel: () => void;
}

export function DropTablesDialog({ mode, names, engine, connectionId, onConfirm, onCancel }: Props) {
  const { t } = useLang();
  // Emptying reuses the drop texts' structure under its own keys.
  const k = mode === "empty" ? "emptyTables" : "dropTables";
  const [ignoreForeignKeys, setIgnoreForeignKeys] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setRunning(true);
    setError(null);
    try {
      await onConfirm({ ignoreForeignKeys });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  }

  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(35,31,24,0.14)", display: "grid", placeItems: "center", zIndex: 70, animation: "om-fade 0.12s ease" }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 440, maxWidth: "calc(100vw - 32px)", background: "#fff", border: "1px solid #e5e2db", borderRadius: 13, boxShadow: "var(--shadow-pop)", animation: "om-pop 0.14s ease", overflow: "hidden" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid #f2f0ea" }}>
          <div style={{ fontWeight: 600 }}>{t(`${k}.title`, { count: names.length })}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onCancel} style={{ width: 26, height: 26, background: "transparent", border: "none", borderRadius: 6, color: "#8b877e", cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 13, color: "#4b473f" }}>{t(`${k}.irreversible`)}</div>

          <div className="om-sb" style={{ maxHeight: 150, overflowY: "auto", border: "1px solid #f0eee9", borderRadius: 8, padding: "6px 10px", fontFamily: "var(--font-mono)", fontSize: 12.5, color: "#4b473f" }}>
            {names.map((name) => (
              <div key={name} style={{ padding: "2px 0" }}>
                {name}
              </div>
            ))}
          </div>

          <div style={{ padding: 12, borderRadius: 8, background: "#faf9f6", border: "1px solid #f0eee9" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", fontWeight: 500 }}>
              <input type="checkbox" checked={ignoreForeignKeys} onChange={(e) => setIgnoreForeignKeys(e.target.checked)} />
              {t(`${k}.ignoreForeignKeys`)}
            </label>
            <div style={{ fontSize: 12, color: "#8b877e", marginTop: 6, lineHeight: 1.5 }}>{t(`${k}.ignoreForeignKeysHint.${engine}`)}</div>
          </div>

          <WritePreviewBox connectionId={connectionId} op={{ kind: mode === "empty" ? "emptyTables" : "dropTables", tables: names, ignoreForeignKeys }} />

          {error && (
            <div style={{ padding: "8px 10px", borderRadius: 8, fontSize: 12.5, background: "var(--env-prod-bg)", color: "var(--env-prod-fg)", border: "1px solid var(--env-prod-border)", lineHeight: 1.5 }}>
              {error}
              {!ignoreForeignKeys && <div style={{ marginTop: 4 }}>{t(`${k}.foreignKeyErrorHint`)}</div>}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={onCancel} style={{ padding: "7px 12px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 8, cursor: "pointer", color: "#4b473f" }}>
              {t("common.cancel")}
            </button>
            <button
              onClick={handleConfirm}
              disabled={running}
              style={{ padding: "7px 13px", background: "var(--env-prod-strong)", border: "1px solid var(--env-prod-strong)", borderRadius: 8, color: "#fff", fontWeight: 500, cursor: "pointer", opacity: running ? 0.6 : 1 }}
            >
              {running ? t("common.confirmRunning") : t(`${k}.submit`, { count: names.length })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
