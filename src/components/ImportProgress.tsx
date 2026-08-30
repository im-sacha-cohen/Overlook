"use client";

import { useState } from "react";

export interface ImportProgressState {
  done: number;
  total: number;
  failed: { statement: number; sql: string; message: string }[];
  status: "running" | "error" | "done";
  error?: string;
}

interface Props {
  state: ImportProgressState;
  onCancel: () => void;
  onDismiss: () => void;
}

export function ImportProgress({ state, onCancel, onDismiss }: Props) {
  const [showErrors, setShowErrors] = useState(false);
  const pct = state.total > 0 ? Math.min(100, Math.round((state.done / state.total) * 100)) : state.status === "done" ? 100 : 0;

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
          {state.status === "running" && "Import en cours…"}
          {state.status === "done" && (state.failed.length > 0 ? "Import terminé avec erreurs" : "Import terminé")}
          {state.status === "error" && "Import échoué"}
        </span>
        <div style={{ flex: 1 }} />
        {state.status === "running" ? (
          <button onClick={onCancel} style={{ background: "transparent", border: "none", color: "#d8d4cc", cursor: "pointer", fontSize: 12 }}>
            Annuler
          </button>
        ) : (
          <button onClick={onDismiss} style={{ background: "transparent", border: "none", color: "#d8d4cc", cursor: "pointer", fontSize: 14 }}>
            ✕
          </button>
        )}
      </div>

      {state.status === "error" ? (
        <div style={{ color: "oklch(0.75 0.12 25)" }}>{state.error}</div>
      ) : (
        <>
          <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", transition: "width 0.15s ease" }} />
          </div>
          <div style={{ marginTop: 6, color: "#a8a39a" }}>
            {state.total > 0
              ? `${state.done.toLocaleString("fr-FR")}/${state.total.toLocaleString("fr-FR")} instruction(s)`
              : "…"}
            {state.failed.length > 0 && <span style={{ color: "oklch(0.75 0.12 25)" }}> · {state.failed.length} erreur(s)</span>}
          </div>
          {state.failed.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <button
                onClick={() => setShowErrors((v) => !v)}
                style={{ background: "transparent", border: "none", color: "#d8d4cc", cursor: "pointer", fontSize: 11.5, padding: 0, textDecoration: "underline" }}
              >
                {showErrors ? "Masquer le détail" : "Voir le détail"}
              </button>
              {showErrors && (
                <div style={{ marginTop: 6, maxHeight: 120, overflowY: "auto" }}>
                  {state.failed.slice(0, 20).map((f) => (
                    <div key={f.statement} style={{ fontSize: 11, color: "#c9a389", marginBottom: 4, fontFamily: "var(--font-mono)" }}>
                      #{f.statement}: {f.message}
                    </div>
                  ))}
                  {state.failed.length > 20 && (
                    <div style={{ fontSize: 11, color: "#a8a39a" }}>… et {state.failed.length - 20} autre(s)</div>
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
