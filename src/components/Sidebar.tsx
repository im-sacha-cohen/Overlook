"use client";

import { useEffect, useRef, useState } from "react";
import type { TableMeta } from "@/lib/types";
import { useLang } from "@/lib/i18n/LanguageProvider";

interface Props {
  tables: TableMeta[];
  activeTable: string | null;
  showColumns: boolean;
  onSelectTable: (name: string) => void;
  onOpenSchema: () => void;
  onOpenCsv: () => void;
  onOpenSqlImport: () => void;
  onOpenHistory: () => void;
  onExport: () => void;
  selectedTables: Set<string>;
  onToggleTableSelect: (name: string) => void;
  onSelectOnlyTable: (name: string) => void;
  onDeselectAllTables: () => void;
  onBulkDropTables: () => void;
  onExportSelectedTables: () => void;
  onOpenCreateTable: () => void;
  onOpenSettings: () => void;
}

export function Sidebar({
  tables,
  activeTable,
  showColumns,
  onSelectTable,
  onOpenSchema,
  onOpenCsv,
  onOpenSqlImport,
  onOpenHistory,
  onExport,
  selectedTables,
  onToggleTableSelect,
  onSelectOnlyTable,
  onDeselectAllTables,
  onOpenCreateTable,
  onBulkDropTables,
  onExportSelectedTables,
  onOpenSettings,
}: Props) {
  const { t } = useLang();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const importBtnRef = useRef<HTMLDivElement>(null);
  const importMenuRef = useRef<HTMLDivElement>(null);

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

        {tables.length === 0 && <div style={{ padding: "6px 8px", fontSize: 12.5, color: "#a8a39a" }}>{t("sidebar.noTables")}</div>}
        {tables.map((t) => {
          const active = t.name === activeTable;
          const selected = selectedTables.has(t.name);
          return (
            <div key={t.name}>
              <div
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey) {
                    onToggleTableSelect(t.name);
                  } else {
                    if (selectedTables.size > 0) onDeselectAllTables();
                    onSelectTable(t.name);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!selectedTables.has(t.name)) onSelectOnlyTable(t.name);
                  setMenu({ x: e.clientX, y: e.clientY });
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

      <div style={{ flex: "none", padding: "10px 8px", borderTop: "1px solid #f0eeE9" }}>
        <div style={{ padding: "0 8px 6px", fontSize: 11.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#a8a39a", fontWeight: 600 }}>
          {t("sidebar.space")}
        </div>
        <SidebarAction icon="⌗" label={t("sidebar.schema")} onClick={onOpenSchema} />
        <div style={{ position: "relative" }}>
          <div ref={importBtnRef}>
            <SidebarAction icon="↧" label={t("sidebar.import")} onClick={() => setImportMenuOpen((v) => !v)} />
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
        <SidebarAction icon="↺" label={t("sidebar.history")} onClick={onOpenHistory} />
        <SidebarAction icon="↥" label={t("sidebar.exportDatabase")} onClick={onExport} />
        <SidebarAction icon="⚙" label={t("sidebar.settings")} onClick={onOpenSettings} />
      </div>

      <div style={{ flex: "none", padding: "10px 8px", borderTop: "1px solid #f0eeE9", fontSize: 12, color: "#a8a39a", lineHeight: 1.6 }}>
        <div>
          <span style={{ fontFamily: "var(--font-mono)" }}>⌘K</span> {t("sidebar.hintCmd")}
        </div>
        <div>
          <span style={{ fontFamily: "var(--font-mono)" }}>⌘{t("sidebar.hintClick")}</span> {t("sidebar.hintMultiSelect")} · <span style={{ fontFamily: "var(--font-mono)" }}>{t("sidebar.hintRightClick")}</span> {t("sidebar.hintActions")}
        </div>
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
          <div style={{ padding: "5px 10px 7px", fontSize: 11, color: "#a8a39a" }}>
            {selectedTables.size} {t(selectedTables.size > 1 ? "sidebar.tablesSelected_other" : "sidebar.tablesSelected_one")}
          </div>
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

function SidebarAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 8px", borderRadius: 6, color: "#4b473f", cursor: "pointer" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f2ed")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span style={{ color: "#b4afa5" }}>{icon}</span>
      {label}
    </div>
  );
}
