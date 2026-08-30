"use client";

import { useEffect, useRef, useState } from "react";
import { EnvPill } from "./EnvPill";
import { ENV_COLORS } from "@/lib/client/env";
import { ENGINE_LABELS, type Connection } from "@/lib/types";
import { useLang } from "@/lib/i18n/LanguageProvider";

interface Props {
  connections: Connection[];
  activeConnection: Connection | null;
  onSwitch: (id: string) => void;
  onAddNew: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ConnectionBadge({ connections, activeConnection, onSwitch, onAddNew, onEdit, onDelete }: Props) {
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
        <div
          className="om-sb"
          style={{
            position: "absolute",
            top: 36,
            left: 0,
            width: 320,
            maxHeight: 420,
            overflowY: "auto",
            background: "var(--panel-bg)",
            border: "1px solid #e5e2db",
            borderRadius: 12,
            boxShadow: "var(--shadow-pop)",
            zIndex: 50,
            animation: "om-pop 0.14s ease",
            padding: 6,
          }}
        >
          <div style={{ padding: "6px 8px 8px", fontSize: 11.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#a8a39a", fontWeight: 600 }}>
            {t("connBadge.connections")}
          </div>
          {connections.length === 0 && (
            <div style={{ padding: "10px 8px", fontSize: 12.5, color: "#a8a39a" }}>{t("connBadge.noConnectionsSaved")}</div>
          )}
          {connections.map((c) => {
            const colors = ENV_COLORS[c.envType];
            const isActive = activeConnection?.id === c.id;
            return (
              <div
                key={c.id}
                onClick={() => {
                  onSwitch(c.id);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 8px",
                  borderRadius: 8,
                  cursor: "pointer",
                  background: isActive ? "#f4f2ed" : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = "#f7f6f2";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: colors.strong, flex: "none" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.name}
                  </div>
                  <div style={{ fontSize: 11, color: "#a8a39a" }}>
                    {ENGINE_LABELS[c.engine]} · {c.database}
                  </div>
                </div>
                <EnvPill env={c.envType} small />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(c.id);
                    setOpen(false);
                  }}
                  style={{ width: 22, height: 22, display: "grid", placeItems: "center", background: "transparent", border: "none", borderRadius: 5, color: "#8b877e", cursor: "pointer" }}
                  title={t("connBadge.edit")}
                >
                  ✎
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(t("connBadge.confirmDelete", { name: c.name }))) {
                      onDelete(c.id);
                    }
                  }}
                  style={{ width: 22, height: 22, display: "grid", placeItems: "center", background: "transparent", border: "none", borderRadius: 5, color: "#8b877e", cursor: "pointer" }}
                  title={t("connBadge.delete")}
                >
                  ✕
                </button>
              </div>
            );
          })}
          <div style={{ height: 1, background: "#f0eeE9", margin: "6px 4px" }} />
          <button
            onClick={() => {
              onAddNew();
              setOpen(false);
            }}
            style={{
              width: "100%",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 8px",
              background: "transparent",
              border: "none",
              borderRadius: 8,
              color: "var(--accent)",
              fontWeight: 500,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {t("connBadge.newConnection")}
          </button>
        </div>
      )}
    </div>
  );
}
