"use client";

import { useEffect, useRef, useState } from "react";
import type { AggregateFn, ColumnMeta, Row, RowSort } from "@/lib/types";
import { aggregatesFor } from "@/lib/db/where";
import { formatValue, pillStyle, toText } from "@/lib/client/format";
import { groupRows } from "@/lib/client/group";
import { parseTsv, pastedValue, toTsv } from "@/lib/client/cellClipboard";
import { useLang } from "@/lib/i18n/LanguageProvider";
import { DateField } from "../DateField";
import { RelationField } from "../RelationField";
import { TypeIcon } from "../TypeIcon";

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
  onDuplicateRow: (row: Row) => void;
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
  /** Columns pinned to the left; the parent already puts them first. */
  frozenColumns: string[];
  onToggleFrozen: (column: string) => void;
  summaries: Record<string, AggregateFn>;
  /** Keyed "column:fn", over every row the view keeps (not just this page). */
  summaryValues: Record<string, string | number | null>;
  onSetSummary: (column: string, fn: AggregateFn | null) => void;
  onFilterByValue: (col: ColumnMeta, value: unknown, exclude: boolean) => void;
}

interface CellPos {
  r: number;
  c: number;
}

const DEFAULT_WIDTH = 160;
// The grid scrolls inside a padded container: sticky cells stop at the padding, so the
// leftmost one paints over it, or scrolled cells would show through beside it.
const PAD_MASK = (color: string) => `-32px 0 0 ${color}, -2px 0 0 ${color}`;
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
  onDuplicateRow,
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
  frozenColumns,
  onToggleFrozen,
  summaries,
  summaryValues,
  onSetSummary,
  onFilterByValue,
}: Props) {
  const { t, lang } = useLang();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [hover, setHover] = useState<{ key: string; row: Row | null } | null>(null);
  const [relCtxMenu, setRelCtxMenu] = useState<{ x: number; y: number; col: ColumnMeta; value: unknown; row: Row } | null>(null);
  // Right-click on a column title, or a click on its summary cell.
  const [colMenu, setColMenu] = useState<{ x: number; y: number; col: ColumnMeta; kind: "header" | "summary" } | null>(null);
  const colMenuRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!colMenu) return;
    const onDown = (e: MouseEvent) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) setColMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setColMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [colMenu]);

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
  // Frozen columns stick after the checkbox and open-row columns, each after the previous one.
  const frozenLeft = new Map<string, number>();
  let nextLeft = (pkColumn ? 30 : 0) + 30;
  for (const c of columns) {
    if (!frozenColumns.includes(c.name)) break;
    frozenLeft.set(c.name, nextLeft);
    nextLeft += widthFor(c.name);
  }
  const lastFrozen = [...frozenLeft.keys()].pop();
  const frozenStyle = (name: string, background: string, zIndex: number): React.CSSProperties =>
    frozenLeft.has(name)
      ? { position: "sticky", left: frozenLeft.get(name), zIndex, background, ...(name === lastFrozen ? { boxShadow: "6px 0 8px -6px rgba(35, 31, 24, 0.18)" } : {}) }
      : {};
  const summaryLabel = (fn: AggregateFn) => t(`summary.${fn}`);
  const summaryText = (col: ColumnMeta, fn: AggregateFn) => {
    const v = summaryValues[`${col.name}:${fn}`];
    if (v === undefined) return "…";
    if (v === null) return "—";
    if ((fn === "min" || fn === "max") && col.logicalType === "date") return formatValue(v, col, lang);
    if (typeof v === "number") return v.toLocaleString(lang === "fr" ? "fr-FR" : "en-US", { maximumFractionDigits: 2 });
    return String(v);
  };
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
              boxShadow: PAD_MASK("#f5f3ee"),
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
            boxShadow: pkColumn ? "1px 0 0 #e2ded4" : `1px 0 0 #e2ded4, ${PAD_MASK("#f5f3ee")}`,
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
              onContextMenu={(e) => {
                e.preventDefault();
                setColMenu({ x: e.clientX, y: e.clientY, col: c, kind: "header" });
              }}
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
                ...frozenStyle(c.name, "#f5f3ee", 3),
              }}
            >
              <TypeIcon type={c.logicalType} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
              {sort && <span style={{ fontSize: 10, color: "#b4afa5" }}>{sort.dir === "asc" ? "↑" : "↓"}</span>}
              {frozenLeft.has(c.name) && (
                <svg aria-label={t("table.frozen")} width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#b4afa5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", marginLeft: "auto" }}>
                  <path d="M6 2h4l-.5 4 2.5 2.5H4L6.5 6zM8 8.5V14" />
                </svg>
              )}
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
                const rowBg = rowId && selectedIds.has(rowId) ? "var(--accent-bg)" : "var(--bg)";
                return (
                  <div
                    key={`${g.key}:${rowIndex}:${rowId}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: gridCols,
                      alignItems: "stretch",
                      borderBottom: "1px solid #f2f0ea",
                      // Opaque, so frozen cells (which inherit it) hide what scrolls under them.
                      background: rowId && selectedIds.has(rowId) ? "var(--accent-bg)" : "var(--bg)",
                      transition: "background-color 0.1s ease",
                    }}
                    onMouseEnter={(e) => {
                      if (!rowId || !selectedIds.has(rowId)) e.currentTarget.style.background = "#f8f7f4";
                    }}
                    onMouseLeave={(e) => {
                      if (!rowId || !selectedIds.has(rowId)) e.currentTarget.style.background = "var(--bg)";
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
                          boxShadow: PAD_MASK(rowBg),
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
                        boxShadow: pkColumn ? "1px 0 0 #f2f0ea" : `1px 0 0 #f2f0ea, ${PAD_MASK(rowBg)}`,
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
                            if (isEdit) return;
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
                            ...frozenStyle(c.name, selected ? "var(--accent-bg)" : "inherit", isRelation && hover?.key === hoverKey ? 4 : 1),
                            ...(selected && frozenLeft.has(c.name) ? { boxShadow: "inset 0 0 0 1px var(--accent-border)" } : {}),
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

      {/* Summaries over every row the view keeps; stays visible at the bottom while scrolling (past the container's 60px bottom padding). */}
      {Object.keys(summaries).some((name) => columns.some((c) => c.name === name)) && (
      <div style={{ display: "grid", gridTemplateColumns: gridCols, position: "sticky", bottom: -60, zIndex: 2, background: "#f5f3ee", borderTop: "1px solid #e2ded4", boxShadow: "0 -6px 12px -10px rgba(35, 31, 24, 0.25)" }}>
        {pkColumn && <div style={{ position: "sticky", left: 0, background: "#f5f3ee", boxShadow: PAD_MASK("#f5f3ee") }} />}
        <div style={{ position: "sticky", left: pkColumn ? 30 : 0, background: "#f5f3ee", boxShadow: pkColumn ? "1px 0 0 #e2ded4" : `1px 0 0 #e2ded4, ${PAD_MASK("#f5f3ee")}` }} />
        {columns.map((c) => {
          const fn = summaries[c.name];
          return (
            <div
              key={c.name}
              className="om-summary"
              onClick={(e) => setColMenu({ x: e.clientX, y: e.clientY, col: c, kind: "summary" })}
              title={fn ? summaryLabel(fn) : t("summary.pick")}
              style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 6, minWidth: 0, padding: "6px 10px", fontSize: 12, cursor: "pointer", borderRight: "1px solid #e2ded4", ...frozenStyle(c.name, "#f5f3ee", 3) }}
            >
              {fn ? (
                <>
                  <span style={{ color: "#a8a39a", fontSize: 11, flex: "none" }}>{summaryLabel(fn)}</span>
                  <span style={{ color: "#26241f", fontWeight: 500, fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summaryText(c, fn)}</span>
                </>
              ) : (
                <span className="om-summary-empty" style={{ color: "#b4afa5", fontSize: 11 }}>
                  {t("summary.pick")} ▾
                </span>
              )}
            </div>
          );
        })}
        <div />
      </div>
      )}

      {colMenu && (
        <div
          ref={colMenuRef}
          style={{ position: "fixed", top: Math.min(colMenu.y, window.innerHeight - 300), left: Math.min(colMenu.x, window.innerWidth - 230), zIndex: 80, background: "#fff", border: "1px solid #e5e2db", borderRadius: 10, boxShadow: "var(--shadow-pop)", padding: 5, minWidth: 200, animation: "om-pop 0.1s ease" }}
        >
          <div style={{ padding: "5px 10px 7px", fontSize: 11, color: "#a8a39a", fontFamily: "var(--font-mono)" }}>{colMenu.col.name}</div>
          {colMenu.kind === "header" && (
            <>
              <RelMenuItem
                label={frozenColumns.includes(colMenu.col.name) ? t("table.unfreeze") : t("table.freeze")}
                onClick={() => {
                  onToggleFrozen(colMenu.col.name);
                  setColMenu(null);
                }}
              />
              <div style={{ height: 1, margin: "4px 6px", background: "#f0eee8" }} />
              <div style={{ padding: "4px 10px 3px", fontSize: 11, color: "#a8a39a" }}>{t("summary.menuTitle")}</div>
            </>
          )}
          {aggregatesFor(colMenu.col.logicalType).map((fn) => (
            <RelMenuItem
              key={fn}
              label={`${summaries[colMenu.col.name] === fn ? "✓ " : ""}${summaryLabel(fn)}`}
              onClick={() => {
                onSetSummary(colMenu.col.name, fn);
                setColMenu(null);
              }}
            />
          ))}
          {summaries[colMenu.col.name] && (
            <RelMenuItem
              label={t("summary.none")}
              onClick={() => {
                onSetSummary(colMenu.col.name, null);
                setColMenu(null);
              }}
            />
          )}
        </div>
      )}

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
          {relCtxMenu.col.logicalType === "relation" && (
            <>
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
              <div style={{ height: 1, margin: "4px 6px", background: "#f0eee8" }} />
            </>
          )}
          {(() => {
            const v = relCtxMenu.value;
            const isEmpty = v === null || v === undefined || v === "";
            const shown = isEmpty ? "" : toText(v).length > 28 ? `${toText(v).slice(0, 28)}…` : toText(v);
            return (
              <>
                <RelMenuItem
                  label={isEmpty ? t("table.filterEmpty") : t("table.filterValue", { value: shown })}
                  onClick={() => {
                    onFilterByValue(relCtxMenu.col, v, false);
                    setRelCtxMenu(null);
                  }}
                />
                <RelMenuItem
                  label={isEmpty ? t("table.excludeEmpty") : t("table.excludeValue", { value: shown })}
                  onClick={() => {
                    onFilterByValue(relCtxMenu.col, v, true);
                    setRelCtxMenu(null);
                  }}
                />
                <div style={{ height: 1, margin: "4px 6px", background: "#f0eee8" }} />
                <RelMenuItem
                  label={t("table.duplicateRow")}
                  onClick={() => {
                    onDuplicateRow(relCtxMenu.row);
                    setRelCtxMenu(null);
                  }}
                />
              </>
            );
          })()}
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
