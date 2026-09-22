"use client";

import { useEffect, useRef, useState } from "react";
import type { TableMeta } from "@/lib/types";
import { useLang } from "@/lib/i18n/LanguageProvider";

interface Props {
  tables: TableMeta[];
  /** "loading": the connection hasn't answered yet; "error": it failed (the main area explains why). */
  status?: "ready" | "loading" | "error";
  activeTable: string | null;
  showColumns: boolean;
  onSelectTable: (name: string) => void;
  onOpenDiagram: () => void;
  onOpenCompare: () => void;
  onOpenCsv: () => void;
  onOpenSqlImport: () => void;
  onOpenHistory: () => void;
  onExport: () => void;
  selectedTables: Set<string>;
  onToggleTableSelect: (name: string) => void;
  onSelectOnlyTable: (name: string) => void;
  /** Shift-click: select every table between two clicks. `additive` keeps the current selection (⌘/Ctrl+Shift). */
  onSelectTableRange: (names: string[], additive: boolean) => void;
  onDeselectAllTables: () => void;
  onBulkDropTables: () => void;
  onExportSelectedTables: () => void;
  onOpenCreateTable: () => void;
  onOpenSettings: () => void;
  onOpenTableInNewTab: (name: string) => void;
  /** Link to a table in this connection, for opening it in another browser tab. */
  tableHref: (name: string) => string;
}

