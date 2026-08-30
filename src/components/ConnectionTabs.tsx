"use client";

import { ENV_COLORS } from "@/lib/client/env";
import type { Connection } from "@/lib/types";
import type { ViewKind } from "./TableToolbar";

export interface WorkspaceTab {
  tabId: string;
  connectionId: string;
  table: string | null;
  view: ViewKind;
  filterColumn?: string | null;
  filterValue?: string | null;
}

interface Props {
  tabs: WorkspaceTab[];
  connections: Connection[];
  activeTabId: string | null;
  onSwitch: (tabId: string) => void;
  onClose: (tabId: string) => void;
}

export function ConnectionTabs({ tabs, connections, activeTabId, onSwitch, onClose }: Props) {
  const resolved = tabs
    .map((tab) => {
      const conn = connections.find((c) => c.id === tab.connectionId);
      return conn ? { tab, conn } : null;
    })
    .filter((v): v is { tab: WorkspaceTab; conn: Connection } => !!v);
  if (resolved.length === 0) return null;

  return (
    <div
      className="om-sb"
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 2,
        padding: "6px 10px 0",
        background: "#f3f1ec",
        borderBottom: "1px solid var(--border)",
        overflowX: "auto",
        flex: "none",
      }}
    >
      {resolved.map(({ tab, conn }) => {
        const active = tab.tabId === activeTabId;
        const colors = ENV_COLORS[conn.envType];
        return (
          <div
            key={tab.tabId}
            onClick={() => onSwitch(tab.tabId)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "6px 6px 7px 10px",
              borderRadius: "8px 8px 0 0",
              background: active ? "var(--bg)" : "transparent",
              cursor: "pointer",
              fontSize: 12.5,
              color: active ? "#26241f" : "#8b877e",
              fontWeight: active ? 500 : 400,
              whiteSpace: "nowrap",
              flex: "none",
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = "#e9e6df";
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = "transparent";
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: colors.strong, flex: "none" }} />
            <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>{conn.name}</span>
            {tab.table && (
              <span style={{ maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", color: "#b4afa5", fontSize: 11.5 }}>
                · {tab.table}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.tabId);
              }}
              style={{
                width: 16,
                height: 16,
                display: "grid",
                placeItems: "center",
                background: "transparent",
                border: "none",
                borderRadius: 4,
                color: "#a8a39a",
                cursor: "pointer",
                fontSize: 11,
              }}
              title="Fermer l'onglet"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
