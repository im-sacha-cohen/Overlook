"use client";

import { useEffect, useState } from "react";
import type { Connection, Row } from "@/lib/types";
import type { ColumnDiff, DataDiff, SchemaDiff } from "@/lib/compare";
import { api } from "@/lib/client/api";
import { toText } from "@/lib/client/format";
import { EnvPill } from "./EnvPill";
import { useLang } from "@/lib/i18n/LanguageProvider";

interface Props {
  connections: Connection[];
  initialLeft: string | null;
  onClose: () => void;
}

const select: React.CSSProperties = { height: 30, padding: "0 8px", border: "1px solid #e8e5df", borderRadius: 7, background: "#fff", fontSize: 13, minWidth: 0, maxWidth: 260 };
const section: React.CSSProperties = { fontSize: 11.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#a8a39a", fontWeight: 600, margin: "18px 0 8px" };
const badge = (bg: string, fg: string): React.CSSProperties => ({ fontSize: 11, padding: "1px 6px", borderRadius: 5, background: bg, color: fg, whiteSpace: "nowrap" });
const LEFT = { bg: "var(--env-prod-bg)", fg: "var(--env-prod-fg)" };
const RIGHT = { bg: "var(--env-local-bg)", fg: "var(--env-local-fg)" };
const CHANGED = { bg: "#fbf3e2", fg: "#9a6a12" };

function show(v: unknown): string {
  return v === null || v === undefined ? "null" : toText(v);
}

export function CompareView({ connections, initialLeft, onClose }: Props) {
  const { t } = useLang();
  const [left, setLeft] = useState(initialLeft ?? connections[0]?.id ?? "");
  const [right, setRight] = useState(connections.find((c) => c.id !== (initialLeft ?? connections[0]?.id))?.id ?? "");
  const [schema, setSchema] = useState<SchemaDiff | null>(null);
  const [data, setData] = useState<{ table: string; diff: DataDiff } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const leftConn = connections.find((c) => c.id === left);
  const rightConn = connections.find((c) => c.id === right);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function runSchema() {
    setLoading("schema");
    setError(null);
    setData(null);
    try {
      setSchema(await api.compareSchemas(left, right));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function runData(table: string) {
    setLoading(table);
    setError(null);
    try {
      setData({ table, diff: await api.compareData(left, right, table) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  const sideName = (side: "left" | "right") => (side === "left" ? leftConn?.name : rightConn?.name) ?? "";
  const bothTables = schema ? [...schema.changed.map((c) => c.table), ...schema.identical].sort((a, b) => a.localeCompare(b)) : [];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 55, background: "var(--bg)", display: "flex", flexDirection: "column", animation: "om-fade 0.12s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 600 }}>{t("compare.title")}</div>
        <div style={{ flex: 1 }} />
        <ConnectionSelect connections={connections} value={left} onChange={(v) => { setLeft(v); setSchema(null); setData(null); }} />
        <span style={{ color: "#a8a39a" }}>↔</span>
        <ConnectionSelect connections={connections} value={right} onChange={(v) => { setRight(v); setSchema(null); setData(null); }} />
        <button
          onClick={runSchema}
          disabled={!left || !right || left === right || loading !== null}
          style={{ height: 30, padding: "0 12px", background: "var(--accent)", border: "1px solid var(--accent-hover)", borderRadius: 7, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer", opacity: !left || !right || left === right ? 0.5 : 1 }}
        >
          {loading === "schema" ? t("compare.running") : t("compare.run")}
        </button>
        <button onClick={onClose} aria-label={t("common.close")} style={{ width: 28, height: 28, background: "transparent", border: "none", color: "#8b877e", cursor: "pointer" }}>
          ✕
        </button>
      </div>

      <div className="om-sb" style={{ flex: 1, overflow: "auto", padding: "8px 32px 40px" }}>
        {left === right && left && <div style={{ padding: "16px 0", fontSize: 13, color: "#a8a39a" }}>{t("compare.sameConnection")}</div>}
        {error && <div style={{ margin: "14px 0", padding: "8px 10px", borderRadius: 8, fontSize: 12.5, background: "var(--env-prod-bg)", color: "var(--env-prod-fg)" }}>{error}</div>}
        {!schema && !error && left !== right && <div style={{ padding: "16px 0", fontSize: 13, color: "#a8a39a" }}>{t("compare.intro")}</div>}

        {schema && !data && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              <span style={badge(LEFT.bg, LEFT.fg)}>{t("compare.onlyIn", { name: sideName("left"), count: schema.onlyLeft.length })}</span>
              <span style={badge(RIGHT.bg, RIGHT.fg)}>{t("compare.onlyIn", { name: sideName("right"), count: schema.onlyRight.length })}</span>
              <span style={badge(CHANGED.bg, CHANGED.fg)}>{t("compare.changedTables", { count: schema.changed.length })}</span>
              <span style={badge("#f3f1ec", "#6f6b62")}>{t("compare.identicalTables", { count: schema.identical.length })}</span>
            </div>

            {schema.onlyLeft.length + schema.onlyRight.length > 0 && (
              <>
                <div style={section}>{t("compare.missingTables")}</div>
                {schema.onlyLeft.map((name) => (
                  <TableLine key={`l-${name}`} name={name} note={t("compare.onlyInShort", { name: sideName("left") })} colors={LEFT} />
                ))}
                {schema.onlyRight.map((name) => (
                  <TableLine key={`r-${name}`} name={name} note={t("compare.onlyInShort", { name: sideName("right") })} colors={RIGHT} />
                ))}
              </>
            )}

            {schema.changed.length > 0 && <div style={section}>{t("compare.columnDifferences")}</div>}
            {schema.changed.map((c) => (
              <div key={c.table} style={{ border: "1px solid #eceae4", borderRadius: 9, marginBottom: 10, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#faf9f6" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600 }}>{c.table}</span>
                  <div style={{ flex: 1 }} />
                  <DataButton table={c.table} loading={loading} onRun={runData} />
                </div>
                {c.columns.map((col) => (
                  <ColumnLine key={col.name} diff={col} leftName={sideName("left")} rightName={sideName("right")} />
                ))}
              </div>
            ))}

            {bothTables.length > 0 && (
              <>
                <div style={section}>{t("compare.compareData")}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {bothTables.map((name) => (
                    <DataButton key={name} table={name} label={name} loading={loading} onRun={runData} />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {data && (
          <DataResult
            table={data.table}
            diff={data.diff}
            leftName={sideName("left")}
            rightName={sideName("right")}
            onBack={() => setData(null)}
          />
        )}
      </div>
    </div>
  );
}

function ConnectionSelect({ connections, value, onChange }: { connections: Connection[]; value: string; onChange: (v: string) => void }) {
  const conn = connections.find((c) => c.id === value);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={select}>
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {conn && <EnvPill env={conn.envType} small />}
    </span>
  );
}

function TableLine({ name, note, colors }: { name: string; note: string; colors: { bg: string; fg: string } }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 2px" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{name}</span>
      <span style={badge(colors.bg, colors.fg)}>{note}</span>
    </div>
  );
}

function ColumnLine({ diff, leftName, rightName }: { diff: ColumnDiff; leftName: string; rightName: string }) {
  const { t } = useLang();
  const describe = (c?: ColumnDiff["left"]) =>
    c ? `${c.nativeType}${c.nullable ? "" : " NOT NULL"}${c.isPrimaryKey ? " PK" : ""}${c.references ? ` → ${c.references.table}.${c.references.column}` : ""}` : "—";
  const colors = diff.change === "onlyLeft" ? LEFT : diff.change === "onlyRight" ? RIGHT : CHANGED;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, 1fr) 1.2fr 1.2fr", gap: 10, padding: "6px 12px", borderTop: "1px solid #f3f1ec", fontSize: 12.5, alignItems: "baseline" }}>
      <span style={{ display: "flex", gap: 6, alignItems: "baseline", minWidth: 0 }}>
        <span style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis" }}>{diff.name}</span>
        <span style={badge(colors.bg, colors.fg)}>
          {diff.change === "changed" ? diff.fields?.map((f) => t(`compare.field.${f}`)).join(", ") : t("compare.onlyInShort", { name: diff.change === "onlyLeft" ? leftName : rightName })}
        </span>
      </span>
      <span style={{ fontFamily: "var(--font-mono)", color: "#6f6b62" }} title={leftName}>
        {describe(diff.left)}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", color: "#6f6b62" }} title={rightName}>
        {describe(diff.right)}
      </span>
    </div>
  );
}

function DataButton({ table, label, loading, onRun }: { table: string; label?: string; loading: string | null; onRun: (table: string) => void }) {
  const { t } = useLang();
  return (
    <button
      onClick={() => onRun(table)}
      disabled={loading !== null}
      style={{ padding: "4px 10px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 7, fontSize: 12.5, color: "#4b473f", cursor: "pointer", fontFamily: label ? "var(--font-mono)" : undefined }}
    >
      {loading === table ? t("compare.running") : label ?? t("compare.compareRows")}
    </button>
  );
}

function DataResult({ table, diff, leftName, rightName, onBack }: { table: string; diff: DataDiff; leftName: string; rightName: string; onBack: () => void }) {
  const { t } = useLang();
  const cols = [diff.pkColumn, ...diff.columns];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
        <button onClick={onBack} style={{ padding: "4px 10px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 7, fontSize: 12.5, cursor: "pointer" }}>
          ← {t("compare.backToSchema")}
        </button>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 600 }}>{table}</span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <span style={badge(LEFT.bg, LEFT.fg)}>{t("compare.rowsOnlyIn", { name: leftName, count: diff.counts.onlyLeft })}</span>
        <span style={badge(RIGHT.bg, RIGHT.fg)}>{t("compare.rowsOnlyIn", { name: rightName, count: diff.counts.onlyRight })}</span>
        <span style={badge(CHANGED.bg, CHANGED.fg)}>{t("compare.rowsChanged", { count: diff.counts.changed })}</span>
        <span style={badge("#f3f1ec", "#6f6b62")}>{t("compare.rowsSame", { count: diff.counts.same })}</span>
      </div>
      {diff.truncated && <div style={{ marginTop: 8, fontSize: 12, color: "#9a6a12" }}>{t("compare.truncated")}</div>}

      {diff.changed.length > 0 && (
        <>
          <div style={section}>{t("compare.changedRows")}</div>
          <div className="om-sb" style={{ overflowX: "auto", border: "1px solid #eceae4", borderRadius: 9 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%" }}>
              <thead>
                <tr style={{ background: "#faf9f6" }}>
                  {cols.map((c) => (
                    <th key={c} style={th}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {diff.changed.map((ch) => (
                  <tr key={ch.key} style={{ borderTop: "1px solid #f3f1ec" }}>
                    {cols.map((c) =>
                      ch.columns.includes(c) ? (
                        <td key={c} style={{ ...td, background: CHANGED.bg }}>
                          <div style={{ color: LEFT.fg }} title={leftName}>{show(ch.left[c])}</div>
                          <div style={{ color: RIGHT.fg }} title={rightName}>{show(ch.right[c])}</div>
                        </td>
                      ) : (
                        <td key={c} style={{ ...td, color: "#8b877e" }}>
                          {show(ch.left[c])}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <RowList title={t("compare.rowsOnlyInTitle", { name: leftName })} rows={diff.onlyLeft} cols={cols} colors={LEFT} />
      <RowList title={t("compare.rowsOnlyInTitle", { name: rightName })} rows={diff.onlyRight} cols={cols} colors={RIGHT} />
      {diff.counts.changed + diff.counts.onlyLeft + diff.counts.onlyRight === 0 && <div style={{ marginTop: 16, fontSize: 13, color: "#6f6b62" }}>{t("compare.identicalData")}</div>}
      {(diff.counts.changed > diff.changed.length || diff.counts.onlyLeft > diff.onlyLeft.length || diff.counts.onlyRight > diff.onlyRight.length) && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#a8a39a" }}>{t("compare.listLimited")}</div>
      )}
    </div>
  );
}

function RowList({ title, rows, cols, colors }: { title: string; rows: Row[]; cols: string[]; colors: { bg: string; fg: string } }) {
  if (rows.length === 0) return null;
  return (
    <>
      <div style={section}>{title}</div>
      <div className="om-sb" style={{ overflowX: "auto", border: "1px solid #eceae4", borderRadius: 9 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%" }}>
          <thead>
            <tr style={{ background: "#faf9f6" }}>
              {cols.map((c) => (
                <th key={c} style={th}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: "1px solid #f3f1ec", background: colors.bg }}>
                {cols.map((c) => (
                  <td key={c} style={{ ...td, color: colors.fg }}>
                    {show(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "6px 10px", fontFamily: "var(--font-mono)", fontWeight: 500, color: "#6f6b62", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "6px 10px", whiteSpace: "nowrap", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "top" };
