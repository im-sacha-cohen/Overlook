"use client";

import { useEffect, useRef, useState } from "react";
import type { ColumnMeta, Row, RowSort } from "@/lib/types";
import { formatValue, iconFor, pillStyle, toText } from "@/lib/client/format";
import { groupRows } from "@/lib/client/group";
import { parseTsv, pastedValue, toTsv } from "@/lib/client/cellClipboard";
import { useLang } from "@/lib/i18n/LanguageProvider";
import { DateField } from "../DateField";
import { RelationField } from "../RelationField";

interface Props {
  columns: ColumnMeta[];
  rows: Row[];
  pkColumn: string | null;
  groupByColumn?: ColumnMeta;
  editing: { rowId: string; column: string } | null;
  editValue: string;
  onEditValueChange: (v: string) => void;
  onCellClick: (row: Row, col: ColumnMeta) => void;
  onCellCommit: () => void;
  onCellCancel: () => void;
  onRowOpen: (row: Row) => void;
  onAddRow: () => void;
  sorts: RowSort[];
  onToggleSort: (colName: string) => void;
  onOpenSchema: () => void;
  selectedIds: Set<string>;
  onToggleSelect: (rowId: string) => void;
  onSelectAll: (ids: string[]) => void;
  onDeselectAll: () => void;
  columnWidths: Record<string, number>;
  onResizeColumn: (name: string, width: number) => void;
  onReorderColumns: (newOrder: string[]) => void;
  onNavigateRelation: (col: ColumnMeta, value: unknown, fromRow: Row) => void;
  onFetchRelated: (col: ColumnMeta, value: unknown) => Promise<Row | null>;
  onOpenRelationInNewTab: (col: ColumnMeta, value: unknown) => void;
  onSearchRelation: (col: ColumnMeta, query: string) => Promise<Row[]>;
  getRelationLabel: (col: ColumnMeta, row: Row) => string;
  onEditRelation: (row: Row, col: ColumnMeta, value: unknown) => void;
  onEditDate: (row: Row, col: ColumnMeta, value: string | null) => void;
  /** Cells pasted over a selection: one entry per row, with the values that fit their column. */
  onPasteCells: (updates: { row: Row; values: Row }[]) => void;
  onCellsCopied: (count: number) => void;
}

interface CellPos {
  r: number;
  c: number;
}

const DEFAULT_WIDTH = 160;
const MIN_WIDTH = 70;

