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
  /** Folders the connections are filed under, in their order. */
  folders?: string[];
  onMove?: (id: string, folder: string | null) => void;
  onCreateFolder?: (name: string) => void;
  onRenameFolder?: (from: string, to: string) => void;
  onDeleteFolder?: (name: string) => void;
}

const COLLAPSED_KEY = "overlook:collapsedConnectionFolders";

function readCollapsed(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((n): n is string => typeof n === "string") : [];
  } catch {
    return [];
  }
}

/** The list of saved connections with their reachability, used by the switcher and the "+" tab. */
export function ConnectionMenu({ connections, activeId, onPick, onAddNew, onEdit, onDelete, folders = [], onMove, onCreateFolder, onRenameFolder, onDeleteFolder }: Props) {
  const { t } = useLang();
  const health = useConnectionHealth(connections, t("connBadge.healthTimeout"));
  const [collapsed, setCollapsed] = useState<string[]>([]);
  // Which connection's "move to" menu is open, and the folder being named.
  const [moving, setMoving] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ target: "new" | string; name: string; forConnection?: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  useEffect(() => setCollapsed(readCollapsed()), []);

  function toggleFolder(name: string) {
    setCollapsed((prev) => {
      const next = prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name];
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // A folder simply reopens next time if the browser refuses storage.
      }
      return next;
    });
  }

  function submitName() {
    if (!naming) return;
    const name = naming.name.trim();
    setNaming(null);
    if (!name) return;
    if (naming.target === "new") {
      onCreateFolder?.(name);
      if (naming.forConnection) onMove?.(naming.forConnection, name);
    } else if (name !== naming.target) {
      onRenameFolder?.(naming.target, name);
    }
  }

  const nameInput = (placeholder: string) =>
    naming && (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitName();
        }}
        style={{ padding: "4px 6px" }}
      >
        <input
          autoFocus
          value={naming.name}
          placeholder={placeholder}
          onChange={(e) => setNaming({ ...naming, name: e.target.value })}
          onBlur={submitName}
          onKeyDown={(e) => {
            if (e.key === "Escape") setNaming(null);
          }}
          style={{ width: "100%", height: 28, padding: "0 8px", border: "1px solid var(--accent-border)", borderRadius: 7, fontSize: 13, outline: "none" }}
        />
      </form>
    );

  const grouped = folders.map((name) => ({ name, items: connections.filter((c) => c.folder === name) }));
  const loose = connections.filter((c) => !c.folder || !folders.includes(c.folder));

  function connectionRow(c: Connection, inFolder: boolean) {
    const isActive = activeId === c.id;
    return (
      <div key={c.id} style={{ position: "relative" }}>
        <div
          className="om-conn-row"
          data-active={isActive || undefined}
          draggable={!!onMove}
          onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)}
          onClick={() => onPick(c.id)}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", paddingLeft: inFolder ? 22 : 10, borderRadius: 8, cursor: "pointer" }}
        >
          <HealthDot health={health[c.id]} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: isActive ? 600 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
            <div style={{ fontSize: 11.5, color: "#a8a39a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {ENGINE_LABELS[c.engine]} · {c.database}
            </div>
          </div>
          {(onEdit || onDelete || onMove) && (
            <div className="om-conn-actions" style={{ display: "flex", gap: 2 }}>
              {onMove && (
                <IconButton title={t("connBadge.moveTo")} onClick={() => setMoving(moving === c.id ? null : c.id)}>
                  <FolderIcon />
                </IconButton>
              )}
              {onEdit && (
                <IconButton title={t("connBadge.edit")} onClick={() => onEdit(c.id)}>
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
        {moving === c.id && onMove && (
          <div
            onMouseLeave={() => setMoving(null)}
            style={{ position: "absolute", right: 8, top: 36, zIndex: 60, minWidth: 180, padding: 4, background: "var(--panel-bg)", border: "1px solid #e5e2db", borderRadius: 9, boxShadow: "var(--shadow-pop)" }}
          >
            <div style={{ padding: "5px 9px 6px", fontSize: 11, color: "#a8a39a" }}>{t("connBadge.moveTo")}</div>
            {folders.map((name) => (
              <MenuLine
                key={name}
                label={`${c.folder === name ? "✓ " : ""}${name}`}
                onClick={() => {
                  onMove(c.id, name);
                  setMoving(null);
                }}
              />
            ))}
            {c.folder && (
              <MenuLine
                label={t("connBadge.noFolder")}
                onClick={() => {
                  onMove(c.id, null);
                  setMoving(null);
                }}
              />
            )}
            <MenuLine
              label={t("connBadge.newFolder")}
              accent
              onClick={() => {
                setMoving(null);
                setNaming({ target: "new", name: "", forConnection: c.id });
              }}
            />
          </div>
        )}
      </div>
    );
  }

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

      {grouped.map(({ name, items }) => {
        const isCollapsed = collapsed.includes(name);
        return (
          <div
            key={name}
            onDragOver={onMove ? (e) => {
              e.preventDefault();
              setDragOver(name);
            } : undefined}
            onDragLeave={() => setDragOver((n) => (n === name ? null : n))}
            onDrop={onMove ? (e) => {
              e.preventDefault();
              setDragOver(null);
              const id = e.dataTransfer.getData("text/plain");
              if (id) onMove(id, name);
            } : undefined}
            style={{ borderRadius: 8, background: dragOver === name ? "var(--accent-bg)" : undefined }}
          >
            {naming?.target === name ? (
              nameInput(name)
            ) : (
              <div className="om-conn-row" onClick={() => toggleFolder(name)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 10px", borderRadius: 8, cursor: "pointer" }}>
                <span style={{ fontSize: 9, color: "#a8a39a", width: 8 }}>{isCollapsed ? "▸" : "▾"}</span>
                <FolderIcon />
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: "#6f6b62", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#b4afa5" }}>{items.length}</span>
                {(onRenameFolder || onDeleteFolder) && (
                  <div className="om-conn-actions" style={{ display: "flex", gap: 2 }}>
                    {onRenameFolder && (
                      <IconButton title={t("connBadge.renameFolder")} onClick={() => setNaming({ target: name, name })}>
                        ✎
                      </IconButton>
                    )}
                    {onDeleteFolder && (
                      <IconButton
                        title={t("connBadge.deleteFolder")}
                        onClick={() => {
                          if (window.confirm(t("connBadge.confirmDeleteFolder", { name }))) onDeleteFolder(name);
                        }}
                      >
                        ✕
                      </IconButton>
                    )}
                  </div>
                )}
              </div>
            )}
            {!isCollapsed && items.map((c) => connectionRow(c, true))}
            {!isCollapsed && items.length === 0 && (
              <div style={{ padding: "6px 10px 8px 30px", fontSize: 11.5, color: "#b4afa5" }}>{t("connBadge.emptyFolder")}</div>
            )}
          </div>
        );
      })}

      {grouped.length > 0 && loose.length > 0 && (
        <div
          onDragOver={onMove ? (e) => {
            e.preventDefault();
            setDragOver("");
          } : undefined}
          onDragLeave={() => setDragOver((n) => (n === "" ? null : n))}
          onDrop={onMove ? (e) => {
            e.preventDefault();
            setDragOver(null);
            const id = e.dataTransfer.getData("text/plain");
            if (id) onMove(id, null);
          } : undefined}
          style={{ padding: "8px 10px 4px", fontSize: 11, color: "#b4afa5", borderRadius: 8, background: dragOver === "" ? "var(--accent-bg)" : undefined }}
        >
          {t("connBadge.noFolder")}
        </div>
      )}
      {loose.map((c) => connectionRow(c, false))}

      {naming?.target === "new" && nameInput(t("connBadge.folderNamePlaceholder"))}

      <div style={{ height: 1, background: "#f0eee9", margin: "6px 4px" }} />
      <div style={{ display: "flex", gap: 4 }}>
        <button
          onClick={onAddNew}
          className="om-conn-row"
          style={{ flex: 1, textAlign: "left", padding: "8px 10px", background: "transparent", border: "none", borderRadius: 8, color: "var(--accent)", fontWeight: 500, cursor: "pointer", fontSize: 13 }}
        >
          {t("connBadge.newConnection")}
        </button>
        {onCreateFolder && (
          <button
            onClick={() => setNaming({ target: "new", name: "" })}
            className="om-conn-row"
            style={{ flex: "none", padding: "8px 10px", background: "transparent", border: "none", borderRadius: 8, color: "#8b877e", cursor: "pointer", fontSize: 13 }}
          >
            {t("connBadge.newFolder")}
          </button>
        )}
      </div>
    </div>
  );
}

function MenuLine({ label, onClick, accent }: { label: string; onClick: () => void; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 9px", background: "transparent", border: "none", borderRadius: 6, fontSize: 12.5, color: accent ? "var(--accent)" : "var(--fg)", cursor: "pointer" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f2ed")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {label}
    </button>
  );
}

function FolderIcon() {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" style={{ flex: "none", color: "#b4afa5" }}>
      <path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 2H13a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
    </svg>
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
