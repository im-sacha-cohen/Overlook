"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TableMeta } from "@/lib/types";
import { useLang } from "@/lib/i18n/LanguageProvider";
import { formatRowCount } from "@/lib/client/format";

interface Props {
  connectionId: string;
  tables: TableMeta[];
  onOpenTable: (name: string) => void;
  onClose: () => void;
}

const BOX_WIDTH = 230;
const HEADER = 30;
const ROW = 20;
const MAX_ROWS = 24;
const GAP_X = 110;
const GAP_Y = 36;

type Positions = Record<string, { x: number; y: number }>;

function boxHeight(t: TableMeta): number {
  return HEADER + Math.min(t.columns.length, MAX_ROWS + 1) * ROW + 8;
}

/**
 * Tables that nothing depends on go left, tables pointing at them further right,
 * so relations mostly read left to right.
 */
function autoLayout(tables: TableMeta[]): Positions {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const rankOf = (name: string): number => {
    if (rank.has(name)) return rank.get(name)!;
    if (visiting.has(name)) return 0; // reference cycle
    visiting.add(name);
    const t = byName.get(name);
    let r = 0;
    for (const c of t?.columns ?? []) {
      const target = c.references?.table;
      if (target && target !== name && byName.has(target)) r = Math.max(r, rankOf(target) + 1);
    }
    visiting.delete(name);
    rank.set(name, r);
    return r;
  };
  tables.forEach((t) => rankOf(t.name));
  const columns = new Map<number, TableMeta[]>();
  for (const t of tables) {
    const r = rank.get(t.name) ?? 0;
    columns.set(r, [...(columns.get(r) ?? []), t]);
  }
  const positions: Positions = {};
  for (const [r, list] of columns) {
    let y = 40;
    for (const t of list.sort((a, b) => a.name.localeCompare(b.name))) {
      positions[t.name] = { x: 40 + r * (BOX_WIDTH + GAP_X), y };
      y += boxHeight(t) + GAP_Y;
    }
  }
  return positions;
}

function storageKey(connectionId: string) {
  return `overlook:diagram:${connectionId}`;
}

function loadPositions(connectionId: string): Positions {
  try {
    return JSON.parse(localStorage.getItem(storageKey(connectionId)) ?? "{}") as Positions;
  } catch {
    return {};
  }
}

