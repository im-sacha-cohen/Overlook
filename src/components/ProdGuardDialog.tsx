"use client";

import { useState } from "react";
import { useLang } from "@/lib/i18n/LanguageProvider";

interface Props {
  connectionName: string;
  actionLabel: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export function ProdGuardDialog({ connectionName, actionLabel, onConfirm, onCancel }: Props) {
  const { t } = useLang();
  const [typed, setTyped] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed === connectionName;

  async function handleConfirm() {
    if (!matches) return;
    setRunning(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(35,31,24,0.28)",
        display: "grid",
        placeItems: "center",
        zIndex: 80,
        animation: "om-fade 0.12s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 440,
          background: "#fff",
          border: "1px solid var(--env-prod-border)",
          borderRadius: 13,
          boxShadow: "var(--shadow-pop)",
          animation: "om-pop 0.14s ease",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            background: "var(--env-prod-bg)",
            borderBottom: "1px solid var(--env-prod-border)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 16 }}>⚠</span>
          <div style={{ fontWeight: 600, color: "var(--env-prod-fg)" }}>{t("prodGuard.title")}</div>
        </div>
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{actionLabel}</div>
          <div style={{ fontSize: 12.5, color: "#8b877e" }}>
            {t("prodGuard.typeBefore")} <strong style={{ fontFamily: "var(--font-mono)", color: "#26241f" }}>{connectionName}</strong> {t("prodGuard.typeAfter")}
          </div>
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={connectionName}
            style={{
              border: "1px solid #e8e5df",
              borderRadius: 8,
              padding: "8px 10px",
              outline: "none",
              fontFamily: "var(--font-mono)",
              fontSize: 13.5,
            }}
          />
          {error && <div style={{ fontSize: 12.5, color: "var(--env-prod-fg)" }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 6 }}>
            <button
              onClick={onCancel}
              style={{ padding: "7px 12px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 8, cursor: "pointer", color: "#4b473f" }}
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleConfirm}
              disabled={!matches || running}
              style={{
                padding: "7px 13px",
                background: matches ? "var(--env-prod-strong)" : "#e8e5df",
                border: "none",
                borderRadius: 8,
                color: "#fff",
                fontWeight: 500,
                cursor: matches ? "pointer" : "not-allowed",
              }}
            >
              {running ? t("common.confirmRunning") : t("common.confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
