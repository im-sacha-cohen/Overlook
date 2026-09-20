"use client";

import { useEffect, useRef, useState } from "react";
import { EnvPill } from "./EnvPill";
import { ENV_COLORS } from "@/lib/client/env";
import { ENGINE_LABELS, type Connection } from "@/lib/types";
import { useLang } from "@/lib/i18n/LanguageProvider";
import { ConnectionMenu } from "./ConnectionMenu";

interface Props {
  connections: Connection[];
  activeConnection: Connection | null;
  onSwitch: (id: string) => void;
  onAddNew: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  folders: string[];
  onMoveConnection: (id: string, folder: string | null) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (from: string, to: string) => void;
  onDeleteFolder: (name: string) => void;
}

export function ConnectionBadge({ connections, activeConnection, onSwitch, onAddNew, onEdit, onDelete, folders, onMoveConnection, onCreateFolder, onRenameFolder, onDeleteFolder }: Props) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const activeColors = activeConnection ? ENV_COLORS[activeConnection.envType] : null;

  return (
    <div ref={ref} style={{ position: "relative", flex: "none" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 30,
          padding: "0 10px 0 8px",
          background: activeColors ? activeColors.bg : "#f3f1ec",
          border: `1px solid ${activeColors ? activeColors.border : "#e8e5df"}`,
          borderRadius: 8,
          cursor: "pointer",
        }}
        title={activeConnection ? `${activeConnection.name} · ${ENGINE_LABELS[activeConnection.engine]}` : t("connBadge.noConnection")}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: activeColors ? activeColors.strong : "#b4afa5",
            flex: "none",
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
            fontWeight: 600,
            color: activeColors ? activeColors.fg : "#6f6b62",
            maxWidth: 180,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {activeConnection ? activeConnection.name : t("connBadge.noConnection")}
        </span>
        {activeConnection && <EnvPill env={activeConnection.envType} small />}
        <span style={{ fontSize: 9, color: activeColors ? activeColors.fg : "#a8a39a" }}>▾</span>
      </button>

      {open && (
        <div style={{ position: "absolute", top: 36, left: 0, zIndex: 50 }}>
          <ConnectionMenu
            connections={connections}
            activeId={activeConnection?.id ?? null}
            onPick={(id) => {
              onSwitch(id);
              setOpen(false);
            }}
            onAddNew={() => {
              onAddNew();
              setOpen(false);
            }}
            onEdit={(id) => {
              onEdit(id);
              setOpen(false);
            }}
            onDelete={onDelete}
            folders={folders}
            onMove={onMoveConnection}
            onCreateFolder={onCreateFolder}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={onDeleteFolder}
          />
        </div>
      )}
    </div>
  );
}