export function SchemaDiagram({ connectionId, tables, onOpenTable, onClose }: Props) {
  const { t, lang } = useLang();
  const initialLayout = useMemo(() => autoLayout(tables), [tables]);
  const [saved, setSaved] = useState<Positions>(() => loadPositions(connectionId));
  const fitView = () => {
    // The diagram fills the window below the toolbar.
    const width = typeof window === "undefined" ? 1200 : window.innerWidth;
    const height = typeof window === "undefined" ? 800 : window.innerHeight - 90;
    const all = { ...autoLayout(tables), ...loadPositions(connectionId) };
    const boxes = tables.map((tbl) => ({ ...all[tbl.name], h: boxHeight(tbl) })).filter((b) => b.x !== undefined);
    if (boxes.length === 0) return { x: 0, y: 0, scale: 1 };
    const minX = Math.min(...boxes.map((b) => b.x)) - 30;
    const minY = Math.min(...boxes.map((b) => b.y)) - 30;
    const maxX = Math.max(...boxes.map((b) => b.x + BOX_WIDTH)) + 30;
    const maxY = Math.max(...boxes.map((b) => b.y + b.h)) + 30;
    // Never so small the names can't be read; large schemas scroll instead.
    const scale = Math.max(0.45, Math.min(1, width / (maxX - minX), height / (maxY - minY)));
    return { x: -minX * scale, y: -minY * scale, scale };
  };
  const [view, setView] = useState(fitView);
  const [hovered, setHovered] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const drag = useRef<{ kind: "box"; name: string; dx: number; dy: number } | { kind: "pan"; startX: number; startY: number; ox: number; oy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const positions: Positions = { ...initialLayout, ...saved };

  useEffect(() => {
    try {
      if (Object.keys(saved).length > 0) localStorage.setItem(storageKey(connectionId), JSON.stringify(saved));
      else localStorage.removeItem(storageKey(connectionId));
    } catch {
      // Layout just won't be remembered.
    }
  }, [saved, connectionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toDiagram = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - view.x) / view.scale, y: (clientY - rect.top - view.y) / view.scale };
  };

  const needle = filter.trim().toLowerCase();
  const matches = (name: string) => !needle || name.toLowerCase().includes(needle);

  const edges = tables.flatMap((tbl) =>
    tbl.columns.flatMap((col, i) => {
      const ref = col.references;
      const target = ref && tables.find((x) => x.name === ref.table);
      if (!ref || !target) return [];
      const targetIndex = Math.max(0, target.columns.findIndex((c) => c.name === ref.column));
      return [{ from: tbl.name, fromRow: Math.min(i, MAX_ROWS), to: target.name, toRow: Math.min(targetIndex, MAX_ROWS), label: `${tbl.name}.${col.name} → ${ref.table}.${ref.column}` }];
    }),
  );

  function edgePath(e: (typeof edges)[number]) {
    const a = positions[e.from];
    const b = positions[e.to];
    const ay = a.y + HEADER + e.fromRow * ROW + ROW / 2 + 4;
    const by = b.y + HEADER + e.toRow * ROW + ROW / 2 + 4;
    if (e.from === e.to) {
      const x = a.x + BOX_WIDTH;
      return `M ${x} ${ay} C ${x + 50} ${ay}, ${x + 50} ${by}, ${x} ${by}`;
    }
    // Leave from the side facing the other table.
    const leftToRight = a.x + BOX_WIDTH / 2 <= b.x + BOX_WIDTH / 2;
    const ax = leftToRight ? a.x + BOX_WIDTH : a.x;
    const bx = leftToRight ? b.x : b.x + BOX_WIDTH;
    const bend = Math.max(40, Math.abs(bx - ax) / 2);
    return `M ${ax} ${ay} C ${ax + (leftToRight ? bend : -bend)} ${ay}, ${bx + (leftToRight ? -bend : bend)} ${by}, ${bx} ${by}`;
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 55, background: "var(--bg)", display: "flex", flexDirection: "column", animation: "om-fade 0.12s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontWeight: 600 }}>{t("diagram.title")}</div>
        <div style={{ fontSize: 12.5, color: "#a8a39a" }}>{t("diagram.summary", { tables: tables.length, relations: edges.length })}</div>
        <div style={{ flex: 1 }} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("diagram.filter")}
          style={{ height: 28, padding: "0 9px", border: "1px solid #e8e5df", borderRadius: 7, fontSize: 12.5, width: 180, outline: "none" }}
        />
        <button onClick={() => setView((v) => ({ ...v, scale: Math.min(2, v.scale * 1.2) }))} style={toolBtn}>
          +
        </button>
        <button onClick={() => setView((v) => ({ ...v, scale: Math.max(0.2, v.scale / 1.2) }))} style={toolBtn}>
          −
        </button>
        <button
          onClick={() => {
            try {
              localStorage.removeItem(storageKey(connectionId));
            } catch {
              // Nothing saved to forget.
            }
            setSaved({});
            setView(fitView());
          }}
          style={{ ...toolBtn, width: "auto", padding: "0 10px" }}
        >
          {t("diagram.resetLayout")}
        </button>
        <button onClick={onClose} style={{ ...toolBtn, border: "none" }} aria-label={t("common.close")}>
          ✕
        </button>
      </div>

      {tables.length === 0 ? (
        <div style={{ flex: 1, display: "grid", placeItems: "center", color: "#a8a39a", fontSize: 13.5 }}>{t("empty.noTable")}</div>
      ) : (
        <svg
          ref={svgRef}
          style={{ flex: 1, cursor: "grab", background: "radial-gradient(circle, #e8e5df 1px, transparent 1px) 0 0 / 22px 22px", userSelect: "none" }}
          onWheel={(e) => {
            const rect = svgRef.current!.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            setView((v) => {
              const scale = Math.min(2, Math.max(0.2, v.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
              // Zoom around the pointer.
              return { scale, x: px - ((px - v.x) * scale) / v.scale, y: py - ((py - v.y) * scale) / v.scale };
            });
          }}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, ox: view.x, oy: view.y };
          }}
          onMouseMove={(e) => {
            const d = drag.current;
            if (!d) return;
            if (d.kind === "pan") {
              setView((v) => ({ ...v, x: d.ox + e.clientX - d.startX, y: d.oy + e.clientY - d.startY }));
            } else {
              const p = toDiagram(e.clientX, e.clientY);
              setSaved((s) => ({ ...s, [d.name]: { x: Math.round(p.x - d.dx), y: Math.round(p.y - d.dy) } }));
            }
          }}
          onMouseUp={() => (drag.current = null)}
          onMouseLeave={() => (drag.current = null)}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            {edges.map((e, i) => {
              const active = hovered === e.from || hovered === e.to;
              const dim = (!!hovered && !active) || (!!needle && !matches(e.from) && !matches(e.to));
              return (
                <path
                  key={i}
                  d={edgePath(e)}
                  fill="none"
                  stroke={active ? "var(--accent)" : "#c9c4ba"}
                  strokeWidth={active ? 2 : 1.3}
                  opacity={dim ? 0.2 : 1}
                  markerEnd="url(#om-arrow)"
                >
                  <title>{e.label}</title>
                </path>
              );
            })}
            {tables.map((tbl) => {
              const p = positions[tbl.name];
              const dim = !!needle && !matches(tbl.name);
              const shown = tbl.columns.slice(0, MAX_ROWS);
              const extra = tbl.columns.length - shown.length;
              return (
                <g
                  key={tbl.name}
                  transform={`translate(${p.x} ${p.y})`}
                  opacity={dim ? 0.3 : 1}
                  onMouseEnter={() => setHovered(tbl.name)}
                  onMouseLeave={() => setHovered((h) => (h === tbl.name ? null : h))}
                >
                  <rect width={BOX_WIDTH} height={boxHeight(tbl)} rx={9} fill="#fff" stroke={hovered === tbl.name ? "var(--accent)" : "#e0ddd6"} />
                  <g
                    style={{ cursor: "move" }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      const pt = toDiagram(e.clientX, e.clientY);
                      drag.current = { kind: "box", name: tbl.name, dx: pt.x - p.x, dy: pt.y - p.y };
                    }}
                    onDoubleClick={() => onOpenTable(tbl.name)}
                  >
                    <rect width={BOX_WIDTH} height={HEADER} rx={9} fill="#f6f4ef" />
                    <rect y={HEADER - 9} width={BOX_WIDTH} height={9} fill="#f6f4ef" />
                    <text x={12} y={20} fontSize={13} fontWeight={600} fill="#26241f">
                      {tbl.name}
                    </text>
                    <text x={BOX_WIDTH - 12} y={20} fontSize={11} fill="#a8a39a" textAnchor="end">
                      {formatRowCount(tbl, lang)}
                    </text>
                  </g>
                  {shown.map((c, i) => (
                    <g key={c.name} transform={`translate(0 ${HEADER + i * ROW + 4})`}>
                      <text x={12} y={14} fontSize={12} fill={c.isPrimaryKey ? "#26241f" : "#4b473f"} fontWeight={c.isPrimaryKey ? 600 : 400} fontFamily="var(--font-mono)">
                        {c.isPrimaryKey ? "🔑 " : c.references ? "↗ " : ""}
                        {c.name.length > 22 ? `${c.name.slice(0, 21)}…` : c.name}
                      </text>
                      <text x={BOX_WIDTH - 12} y={14} fontSize={11} fill="#a8a39a" textAnchor="end">
                        {c.nativeType.length > 14 ? `${c.nativeType.slice(0, 13)}…` : c.nativeType}
                      </text>
                    </g>
                  ))}
                  {extra > 0 && (
                    <text x={12} y={HEADER + shown.length * ROW + 18} fontSize={11} fill="#a8a39a">
                      {t("diagram.moreColumns", { count: extra })}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
          <defs>
            <marker id="om-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#b4afa5" />
            </marker>
          </defs>
        </svg>
      )}
      <div style={{ padding: "6px 18px", fontSize: 11.5, color: "#a8a39a", borderTop: "1px solid var(--border)" }}>{t("diagram.help")}</div>
    </div>
  );
}

const toolBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  background: "#fff",
  border: "1px solid #e8e5df",
  borderRadius: 7,
  color: "#4b473f",
  fontSize: 13,
  cursor: "pointer",
};
