"use client";

import { useState, type ReactNode } from "react";
import { useLang } from "@/lib/i18n/LanguageProvider";
import { ProdNameConfirm, prodNameMatches } from "./ProdNameConfirm";

interface Props {
  connectionName: string;
  actionLabel: string;
  /** Off outside production: a plain confirmation, no name to type. */
  requireName?: boolean;
  /** Shown under the label, e.g. the SQL about to run. */
  details?: ReactNode;
  /** Destructive action: red confirm button even outside production. */
  danger?: boolean;
  /** Called once confirmed; the dialog doesn't wait for the write, which runs in the background. */
  onConfirm: () => void;
  onCancel: () => void;
}

export function ProdGuardDialog({ connectionName, actionLabel, requireName = true, details, danger = false, onConfirm, onCancel }: Props) {
  const { t } = useLang();
  const [typed, setTyped] = useState("");
  const matches = !requireName || prodNameMatches(typed, connectionName);

  function handleConfirm() {
    if (matches) onConfirm();
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
          width: 520,
          maxWidth: "calc(100vw - 32px)",
          background: "#fff",
          border: `1px solid ${requireName ? "var(--env-prod-border)" : "#e5e2db"}`,
          borderRadius: 13,
          boxShadow: "var(--shadow-pop)",
          animation: "om-pop 0.14s ease",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            background: requireName ? "var(--env-prod-bg)" : "transparent",
            borderBottom: `1px solid ${requireName ? "var(--env-prod-border)" : "#f2f0ea"}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {requireName && <span style={{ fontSize: 16 }}>⚠</span>}
          <div style={{ fontWeight: 600, color: requireName ? "var(--env-prod-fg)" : "var(--fg)" }}>{requireName ? t("prodGuard.title") : t("confirmWrite.title")}</div>
        </div>
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{actionLabel}</div>
          {details}
          {requireName && <ProdNameConfirm name={connectionName} value={typed} onChange={setTyped} onSubmit={handleConfirm} autoFocus />}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 6 }}>
            <button
              onClick={onCancel}
              style={{ padding: "7px 12px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 8, cursor: "pointer", color: "#4b473f" }}
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleConfirm}
              disabled={!matches}
              style={{
                padding: "7px 13px",
                background: !matches ? "#e8e5df" : requireName || danger ? "var(--env-prod-strong)" : "var(--accent)",
                border: "none",
                borderRadius: 8,
                color: "#fff",
                fontWeight: 500,
                cursor: matches ? "pointer" : "not-allowed",
              }}
            >
              {t("common.confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