export function TableView({
  columns,
  rows,
  pkColumn,
  groupByColumn,
  editing,
  editValue,
  onEditValueChange,
  onCellClick,
  onCellCommit,
  onCellCancel,
  onRowOpen,
  onAddRow,
  sorts,
  onToggleSort,
  onOpenSchema,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
  columnWidths,
  onResizeColumn,
  onReorderColumns,
  onNavigateRelation,
  onFetchRelated,
  onOpenRelationInNewTab,
  onSearchRelation,
  getRelationLabel,
  onEditRelation,
  onEditDate,
  onPasteCells,
  onCellsCopied,
}: Props) {
  const { t, lang } = useLang();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [hover, setHover] = useState<{ key: string; row: Row | null } | null>(null);
  const [relCtxMenu, setRelCtxMenu] = useState<{ x: number; y: number; col: ColumnMeta; value: unknown; row: Row } | null>(null);
  const dragState = useRef<{ colName: string; startX: number; startWidth: number } | null>(null);
  const relCtxMenuRef = useRef<HTMLDivElement>(null);
  // Cell range for copy/paste: drag across cells, or Shift-click from the last clicked one.
  const [range, setRange] = useState<{ anchor: CellPos; focus: CellPos } | null>(null);
  const pressRef = useRef<CellPos | null>(null);
  const anchorRef = useRef<CellPos | null>(null);
  const suppressClickRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!relCtxMenu) return;
    const onDown = (e: MouseEvent) => {
      if (relCtxMenuRef.current && !relCtxMenuRef.current.contains(e.target as Node)) setRelCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRelCtxMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [relCtxMenu]);

  const groups = groupRows(rows, groupByColumn);
  // Rows in the order they're drawn, which is what a range covers.
  const visibleRows = groups.flatMap((g) => (collapsed.has(g.key) ? [] : g.rows));
  const visibleIndex = new Map(visibleRows.map((r, i) => [r, i]));
  const bounds = range
    ? {
        r0: Math.min(range.anchor.r, range.focus.r),
        r1: Math.max(range.anchor.r, range.focus.r),
        c0: Math.min(range.anchor.c, range.focus.c),
        c1: Math.max(range.anchor.c, range.focus.c),
      }
    : null;
  const inRange = (r: number, c: number) => !!bounds && r >= bounds.r0 && r <= bounds.r1 && c >= bounds.c0 && c <= bounds.c1;

  // The latest values for the document listeners below.
  const clipboardState = useRef({ bounds, visibleRows, columns, onPasteCells, onCellsCopied });
  useEffect(() => {
    clipboardState.current = { bounds, visibleRows, columns, onPasteCells, onCellsCopied };
  });

  useEffect(() => {
    if (!range) return;
    const typing = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);
    };
    const onCopy = (e: ClipboardEvent) => {
      const { bounds: b, visibleRows: vr, columns: cols, onCellsCopied: copied } = clipboardState.current;
      if (!b || typing() || !e.clipboardData) return;
      const matrix: string[][] = [];
      for (let r = b.r0; r <= b.r1; r++) {
        const row = vr[r];
        if (!row) continue;
        matrix.push(cols.slice(b.c0, b.c1 + 1).map((c) => (row[c.name] === null || row[c.name] === undefined ? "" : toText(row[c.name]))));
      }
      e.clipboardData.setData("text/plain", toTsv(matrix));
      e.preventDefault();
      copied(matrix.length * (b.c1 - b.c0 + 1));
    };
    const onPaste = (e: ClipboardEvent) => {
      const { bounds: b, visibleRows: vr, columns: cols, onPasteCells: paste } = clipboardState.current;
      if (!b || typing() || !e.clipboardData) return;
      const matrix = parseTsv(e.clipboardData.getData("text/plain"));
      if (matrix.length === 0) return;
      e.preventDefault();
      // One value over a larger selection fills it; otherwise the block starts at its top-left cell.
      const fill = matrix.length === 1 && matrix[0].length === 1;
      const height = fill ? b.r1 - b.r0 + 1 : matrix.length;
      const width = fill ? b.c1 - b.c0 + 1 : Math.max(...matrix.map((m) => m.length));
      const updates: { row: Row; values: Row }[] = [];
      for (let i = 0; i < height; i++) {
        const row = vr[b.r0 + i];
        if (!row) break;
        const values: Row = {};
        for (let j = 0; j < width; j++) {
          const col = cols[b.c0 + j];
          const text = fill ? matrix[0][0] : matrix[i]?.[j];
          if (!col || text === undefined || col.isPrimaryKey) continue;
          const value = pastedValue(text, col);
          if (value !== undefined) values[col.name] = value;
        }
        if (Object.keys(values).length > 0) updates.push({ row, values });
      }
      if (updates.length > 0) paste(updates);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRange(null);
    };
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setRange(null);
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [range]);

  useEffect(() => {
    const onUp = () => {
      pressRef.current = null;
      document.body.style.userSelect = "";
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []);
  const selectCol = pkColumn ? "30px " : "";
  const widthFor = (name: string) => liveWidths[name] ?? columnWidths[name] ?? DEFAULT_WIDTH;
  const gridCols = `${selectCol}30px ${columns.map((c) => `${widthFor(c.name)}px`).join(" ")} 1fr`;
  const allIds = pkColumn ? rows.map((r) => String(r[pkColumn])) : [];
  const allChecked = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));

  function startResize(e: React.MouseEvent, colName: string) {
    e.stopPropagation();
    e.preventDefault();
    const drag = { colName, startX: e.clientX, startWidth: widthFor(colName) };
    dragState.current = drag;
    let active = true;
    const onMove = (ev: MouseEvent) => {
      if (!active) return;
      const next = Math.max(MIN_WIDTH, drag.startWidth + (ev.clientX - drag.startX));
      setLiveWidths((prev) => ({ ...prev, [drag.colName]: next }));
    };
    const onUp = (ev: MouseEvent) => {
      if (!active) return;
      active = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const next = Math.max(MIN_WIDTH, drag.startWidth + (ev.clientX - drag.startX));
      onResizeColumn(drag.colName, next);
      dragState.current = null;
      setLiveWidths({});
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function handleDrop(targetCol: string) {
    if (!dragCol || dragCol === targetCol) {
      setDragCol(null);
      return;
    }
    const order = columns.map((c) => c.name);
    const fromIdx = order.indexOf(dragCol);
    const toIdx = order.indexOf(targetCol);
    if (fromIdx === -1 || toIdx === -1) return;
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, dragCol);
    onReorderColumns(order);
    setDragCol(null);
  }

  return (
    <div ref={rootRef} data-clarity-mask="true" style={{ minWidth: "100%", display: "inline-block" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: gridCols,
          alignItems: "center",
          borderBottom: "1px solid #e2ded4",
          position: "sticky",
          top: -18,
          background: "#f5f3ee",
          boxShadow: "0 1px 0 rgba(35,31,24,0.02)",
          zIndex: 2,
        }}
      >
        {pkColumn && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "8px 0",
              position: "sticky",
              left: 0,
              zIndex: 3,
              background: "#f5f3ee",
            }}
          >
            <input
              type="checkbox"
              checked={allChecked}
              onChange={() => (allChecked ? onDeselectAll() : onSelectAll(allIds))}
              style={{ cursor: "pointer" }}
            />
          </div>
        )}
        <div
          style={{
            padding: "8px 6px",
            position: "sticky",
            left: pkColumn ? 30 : 0,
            zIndex: 3,
            background: "#f5f3ee",
            boxShadow: "1px 0 0 #e2ded4",
          }}
        />
        {columns.map((c) => {
          const sort = sorts.find((s) => s.column === c.name);
          return (
            <div
              key={c.name}
              draggable
              onDragStart={() => setDragCol(c.name)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(c.name)}
              onDragEnd={() => setDragCol(null)}
              onClick={() => onToggleSort(c.name)}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 10px",
                fontSize: 12.5,
                color: "#8b877e",
                cursor: "grab",
                overflow: "hidden",
                borderRight: "1px solid #e2ded4",
                opacity: dragCol === c.name ? 0.4 : 1,
                background: dragCol && dragCol !== c.name ? "var(--hover-bg)" : undefined,
              }}
            >
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#c2bdb3" }}>{iconFor(c.logicalType)}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
              {sort && <span style={{ fontSize: 10, color: "#b4afa5" }}>{sort.dir === "asc" ? "↑" : "↓"}</span>}
              <div
                onMouseDown={(e) => startResize(e, c.name)}
                onClick={(e) => e.stopPropagation()}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--accent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
                style={{
                  position: "absolute",
                  right: -4,
                  top: 0,
                  bottom: 0,
                  width: 7,
                  cursor: "col-resize",
                  zIndex: 3,
                  background: "transparent",
                  transition: "background 0.1s ease",
                }}
              />
            </div>
          );
        })}
        <div onClick={onOpenSchema} style={{ padding: "8px 10px", fontSize: 12.5, color: "#b4afa5", cursor: "pointer" }}>
          +
        </div>
      </div>

      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.key);
        return (
          <div key={g.key || "__all__"}>
            {groupByColumn && (
              <div
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.key)) next.delete(g.key);
                    else next.add(g.key);
                    return next;
                  })
                }
                style={{ display: "flex", alignItems: "center", gap: 9, padding: "16px 6px 8px", cursor: "pointer" }}
              >
                <span style={{ fontSize: 10, color: "#a8a39a" }}>{isCollapsed ? "▸" : "▾"}</span>
                <span style={pillStyle(g.key)}>{g.key}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#b4afa5" }}>{g.rows.length}</span>
              </div>
            )}
            {!isCollapsed &&
              g.rows.map((row, rowIndex) => {
                const rowId = pkColumn ? String(row[pkColumn]) : "";
                return (
                  <div
                    key={`${g.key}:${rowIndex}:${rowId}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: gridCols,
                      alignItems: "stretch",
                      borderBottom: "1px solid #f2f0ea",
                      background: rowId && selectedIds.has(rowId) ? "var(--accent-bg)" : undefined,
                      transition: "background-color 0.1s ease",
                    }}
                    onMouseEnter={(e) => {
                      if (!rowId || !selectedIds.has(rowId)) e.currentTarget.style.background = "#f8f7f4";
                    }}
                    onMouseLeave={(e) => {
                      if (!rowId || !selectedIds.has(rowId)) e.currentTarget.style.background = "";
                    }}
                  >
                    {pkColumn && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          position: "sticky",
                          left: 0,
                          zIndex: 1,
                          background: "inherit",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(rowId)}
                          onChange={() => onToggleSelect(rowId)}
                          style={{ cursor: "pointer" }}
                        />
                      </div>
                    )}
                    <div
                      onClick={() => onRowOpen(row)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#cdc8be",
                        cursor: "pointer",
                        fontSize: 12,
                        transition: "color 0.1s ease",
                        position: "sticky",
                        left: pkColumn ? 30 : 0,
                        zIndex: 1,
                        background: "inherit",
                        boxShadow: "1px 0 0 #f2f0ea",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "#cdc8be")}
                    >
                      ⤢
                    </div>
                    {columns.map((c, colIndex) => {
                      const raw = row[c.name];
                      const pos = { r: visibleIndex.get(row) ?? -1, c: colIndex };
                      const selected = inRange(pos.r, pos.c);
                      const isEdit = !!editing && editing.rowId === rowId && editing.column === c.name;
                      const hoverKey = `${rowId}:${c.name}`;
                      const isRelation = c.logicalType === "relation";
                      return (
                        <div
                          key={c.name}
                          onMouseDown={(e) => {
                            if (e.button !== 0 || isEdit) return;
                            if (e.shiftKey && anchorRef.current) {
                              e.preventDefault();
                              suppressClickRef.current = true;
                              setRange({ anchor: anchorRef.current, focus: pos });
                              return;
                            }
                            pressRef.current = pos;
                            anchorRef.current = pos;
                            if (range) setRange(null);
                          }}
                          onMouseMove={(e) => {
                            const press = pressRef.current;
                            if (!press || (e.buttons & 1) === 0 || (press.r === pos.r && press.c === pos.c)) return;
                            suppressClickRef.current = true;
                            document.body.style.userSelect = "none";
                            window.getSelection()?.removeAllRanges();
                            if (!range || range.focus.r !== pos.r || range.focus.c !== pos.c) setRange({ anchor: press, focus: pos });
                          }}
                          onClick={() => {
                            if (suppressClickRef.current) {
                              suppressClickRef.current = false;
                              return;
                            }
                            if (isEdit) return;
                            isRelation ? onNavigateRelation(c, raw, row) : onCellClick(row, c);
                          }}
                          onContextMenu={(e) => {
                            if (!isRelation) return;
                            e.preventDefault();
                            setHover(null);
                            setRelCtxMenu({ x: e.clientX, y: e.clientY, col: c, value: raw, row });
                          }}
                          onMouseEnter={
                            isRelation && raw !== null && raw !== undefined && raw !== ""
                              ? () => {
                                  setHover({ key: hoverKey, row: null });
                                  onFetchRelated(c, raw).then((related) => {
                                    setHover((h) => (h && h.key === hoverKey ? { key: hoverKey, row: related } : h));
                                  });
                                }
                              : undefined
                          }
                          onMouseLeave={isRelation ? () => setHover((h) => (h?.key === hoverKey ? null : h)) : undefined}
                          style={{
                            position: "relative",
                            display: "flex",
                            alignItems: "center",
                            minWidth: 0,
                            overflow: isRelation ? "visible" : "hidden",
                            padding: "9px 10px",
                            fontSize: 13.5,
                            borderRight: "1px solid #f2f0ea",
                            background: selected ? "var(--accent-bg)" : undefined,
                            boxShadow: selected ? "inset 0 0 0 1px var(--accent-border)" : undefined,
                            cursor: c.logicalType === "unknown" ? "default" : isRelation ? "pointer" : "text",
                          }}
                        >
                          {isEdit && c.logicalType === "date" ? (
                            <DateField
                              column={c}
                              value={raw}
                              autoOpen
                              onCommit={(next) => onEditDate(row, c, next)}
                              onClose={onCellCancel}
                            />
                          ) : isEdit && isRelation ? (
                            <RelationField
                              col={c}
                              value={raw}
                              autoOpen
                              onCommit={(value) => {
                                onEditRelation(row, c, value);
                                onCellCancel();
                              }}
                              onClose={onCellCancel}
                              onSearch={onSearchRelation}
                              getLabel={getRelationLabel}
                            />
                          ) : isEdit ? (
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(e) => onEditValueChange(e.target.value)}
                              onBlur={onCellCommit}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") onCellCommit();
                                if (e.key === "Escape") onCellCancel();
                              }}
                              style={{ width: "100%", border: "1px solid oklch(0.7 0.1 250)", borderRadius: 5, padding: "3px 6px", outline: "none", background: "#fff", fontSize: 13.5 }}
                            />
                          ) : c.logicalType === "checkbox" ? (
                            <span
                              style={{
                                width: 17,
                                height: 17,
                                display: "grid",
                                placeItems: "center",
                                borderRadius: 4,
                                fontSize: 11,
                                color: "#fff",
                                background: raw ? "var(--accent)" : "#fff",
                                border: `1px solid ${raw ? "var(--accent-hover)" : "#dcd9d2"}`,
                              }}
                            >
                              {raw ? "✓" : ""}
                            </span>
                          ) : c.logicalType === "select" && raw ? (
                            <span style={pillStyle(toText(raw))}>{toText(raw)}</span>
                          ) : isRelation && raw ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%", padding: "2px 7px 2px 5px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 6, fontSize: 12.5, overflow: "hidden" }}>
                              <span style={{ color: "#b4afa5", fontFamily: "var(--font-mono)", fontSize: 10 }}>↗</span>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{toText(raw)}</span>
                            </span>
                          ) : (
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{formatValue(raw, c, lang)}</span>
                          )}

                          {isRelation && hover?.key === hoverKey && (
                            <div
                              className="om-sb"
                              style={{
                                position: "absolute",
                                top: "100%",
                                left: 0,
                                marginTop: 4,
                                minWidth: 220,
                                maxWidth: 320,
                                maxHeight: 260,
                                overflowY: "auto",
                                background: "#fff",
                                border: "1px solid #e5e2db",
                                borderRadius: 9,
                                boxShadow: "var(--shadow-pop)",
                                padding: "10px 12px",
                                zIndex: 20,
                                cursor: "default",
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {hover.row === null ? (
                                <div style={{ fontSize: 12.5, color: "#a8a39a" }}>{t("common.loading")}</div>
                              ) : (
                                <>
                                  <div style={{ fontSize: 11, color: "#a8a39a", marginBottom: 6 }}>{c.references?.table}</div>
                                  {Object.entries(hover.row).map(([k, v]) => (
                                    <div key={k} style={{ display: "flex", gap: 8, fontSize: 12.5, padding: "2px 0" }}>
                                      <span style={{ color: "#8b877e", flex: "none" }}>{k}</span>
                                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {toText(v)}
                                      </span>
                                    </div>
                                  ))}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div />
                  </div>
                );
              })}
          </div>
        );
      })}

      <div onClick={onAddRow} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 6px", color: "#b4afa5", cursor: "pointer", fontSize: 13 }}>
        + {t("toolbar.newRow")}
      </div>

      {relCtxMenu && (
        <div
          ref={relCtxMenuRef}
          style={{
            position: "fixed",
            top: relCtxMenu.y,
            left: relCtxMenu.x,
            zIndex: 80,
            background: "#fff",
            border: "1px solid #e5e2db",
            borderRadius: 10,
            boxShadow: "var(--shadow-pop)",
            padding: 5,
            minWidth: 210,
            animation: "om-pop 0.1s ease",
          }}
        >
          <div style={{ padding: "5px 10px 7px", fontSize: 11, color: "#a8a39a" }}>
            → {relCtxMenu.col.references?.table}
          </div>
          <RelMenuItem
            label={t("relation.editValue")}
            onClick={() => {
              onCellClick(relCtxMenu.row, relCtxMenu.col);
              setRelCtxMenu(null);
            }}
          />
          {relCtxMenu.value !== null && relCtxMenu.value !== undefined && relCtxMenu.value !== "" && (
            <RelMenuItem
              label={t("relation.openInNewTab")}
              onClick={() => {
                onOpenRelationInNewTab(relCtxMenu.col, relCtxMenu.value);
                setRelCtxMenu(null);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function RelMenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{ padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#26241f" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f2ed")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {label}
    </div>
  );
}