export function Sidebar({
  tables,
  status = "ready",
  activeTable,
  showColumns,
  onSelectTable,
  onOpenDiagram,
  onOpenCompare,
  onOpenCsv,
  onOpenSqlImport,
  onOpenHistory,
  onExport,
  selectedTables,
  onToggleTableSelect,
  onSelectOnlyTable,
  onSelectTableRange,
  onDeselectAllTables,
  onOpenCreateTable,
  onBulkDropTables,
  onExportSelectedTables,
  onOpenSettings,
  onOpenTableInNewTab,
  tableHref,
}: Props) {
  const { t } = useLang();
  const [menu, setMenu] = useState<{ x: number; y: number; table: string } | null>(null);
  // Last table clicked without Shift: the fixed end of a Shift-click range.
  const rangeAnchor = useRef<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const importBtnRef = useRef<HTMLDivElement>(null);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const [baseOpen, setBaseOpen] = useState(true);

  // Read after mount: the server render has no localStorage.
  useEffect(() => {
    try {
      if (localStorage.getItem(BASE_OPEN_KEY) === "0") setBaseOpen(false);
    } catch {
      // best-effort only
    }
  }, []);

  function toggleBase() {
    setBaseOpen((open) => {
      try {
        localStorage.setItem(BASE_OPEN_KEY, open ? "0" : "1");
      } catch {
        // best-effort only
      }
      return !open;
    });
  }

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menu]);

  useEffect(() => {
    if (!importMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        importMenuRef.current &&
        !importMenuRef.current.contains(e.target as Node) &&
        importBtnRef.current &&
        !importBtnRef.current.contains(e.target as Node)
      ) {
        setImportMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setImportMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [importMenuOpen]);

  return (
    <div
      style={{
        width: 244,
        flex: "none",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div className="om-sb" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 8px 0", display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ padding: "0 8px 8px", fontSize: 11.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#a8a39a", fontWeight: 600 }}>
          {t("sidebar.tables")}
        </div>

        {status === "loading" &&
          [72, 54, 88, 61, 46].map((w, i) => (
            <div key={i} style={{ padding: "7px 8px" }}>
              <div style={{ height: 10, width: `${w}%`, borderRadius: 5, background: "var(--border-3)", animation: "om-pulse 1.4s ease-in-out infinite", animationDelay: `${i * 0.08}s` }} />
            </div>
          ))}
        {status === "ready" && tables.length === 0 && <div style={{ padding: "6px 8px", fontSize: 12.5, color: "#a8a39a" }}>{t("sidebar.noTables")}</div>}
        {tables.map((t) => {
          const active = t.name === activeTable;
          const selected = selectedTables.has(t.name);
          return (
            <div key={t.name}>
              <div
                onMouseDown={(e) => {
                  // Shift-click would otherwise select the sidebar text.
                  if (e.shiftKey) e.preventDefault();
                }}
                onClick={(e) => {
                  if (e.shiftKey) {
                    const anchor = rangeAnchor.current ?? activeTable;
                    const from = tables.findIndex((x) => x.name === anchor);
                    const to = tables.findIndex((x) => x.name === t.name);
                    const range = from === -1 ? [t.name] : tables.slice(Math.min(from, to), Math.max(from, to) + 1).map((x) => x.name);
                    onSelectTableRange(range, e.metaKey || e.ctrlKey);
                    return;
                  }
                  rangeAnchor.current = t.name;
                  if (e.metaKey || e.ctrlKey) {
                    onToggleTableSelect(t.name);
                  } else {
                    if (selectedTables.size > 0) onDeselectAllTables();
                    onSelectTable(t.name);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!selectedTables.has(t.name)) {
                    rangeAnchor.current = t.name;
                    onSelectOnlyTable(t.name);
                  }
                  setMenu({ x: e.clientX, y: e.clientY, table: t.name });
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "6px 8px",
                  borderRadius: 6,
                  cursor: "pointer",
                  background: selected ? "var(--accent-bg)" : active ? "#f0eee8" : "transparent",
                  border: selected ? "1px solid var(--accent-border)" : "1px solid transparent",
                  fontWeight: active ? 500 : 400,
                }}
                onMouseEnter={(e) => {
                  if (!active && !selected) e.currentTarget.style.background = "#f4f2ed";
                }}
                onMouseLeave={(e) => {
                  if (!active && !selected) e.currentTarget.style.background = "transparent";
                }}
              >
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#b4afa5" }}>▦</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#b4afa5" }}>{t.rowCount}</span>
              </div>
              {showColumns && active && (
                <div style={{ display: "flex", flexDirection: "column", gap: 1, margin: "2px 0 6px 24px", paddingLeft: 10, borderLeft: "1px solid #eceae4" }}>
                  {t.columns.map((c) => (
                    <div key={c.name} style={{ display: "flex", gap: 8, padding: "2px 0", fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#8b877e" }}>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                      <span style={{ color: "#bdb8ae" }}>{c.nativeType}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div
          onClick={onOpenCreateTable}
          style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 8px", borderRadius: 6, color: "#a8a39a", cursor: "pointer", fontSize: 13 }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#f4f2ed";
            e.currentTarget.style.color = "#4b473f";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "#a8a39a";
          }}
        >
          {t("sidebar.newTable")}
        </div>
        <div style={{ height: 8 }} />
      </div>

      <div style={{ flex: "none", padding: "8px 8px", borderTop: "1px solid #f0eeE9" }}>
        <div
          role="button"
          aria-expanded={baseOpen}
          onClick={toggleBase}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 8px 4px", fontSize: 11.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#a8a39a", fontWeight: 600, cursor: "pointer", userSelect: "none" }}
        >
          {t("sidebar.space")}
          <span style={{ fontSize: 9, transform: baseOpen ? "rotate(90deg)" : "none", transition: "transform 0.12s ease" }}>▸</span>
        </div>
        {baseOpen && (
          <>
            <SidebarGroupLabel label={t("sidebar.groupExplore")} />
            <SidebarAction icon="⊶" label={t("sidebar.diagram")} onClick={onOpenDiagram} />
            <SidebarAction icon="⇄" label={t("sidebar.compare")} onClick={onOpenCompare} />
            <SidebarAction icon="↺" label={t("sidebar.history")} onClick={onOpenHistory} />
            <SidebarGroupLabel label={t("sidebar.groupData")} />
            <div style={{ position: "relative" }}>
              <div ref={importBtnRef}>
                <SidebarAction icon="↧" label={t("sidebar.import")} trailing="▸" onClick={() => setImportMenuOpen((v) => !v)} />
              </div>
              {importMenuOpen && (
                <div
                  ref={importMenuRef}
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 8,
                    zIndex: 80,
                    background: "#fff",
                    border: "1px solid #e5e2db",
                    borderRadius: 10,
                    boxShadow: "var(--shadow-pop)",
                    padding: 5,
                    minWidth: 170,
                    animation: "om-pop 0.1s ease",
                  }}
                >
                  <MenuItem
                    label={t("sidebar.importCsvFile")}
                    onClick={() => {
                      onOpenCsv();
                      setImportMenuOpen(false);
                    }}
                  />
                  <MenuItem
                    label={t("sidebar.importSqlScript")}
                    onClick={() => {
                      onOpenSqlImport();
                      setImportMenuOpen(false);
                    }}
                  />
                </div>
              )}
            </div>
            <SidebarAction icon="↥" label={t("sidebar.export")} onClick={onExport} />
          </>
        )}
      </div>

      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "8px 8px 8px 16px", borderTop: "1px solid #f0eeE9", fontSize: 12, color: "#a8a39a" }}>
        <span
          title={`⌘${t("sidebar.hintClick")} ${t("sidebar.hintMultiSelect")} · ⇧${t("sidebar.hintClick")} ${t("sidebar.hintRange")} · ${t("sidebar.hintRightClick")} ${t("sidebar.hintActions")}`}
          style={{ flex: 1, minWidth: 0, cursor: "help" }}
        >
          <span style={{ fontFamily: "var(--font-mono)" }}>⌘K</span> {t("sidebar.hintCmd")}
        </span>
        <button
          onClick={onOpenSettings}
          title={t("sidebar.settings")}
          aria-label={t("sidebar.settings")}
          style={{ width: 28, height: 28, flex: "none", display: "grid", placeItems: "center", background: "transparent", border: "none", borderRadius: 6, color: "#8b877e", fontSize: 15, cursor: "pointer" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f2ed")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          ⚙
        </button>
      </div>

      {menu && (
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            top: menu.y,
            left: menu.x,
            zIndex: 80,
            background: "#fff",
            border: "1px solid #e5e2db",
            borderRadius: 10,
            boxShadow: "var(--shadow-pop)",
            padding: 5,
            minWidth: 180,
            animation: "om-pop 0.1s ease",
          }}
        >
          {selectedTables.size <= 1 ? (
            <>
              <MenuItem
                label={t("sidebar.openInNewTab")}
                onClick={() => {
                  onOpenTableInNewTab(menu.table);
                  setMenu(null);
                }}
              />
              <MenuItem
                label={t("sidebar.openInBrowserTab")}
                onClick={() => {
                  window.open(tableHref(menu.table), "_blank", "noopener");
                  setMenu(null);
                }}
              />
              <div style={{ height: 1, margin: "4px 6px", background: "#f0eee8" }} />
            </>
          ) : (
            <div style={{ padding: "5px 10px 7px", fontSize: 11, color: "#a8a39a" }}>
              {selectedTables.size} {t("sidebar.tablesSelected_other")}
            </div>
          )}
          <MenuItem
            label={t("sidebar.export")}
            onClick={() => {
              onExportSelectedTables();
              setMenu(null);
            }}
          />
          <MenuItem
            label={t("common.delete")}
            danger
            onClick={() => {
              onBulkDropTables();
              setMenu(null);
            }}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <div
      onClick={onClick}
      style={{ padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 13, color: danger ? "var(--env-prod-fg)" : "#26241f" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f2ed")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {label}
    </div>
  );
}

const BASE_OPEN_KEY = "overlook:sidebarBaseOpen";

function SidebarGroupLabel({ label }: { label: string }) {
  return <div style={{ padding: "6px 8px 2px", fontSize: 11, color: "#bdb8ae" }}>{label}</div>;
}

function SidebarAction({ icon, label, onClick, trailing }: { icon: string; label: string; onClick: () => void; trailing?: string }) {
  return (
    <div
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 8px", borderRadius: 6, color: "#4b473f", cursor: "pointer" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f2ed")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span style={{ color: "#b4afa5" }}>{icon}</span>
      {label}
      {trailing && <span style={{ marginLeft: "auto", fontSize: 9, color: "#bdb8ae" }}>{trailing}</span>}
    </div>
  );
}
