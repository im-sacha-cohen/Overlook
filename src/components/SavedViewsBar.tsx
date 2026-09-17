"use client";

import { useState } from "react";
import type { SavedView } from "@/lib/prefs";
import { useLang } from "@/lib/i18n/LanguageProvider";

interface Props {
  views: SavedView[];
  activeViewId: string;
  /** The active view's filters/sorts/grouping no longer match what is on screen. */
  dirty: boolean;
  onApply: (id: string) => void;
  onClear: () => void;
  onSaveNew: (name: string) => void;
  onUpdate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Copies a link that opens this table with the current filters and sorts. */
  onCopyLink: () => void;
  /** Exports the rows as the view shows them. */
  onExportView: () => void;
}

const chip = (active: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 4,
  height: 26,
  padding: "0 10px",
  background: active ? "var(--accent-bg)" : "transparent",
  border: `1px solid ${active ? "var(--accent-border)" : "var(--border-3)"}`,
  borderRadius: 999,
  color: active ? "oklch(0.45 0.1 250)" : "#6f6b62",
  fontSize: 12.5,
  fontWeight: active ? 500 : 400,
  cursor: "pointer",
  whiteSpace: "nowrap",
});

const linkBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: "0 4px",
  color: "var(--accent)",
  fontSize: 12.5,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export function SavedViewsBar({ views, activeViewId, dirty, onApply, onClear, onSaveNew, onUpdate, onRename, onDelete, onCopyLink, onExportView }: Props) {
  const { t } = useLang();
  // "new" while naming a new view, a view id while renaming one.
  const [editing, setEditing] = useState<{ target: string; name: string } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  function submit() {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return;
    if (editing.target === "new") onSaveNew(name);
    else onRename(editing.target, name);
    setEditing(null);
  }

  const nameInput = editing && (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      style={{ display: "flex" }}
    >
      <input
        autoFocus
        value={editing.name}
        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(null);
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={t("savedViews.namePlaceholder")}
        style={{ ...chip(true), width: 160, cursor: "text", outline: "none" }}
      />
    </form>
  );

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 12 }}>
      <button onClick={onClear} style={chip(activeViewId === "")}>
        {t("savedViews.none")}
      </button>
      {views.map((v) =>
        editing?.target === v.id ? (
          <div key={v.id}>{nameInput}</div>
        ) : (
          <div key={v.id} style={{ position: "relative" }}>
            <button
              onClick={() => onApply(v.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenuFor(v.id);
              }}
              style={chip(v.id === activeViewId)}
            >
              {v.name}
              {v.id === activeViewId && dirty && <span title={t("savedViews.modified")}>•</span>}
              {v.id === activeViewId && (
                <span
                  role="button"
                  aria-label={t("savedViews.options")}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuFor(menuFor === v.id ? null : v.id);
                  }}
                  style={{ marginLeft: 2, fontSize: 9, opacity: 0.7 }}
                >
                  ▾
                </span>
              )}
            </button>
            {menuFor === v.id && (
              <div
                onMouseLeave={() => setMenuFor(null)}
                style={{ position: "absolute", top: 30, left: 0, zIndex: 40, minWidth: 150, padding: 4, background: "var(--panel-bg)", border: "1px solid #e5e2db", borderRadius: 9, boxShadow: "var(--shadow-pop)" }}
              >
                {[
                  { label: t("savedViews.rename"), run: () => setEditing({ target: v.id, name: v.name }) },
                  {
                    label: t("common.delete"),
                    run: () => {
                      if (window.confirm(t("savedViews.confirmDelete", { name: v.name }))) onDelete(v.id);
                    },
                  },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={() => {
                      setMenuFor(null);
                      item.run();
                    }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 9px", background: "transparent", border: "none", borderRadius: 6, fontSize: 12.5, color: "var(--fg)", cursor: "pointer" }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ),
      )}
      {editing?.target === "new" ? (
        nameInput
      ) : (
        <button onClick={() => setEditing({ target: "new", name: "" })} style={linkBtn}>
          {t("savedViews.saveNew")}
        </button>
      )}
      {dirty && (
        <button onClick={onUpdate} style={linkBtn}>
          {t("savedViews.update")}
        </button>
      )}
      <span style={{ flex: 1 }} />
      <button onClick={onCopyLink} style={{ ...linkBtn, color: "#8b877e" }} title={t("savedViews.copyLinkHint")}>
        {t("savedViews.copyLink")}
      </button>
      <button onClick={onExportView} style={{ ...linkBtn, color: "#8b877e" }} title={t("savedViews.exportHint")}>
        {t("savedViews.export")}
      </button>
    </div>
  );
}
