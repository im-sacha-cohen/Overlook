"use client";

import { useEffect, useState } from "react";
import { EnvPill } from "./EnvPill";
import { api } from "@/lib/client/api";
import { ENGINE_LABELS, type Connection } from "@/lib/types";
import { useLang } from "@/lib/i18n/LanguageProvider";

type Health = { state: "checking" } | { state: "ok"; at: number } | { state: "error"; at: number; message: string };

// Opening a connection list pings every connection. Results are shared by every list
// and reused for a short while, so toggling menus doesn't hammer the databases.
const HEALTH_TTL_MS = 30_000;
const HEALTH_TIMEOUT_MS = 8_000;
let healthStore: Record<string, Health> = {};
const listeners = new Set<(h: Record<string, Health>) => void>();

function record(id: string, h: Health) {
  healthStore = { ...healthStore, [id]: h };
  listeners.forEach((l) => l(healthStore));
}

function useConnectionHealth(connections: Connection[], timeoutMessage: string) {
  const [health, setHealth] = useState(healthStore);
  useEffect(() => {
    listeners.add(setHealth);
    const now = Date.now();
    for (const c of connections) {
      const h = healthStore[c.id];
      if (h && (h.state === "checking" || now - h.at < HEALTH_TTL_MS)) continue;
      record(c.id, { state: "checking" });
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), HEALTH_TIMEOUT_MS));
      Promise.race([api.testConnection({ id: c.id }), timeout])
        .then(() => record(c.id, { state: "ok", at: Date.now() }))
        .catch((err) => record(c.id, { state: "error", at: Date.now(), message: err instanceof Error ? err.message : String(err) }));
    }
    return () => {
      listeners.delete(setHealth);
    };
  }, [connections, timeoutMessage]);
  return health;
}

interface Props {
  connections: Connection[];
  activeId: string | null;
  onPick: (id: string) => void;
  onAddNew: () => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
}

/** The list of saved connections with their reachability, used by the switcher and the "+" tab. */
export function ConnectionMenu({ connections, activeId, onPick, onAddNew, onEdit, onDelete }: Props) {
  const { t } = useLang();
  const health = useConnectionHealth(connections, t("connBadge.healthTimeout"));

  return (
    <div
      className="om-sb"
      style={{
        width: 340,
        maxHeight: 440,
        overflowY: "auto",
        background: "var(--panel-bg)",
        border: "1px solid #e5e2db",
        borderRadius: 12,
        boxShadow: "var(--shadow-pop)",
        animation: "om-pop 0.14s ease",
        padding: 6,
      }}
    >
      <div style={{ padding: "6px 10px 8px", fontSize: 11.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#a8a39a", fontWeight: 600 }}>
        {t("connBadge.connections")}
      </div>
      {connections.length === 0 && <div style={{ padding: "10px", fontSize: 12.5, color: "#a8a39a" }}>{t("connBadge.noConnectionsSaved")}</div>}
      {connections.map((c) => {
        const isActive = activeId === c.id;
        return (
          <div
            key={c.id}
            className="om-conn-row"
            data-active={isActive || undefined}
            onClick={() => onPick(c.id)}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}
          >
            <HealthDot health={health[c.id]} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: isActive ? 600 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
              <div style={{ fontSize: 11.5, color: "#a8a39a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {ENGINE_LABELS[c.engine]} · {c.database}
              </div>
            </div>
            {(onEdit || onDelete) && (
              <div className="om-conn-actions" style={{ display: "flex", gap: 2 }}>
                {onEdit && (
                  <IconButton
                    title={t("connBadge.edit")}
                    onClick={() => onEdit(c.id)}
                  >
                    ✎
                  </IconButton>
                )}
                {onDelete && (
                  <IconButton
                    title={t("connBadge.delete")}
                    onClick={() => {
                      if (window.confirm(t("connBadge.confirmDelete", { name: c.name }))) onDelete(c.id);
                    }}
                  >
                    ✕
                  </IconButton>
                )}
              </div>
            )}
            <EnvPill env={c.envType} small />
          </div>
        );
      })}
      <div style={{ height: 1, background: "#f0eee9", margin: "6px 4px" }} />
      <button
        onClick={onAddNew}
        className="om-conn-row"
        style={{ width: "100%", textAlign: "left", padding: "8px 10px", background: "transparent", border: "none", borderRadius: 8, color: "var(--accent)", fontWeight: 500, cursor: "pointer", fontSize: 13 }}
      >
        {t("connBadge.newConnection")}
      </button>
    </div>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{ width: 24, height: 24, display: "grid", placeItems: "center", background: "transparent", border: "none", borderRadius: 6, color: "#8b877e", cursor: "pointer", fontSize: 12 }}
    >
      {children}
    </button>
  );
}

function HealthDot({ health }: { health: Health | undefined }) {
  const { t } = useLang();
  const state = health?.state ?? "checking";
  const color = state === "ok" ? "#3f9a5c" : state === "error" ? "#d0453a" : "#c9c4ba";
  const title = health?.state === "ok" ? t("connBadge.healthOk") : health?.state === "error" ? health.message : t("connBadge.healthChecking");
  return (
    <span
      title={title}
      aria-label={title}
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        boxShadow: state === "ok" ? "0 0 0 3px rgba(63,154,92,0.15)" : state === "error" ? "0 0 0 3px rgba(208,69,58,0.15)" : "none",
        flex: "none",
        animation: state === "checking" ? "om-pulse 1.2s ease-in-out infinite" : undefined,
      }}
    />
  );
}
