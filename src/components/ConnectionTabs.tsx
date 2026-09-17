"use client";

import { useEffect, useRef, useState } from "react";
import { ENV_COLORS } from "@/lib/client/env";
import { ConnectionMenu } from "./ConnectionMenu";
import type { Connection } from "@/lib/types";
import type { ViewKind } from "./TableToolbar";
import { useLang } from "@/lib/i18n/LanguageProvider";

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
  /** Opens a connection in a tab (or focuses the tab it already has). */
  onOpenConnection: (connectionId: string) => void;
  onAddConnection: () => void;
}

export function ConnectionTabs({ tabs, connections, activeTabId, onSwitch, onClose, onOpenConnection, onAddConnection }: Props) {
  const { t } = useLang();
  // The tab strip scrolls horizontally, so the menu is placed on the page, under the button.
  const [menuAt, setMenuAt] = useState<{ left: number; top: number } | null>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuAt) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !plusRef.current?.contains(target)) setMenuAt(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuAt(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuAt]);

  const activeConnectionId = tabs.find((tab) => tab.tabId === activeTabId)?.connectionId ?? null;
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
              title={t("connTabs.close")}
            >
              ✕
            </button>
          </div>
        );
      })}
      <button
        ref={plusRef}
        onClick={() => {
          if (menuAt) return setMenuAt(null);
          const rect = plusRef.current!.getBoundingClientRect();
          setMenuAt({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 348)), top: rect.bottom + 4 });
        }}
        title={t("connTabs.open")}
        aria-label={t("connTabs.open")}
        style={{
          flex: "none",
          width: 26,
          height: 26,
          margin: "0 0 4px 4px",
          display: "grid",
          placeItems: "center",
          background: menuAt ? "#e9e6df" : "transparent",
          border: "none",
          borderRadius: 7,
          color: "#8b877e",
          fontSize: 17,
          lineHeight: 1,
          cursor: "pointer",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#e9e6df")}
        onMouseLeave={(e) => {
          if (!menuAt) e.currentTarget.style.background = "transparent";
        }}
      >
        +
      </button>
      {menuAt && (
        <div ref={menuRef} style={{ position: "fixed", left: menuAt.left, top: menuAt.top, zIndex: 50 }}>
          <ConnectionMenu
            connections={connections}
            activeId={activeConnectionId}
            onPick={(id) => {
              setMenuAt(null);
              onOpenConnection(id);
            }}
            onAddNew={() => {
              setMenuAt(null);
              onAddConnection();
            }}
          />
        </div>
      )}
    </div>
  );
}
