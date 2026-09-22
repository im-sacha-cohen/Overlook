"use client";

import { useState } from "react";
import { useLang } from "@/lib/i18n/LanguageProvider";

export interface ImportProgressState {
  /** Statements run so far; how many there are is only known at the end. */
  statements: number;
  /** Progress is measured on the script's bytes, whose total is known upfront. */
  bytes: number;
  totalBytes: number | null;
  /** The first errors in full; `failedCount` counts them all. */
  failed: { statement: number; sql: string; message: string }[];
  failedCount: number;
  status: "running" | "error" | "done";
  error?: string;
}

function formatSize(bytes: number, locale: string): string {
  const units = locale === "fr-FR" ? ["o", "Ko", "Mo", "Go"] : ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`;
}

interface Props {
  state: ImportProgressState;
  onCancel: () => void;
  onDismiss: () => void;
}

export function ImportProgress({ state, onCancel, onDismiss }: Props) {
  const { t, lang } = useLang();
  const [showErrors, setShowErrors] = useState(false);
  const locale = lang === "fr" ? "fr-FR" : "en-US";
  const pct = state.status === "done" ? 100 : state.totalBytes ? Math.min(100, Math.round((state.bytes / state.totalBytes) * 100)) : 0;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 22,
        right: 22,
        width: 300,
        background: "#26241f",
        color: "#f7f6f2",
        borderRadius: 11,
        padding: "12px 14px",
        boxShadow: "0 12px 30px rgba(35,31,24,0.25)",
        zIndex: 65,
        animation: "om-pop 0.14s ease",
        fontSize: 12.5,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 500 }}>
          {state.status === "running" && t("importProgress.running")}
          {state.status === "done" && (state.failedCount > 0 ? t("importProgress.doneWithErrors") : t("importProgress.done"))}
          {state.status === "error" && t("importProgress.error")}
        </span>
        <div style={{ flex: 1 }} />
        {state.status === "running" ? (
          <button onClick={onCancel} style={{ background: "transparent", border: "none", color: "#d8d4cc", cursor: "pointer", fontSize: 12 }}>
            {t("importProgress.cancel")}
          </button>
        ) : (
          <button onClick={onDismiss} style={{ background: "transparent", border: "none", color: "#d8d4cc", cursor: "pointer", fontSize: 14 }}>
            ✕
          </button>
        )}
      </div>

      {state.status === "error" && state.statements === 0 ? (
        <div style={{ color: "oklch(0.75 0.12 25)" }}>{state.error}</div>
      ) : (
        <>
          <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", transition: "width 0.15s ease" }} />
          </div>
          {state.status === "error" && <div style={{ marginTop: 6, color: "oklch(0.75 0.12 25)" }}>{state.error}</div>}
          <div style={{ marginTop: 6, color: "#a8a39a" }}>
            {t("importProgress.statements", { count: state.statements.toLocaleString(locale) })}
            {state.totalBytes && state.status === "running"
              ? ` · ${formatSize(state.bytes, locale)} / ${formatSize(state.totalBytes, locale)}`
              : ` · ${formatSize(state.bytes, locale)}`}
            {state.failedCount > 0 && <span style={{ color: "oklch(0.75 0.12 25)" }}> · {t("importProgress.errors", { count: state.failedCount.toLocaleString(locale) })}</span>}
          </div>
          {state.failed.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <button
                onClick={() => setShowErrors((v) => !v)}
                style={{ background: "transparent", border: "none", color: "#d8d4cc", cursor: "pointer", fontSize: 11.5, padding: 0, textDecoration: "underline" }}
              >
                {showErrors ? t("importProgress.hideDetails") : t("importProgress.showDetails")}
              </button>
              {showErrors && (
                <div style={{ marginTop: 6, maxHeight: 120, overflowY: "auto" }}>
                  {state.failed.slice(0, 20).map((f) => (
                    <div key={f.statement} style={{ fontSize: 11, color: "#c9a389", marginBottom: 4, fontFamily: "var(--font-mono)" }}>
                      #{f.statement}: {f.message}
                    </div>
                  ))}
                  {state.failedCount > 20 && (
                    <div style={{ fontSize: 11, color: "#a8a39a" }}>{t("importProgress.andMore", { count: (state.failedCount - 20).toLocaleString(locale) })}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
