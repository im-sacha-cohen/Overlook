"use client";

export interface ExportProgressState {
  doneRows: number;
  totalRows: number;
  doneTables: number;
  totalTables: number;
  status: "running" | "error" | "done";
  error?: string;
}

interface Props {
  state: ExportProgressState;
  onCancel: () => void;
  onDismiss: () => void;
}

export function ExportProgress({ state, onCancel, onDismiss }: Props) {
  const pct = state.totalRows > 0 ? Math.min(100, Math.round((state.doneRows / state.totalRows) * 100)) : state.status === "done" ? 100 : 0;

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
          {state.status === "running" && "Export en cours…"}
          {state.status === "done" && "Export terminé"}
          {state.status === "error" && "Export échoué"}
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
            {state.totalTables > 0 && `${state.doneTables}/${state.totalTables} table${state.totalTables > 1 ? "s" : ""} · `}
            {state.totalRows > 0
              ? `${state.doneRows.toLocaleString("fr-FR")}/${state.totalRows.toLocaleString("fr-FR")} ligne(s)`
              : "structure seule"}
          </div>
        </>
      )}
    </div>
  );
}
