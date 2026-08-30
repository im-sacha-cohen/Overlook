"use client";

import type { HistoryEntry } from "@/lib/client/history";

interface Props {
  entries: HistoryEntry[];
  onClose: () => void;
  onUndo: (entry: HistoryEntry) => void;
}

export function HistoryPanel({ entries, onClose, onUndo }: Props) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(35,31,24,0.14)", display: "flex", justifyContent: "flex-end", zIndex: 45, animation: "om-fade 0.12s ease" }}>
      <div onClick={(e) => e.stopPropagation()} className="om-sb" style={{ width: 420, background: "#fff", borderLeft: "1px solid #e5e2db", overflowY: "auto", animation: "om-pop 0.16s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "15px 20px", borderBottom: "1px solid #f2f0ea", position: "sticky", top: 0, background: "#fff" }}>
          <div style={{ fontWeight: 600 }}>Historique</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ width: 26, height: 26, background: "transparent", border: "none", borderRadius: 6, color: "#8b877e", cursor: "pointer" }}>
            ✕
          </button>
        </div>
        <div style={{ padding: "14px 20px 40px", display: "flex", flexDirection: "column" }}>
          {entries.map((l) => (
            <div key={l.id} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid #f5f3ee" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#bdb8ae", paddingTop: 2 }}>{l.time}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5 }}>{l.text}</div>
                <div style={{ fontSize: 12, color: "#a8a39a" }}>{l.who}</div>
              </div>
              {l.undo && (
                <button
                  onClick={() => onUndo(l)}
                  style={{ alignSelf: "flex-start", padding: "3px 8px", background: "#fff", border: "1px solid #eceae4", borderRadius: 6, fontSize: 12, color: "#8b877e", cursor: "pointer" }}
                >
                  Annuler
                </button>
              )}
            </div>
          ))}
          {entries.length === 0 && (
            <div style={{ padding: "18px 0", fontSize: 13, color: "#a8a39a" }}>Rien pour l&apos;instant. Modifie une cellule pour voir l&apos;historique se remplir.</div>
          )}
        </div>
      </div>
    </div>
  );
}
