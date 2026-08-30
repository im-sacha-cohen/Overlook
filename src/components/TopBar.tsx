"use client";

import { ConnectionBadge } from "./ConnectionBadge";
import type { Connection } from "@/lib/types";

interface Props {
  connections: Connection[];
  activeConnection: Connection | null;
  onSwitchConnection: (id: string) => void;
  onAddConnection: () => void;
  onEditConnection: (id: string) => void;
  onDeleteConnection: (id: string) => void;
  tableLabel: string;
  rowCountLabel: string;
  dir: "doc" | "query";
  onSetDir: (dir: "doc" | "query") => void;
  onOpenCmd: () => void;
}

export function TopBar({
  connections,
  activeConnection,
  onSwitchConnection,
  onAddConnection,
  onEditConnection,
  onDeleteConnection,
  tableLabel,
  rowCountLabel,
  dir,
  onSetDir,
  onOpenCmd,
}: Props) {
  const btnStyle = (on: boolean): React.CSSProperties => ({
    padding: "4px 11px",
    border: "none",
    borderRadius: 6,
    fontSize: 12.5,
    cursor: "pointer",
    fontWeight: 500,
    background: on ? "#fff" : "transparent",
    color: on ? "#26241f" : "#8b877e",
    boxShadow: on ? "0 1px 2px rgba(35,31,24,0.08)" : "none",
  });

  return (
    <div style={{ height: 46, flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "0 12px 0 14px", borderBottom: "1px solid var(--border)" }}>
      <ConnectionBadge
        connections={connections}
        activeConnection={activeConnection}
        onSwitch={onSwitchConnection}
        onAddNew={onAddConnection}
        onEdit={onEditConnection}
        onDelete={onDeleteConnection}
      />
      {tableLabel && (
        <>
          <div style={{ color: "#c9c5bc" }}>/</div>
          <div style={{ fontWeight: 600 }}>{tableLabel}</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#a09b91", padding: "2px 6px", border: "1px solid #eceae4", borderRadius: 5 }}>
            {rowCountLabel}
          </div>
        </>
      )}
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 2, padding: 2, background: "#f3f1ec", borderRadius: 8 }}>
        <button onClick={() => onSetDir("doc")} style={btnStyle(dir === "doc")}>
          Document
        </button>
        <button onClick={() => onSetDir("query")} style={btnStyle(dir === "query")}>
          Requête
        </button>
      </div>
      <button
        onClick={onOpenCmd}
        style={{ display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 8px 0 10px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 8, color: "#8b877e", cursor: "pointer" }}
      >
        Rechercher
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, padding: "1px 5px", background: "#f4f2ed", borderRadius: 4 }}>⌘K</span>
      </button>
    </div>
  );
}
