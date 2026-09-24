"use client";

import { useEffect, useMemo, useState } from "react";
import { ENGINE_LABELS, type Connection } from "@/lib/types";
import { useLang } from "@/lib/i18n/LanguageProvider";
import { api } from "@/lib/client/api";
import { analyzeCopy, type ConflictMode, type CopyAnalysis, type CopyRequest, type RelationMode } from "@/lib/client/copy";
import { EnvPill } from "./EnvPill";
import { Select } from "./Select";
import { ProdNameConfirm, prodNameMatches } from "./ProdNameConfirm";

export type CopySelection = { kind: "tables"; names: string[] } | { kind: "rows"; table: string; ids: string[] };

interface Props {
  source: Connection;
  connections: Connection[];
  selection: CopySelection;
  /** Hands the copy over to run in the background; the dialog closes. */
  onStart: (request: CopyRequest, info: { label: string; sourceName: string; targetName: string }) => void;
  onClose: () => void;
}

const CONFLICT_OPTIONS: ConflictMode[] = ["skip", "replace", "error"];

const warnBox = { padding: 12, borderRadius: 8, background: "var(--env-staging-bg)", border: "1px solid var(--env-staging-border)", color: "var(--env-staging-fg)" } as const;
const warnTitle = { fontWeight: 600, fontSize: 13 } as const;

/** Sets up sending the selected rows, or whole tables, into the same tables of another connection. */
export function CopyToDialog({ source, connections, selection, onStart, onClose }: Props) {
  const { t } = useLang();
  const tables = selection.kind === "tables" ? selection.names : [selection.table];
  // Grouped by folder, the source's own first (the usual target: prod ↔ staging ↔ local),
  // the connections outside any folder last.
  const targets = useMemo(() => {
    const others = connections.filter((c) => c.id !== source.id);
    const rank = (c: Connection) => (c.folder === source.folder && c.folder ? 0 : c.folder ? 1 : 2);
    const folderOrder = [...new Set(others.map((c) => c.folder ?? ""))];
    return others
      .map((c, i) => ({ c, i }))
      .sort((a, b) => rank(a.c) - rank(b.c) || folderOrder.indexOf(a.c.folder ?? "") - folderOrder.indexOf(b.c.folder ?? "") || a.i - b.i)
      .map(({ c }) => c);
  }, [connections, source]);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const target = targets.find((c) => c.id === targetId) ?? null;
  const [targetTables, setTargetTables] = useState<Set<string> | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [onConflict, setOnConflict] = useState<ConflictMode>("skip");
  const [emptyFirst, setEmptyFirst] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [analysis, setAnalysis] = useState<CopyAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [relationMode, setRelationMode] = useState<RelationMode>("include");
  const [emptyAlso, setEmptyAlso] = useState(false);

  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    setTargetTables(null);
    setTargetError(null);
    api
      .listTables(targetId)
      .then(({ tables: list }) => !cancelled && setTargetTables(new Set(list.map((x) => x.name))))
      .catch((err) => !cancelled && setTargetError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [targetId]);

  const missing = targetTables ? tables.filter((name) => !targetTables.has(name)) : [];
  const ids = selection.kind === "rows" ? selection.ids : undefined;
  const willEmpty = selection.kind === "tables" && emptyFirst;

  // What the copy would run into, looked at again whenever the target or the emptying changes.
  const analyzable = !!targetTables && missing.length < tables.length;
  useEffect(() => {
    if (!analyzable) return;
    const controller = new AbortController();
    setAnalysis(null);
    setAnalysisError(null);
    setEmptyAlso(false);
    const timer = setTimeout(() => {
      analyzeCopy(source.id, { target: targetId, tables, ids, onConflict, emptyFirst: willEmpty }, controller.signal)
        .then((a) => {
          setAnalysis(a);
          // Bringing the parent rows along is the default, when it can be done.
          setRelationMode(a.tooMany || Object.keys(a.extras).length === 0 ? "skip" : "include");
        })
        .catch((err) => !controller.signal.aborted && setAnalysisError(err instanceof Error ? err.message : String(err)));
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // onConflict doesn't change what is missing; tables and ids are fixed for the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzable, targetId, willEmpty]);

  const blockers = analysis?.emptyBlockers ?? [];
  const prod = target?.envType === "prod";
  const canRun =
    !!target &&
    !!analysis &&
    (blockers.length === 0 || emptyAlso) &&
    (!prod || prodNameMatches(confirmName, target.name));

  function run() {
    if (!target) return;
    onStart(
      {
        target: target.id,
        tables,
        ids,
        onConflict,
        emptyFirst: willEmpty,
        emptyAlso: willEmpty && emptyAlso ? blockers.map((b) => b.table) : undefined,
        relations: relationMode,
        confirm: prod ? target.name : undefined,
      },
      { label: summary, sourceName: source.name, targetName: target.name },
    );
    onClose();
  }

  const summary = selection.kind === "rows" ? t("copyTo.rowsOf", { count: selection.ids.length, table: selection.table }) : t("copyTo.tables", { count: tables.length });

  const box = { padding: 12, borderRadius: 8, background: "#faf9f6", border: "1px solid #f0eee9" } as const;
  const label = { fontSize: 11.5, fontWeight: 600, color: "#8b877e", textTransform: "uppercase", letterSpacing: "0.04em" } as const;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(35,31,24,0.14)", display: "grid", placeItems: "center", zIndex: 70, animation: "om-fade 0.12s ease" }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 480, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 32px)", display: "flex", flexDirection: "column", background: "#fff", border: "1px solid #e5e2db", borderRadius: 13, boxShadow: "var(--shadow-pop)", animation: "om-pop 0.14s ease", overflow: "hidden" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid #f2f0ea" }}>
          <div style={{ fontWeight: 600 }}>{t("copyTo.title")}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ width: 26, height: 26, background: "transparent", border: "none", borderRadius: 6, color: "#8b877e", cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <div className="om-sb" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div style={label}>{t("copyTo.source")}</div>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: "#8b877e" }}>{summary}</span>
            </div>
            <div style={{ ...box, display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", fontSize: 13 }}>
              <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{source.name}</span>
              <EnvPill env={source.envType} small />
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: "#a8a39a" }}>{ENGINE_LABELS[source.engine]}</span>
            </div>
            <div className="om-sb" style={{ flex: "none", maxHeight: 130, overflowY: "auto", border: "1px solid #f0eee9", borderRadius: 8, padding: "6px 10px", fontSize: 12.5, color: "#4b473f" }}>
              {targetError ? (
                <div style={{ color: "var(--env-prod-fg)" }}>{targetError}</div>
              ) : (
                tables.map((name) => {
                  const absent = targetTables !== null && !targetTables.has(name);
                  return (
                    <div key={name} style={{ display: "flex", gap: 8, padding: "2px 0", alignItems: "baseline" }}>
                      <span style={{ fontFamily: "var(--font-mono)", color: absent ? "#a8a39a" : undefined, textDecoration: absent ? "line-through" : undefined }}>{name}</span>
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 11.5, color: absent ? "var(--env-prod-fg)" : "#8b877e" }}>
                        {targetTables === null ? "…" : absent ? t("copyTo.missing") : ""}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {targets.length === 0 ? (
            <div style={{ fontSize: 13, color: "#8b877e" }}>{t("copyTo.noTarget")}</div>
          ) : (
            <>
              <div style={{ textAlign: "center", color: "#a8a39a", fontSize: 16, lineHeight: 1, margin: "-6px 0" }} aria-hidden>
                ↓
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={label}>{t("copyTo.target")}</div>
                <Select
                  value={targetId}
                  onChange={(id) => {
                    setTargetId(id);
                    setConfirmName("");
                  }}
                  options={targets.map((c) => ({
                    value: c.id,
                    label: c.name,
                    hint: (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        {ENGINE_LABELS[c.engine]}
                        <EnvPill env={c.envType} small />
                      </span>
                    ),
                    group: c.folder ?? t("connBadge.noFolder"),
                  }))}
                  suffix={target && <EnvPill env={target.envType} small />}
                  ariaLabel={t("copyTo.target")}
                  style={{ width: "100%" }}
                />
              </div>

              {missing.length > 0 && missing.length < tables.length && <div style={{ fontSize: 12, color: "#8b877e", marginTop: -8 }}>{t("copyTo.missingHint")}</div>}

              <div style={{ ...box, display: "flex", flexDirection: "column", gap: 7 }}>
                <div style={label}>{t("copyTo.conflict")}</div>
                {CONFLICT_OPTIONS.map((mode) => (
                  <label key={mode} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 13, cursor: "pointer" }}>
                    <input type="radio" name="copy-conflict" checked={onConflict === mode} onChange={() => setOnConflict(mode)} />
                    <span>
                      {t(`copyTo.conflict.${mode}`)}
                      <span style={{ display: "block", fontSize: 12, color: "#8b877e", marginTop: 1 }}>{t(`copyTo.conflict.${mode}Hint`)}</span>
                    </span>
                  </label>
                ))}
              </div>

              {selection.kind === "tables" && (
                <div style={box}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", fontWeight: 500 }}>
                    <input type="checkbox" checked={emptyFirst} onChange={(e) => setEmptyFirst(e.target.checked)} />
                    {t("copyTo.emptyFirst")}
                  </label>
                  <div style={{ fontSize: 12, color: emptyFirst ? "var(--env-prod-fg)" : "#8b877e", marginTop: 6, lineHeight: 1.5 }}>{t("copyTo.emptyFirstHint")}</div>
                </div>
              )}

              {analyzable && !analysis && !analysisError && <div style={{ fontSize: 12, color: "#8b877e" }}>{t("copyTo.analyzing")}</div>}
              {analysisError && <div style={{ fontSize: 12.5, color: "var(--env-prod-fg)" }}>{analysisError}</div>}

              {analysis && blockers.length > 0 && (
                <div style={{ ...warnBox, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={warnTitle}>⚠ {t("copyTo.emptyBlockers")}</div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                    {blockers.map((b) => (
                      <div key={b.table}>{t("copyTo.emptyBlocker", { table: b.table, references: b.references })}</div>
                    ))}
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", fontWeight: 500 }}>
                    <input type="checkbox" checked={emptyAlso} onChange={(e) => setEmptyAlso(e.target.checked)} />
                    {t("copyTo.emptyAlso", { count: blockers.length })}
                  </label>
                </div>
              )}

              {analysis && analysis.relations.length > 0 && (
                <RelationsNotice analysis={analysis} mode={relationMode} onModeChange={setRelationMode} />
              )}

              {prod && target && (
                <div style={{ borderRadius: 8, border: "1px solid var(--env-prod-border)", overflow: "hidden" }}>
                  <div style={{ padding: "9px 12px", background: "var(--env-prod-bg)", borderBottom: "1px solid var(--env-prod-border)", display: "flex", alignItems: "center", gap: 8, color: "var(--env-prod-fg)", fontWeight: 600, fontSize: 13 }}>
                    <span>⚠</span>
                    {t("prodGuard.title")}
                  </div>
                  <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                    <ProdNameConfirm name={target.name} value={confirmName} onChange={setConfirmName} onSubmit={() => canRun && run()} />
                  </div>
                </div>
              )}
            </>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ padding: "7px 12px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 8, cursor: "pointer", color: "#4b473f" }}>
              {t("common.cancel")}
            </button>
            <button
              onClick={run}
              disabled={!canRun}
              style={{ padding: "7px 13px", background: prod ? "var(--env-prod-strong)" : "#26241f", border: "none", borderRadius: 8, color: "#fff", fontWeight: 500, cursor: canRun ? "pointer" : "default", opacity: canRun ? 1 : 0.5 }}
            >
              {t("copyTo.submit")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The rows pointing to parents the target lacks, and the choice of what to do with them. */
function RelationsNotice({ analysis, mode, onModeChange }: { analysis: CopyAnalysis; mode: RelationMode; onModeChange: (m: RelationMode) => void }) {
  const { t } = useLang();
  const [details, setDetails] = useState(false);
  const enforced = analysis.relations.filter((r) => r.enforced);
  const loose = analysis.relations.filter((r) => !r.enforced);
  const extras = Object.entries(analysis.extras).filter(([, n]) => n > 0);
  const canInclude = extras.length > 0 && !analysis.tooMany;
  // What "skip" leaves out, at least: rows of other tables pointing to those follow them.
  const leftOut = analysis.orphans;
  const unresolvable = analysis.relations.reduce((sum, r) => sum + r.unresolvable, 0);
  const line = (r: CopyAnalysis["relations"][number]) => (
    <div key={`${r.fromTable}.${r.column}`}>
      {t("copyTo.relationLine", { rows: r.rows, from: r.fromTable, column: r.column, missing: r.missing, to: r.toTable })}
      {details && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, opacity: 0.8 }}>
          {" "}
          ({r.toColumn} = {r.sample.join(", ")}
          {r.missing > r.sample.length ? "…" : ""})
        </span>
      )}
    </div>
  );

  return (
    <div style={{ ...warnBox, display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={warnTitle}>⚠ {t(enforced.length > 0 ? "copyTo.relationsTitle" : "copyTo.looseTitle")}</div>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setDetails((v) => !v)} style={{ background: "none", border: "none", padding: 0, fontSize: 12, color: "inherit", textDecoration: "underline", cursor: "pointer" }}>
          {details ? t("copyTo.hideIds") : t("copyTo.showIds")}
        </button>
      </div>
      {enforced.length > 0 && <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{enforced.map(line)}</div>}
      {loose.length > 0 && (
        <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          {enforced.length > 0 && <div style={{ fontWeight: 500, marginTop: 2 }}>{t("copyTo.looseTitle")}</div>}
          {loose.map(line)}
          <div style={{ fontSize: 12, opacity: 0.85 }}>{t("copyTo.looseHint")}</div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: "10px 11px", background: "#fff", borderRadius: 7, color: "#26241f" }}>
        <label style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 13, cursor: canInclude ? "pointer" : "default", opacity: canInclude ? 1 : 0.55 }}>
          <input type="radio" name="copy-relations" checked={mode === "include"} disabled={!canInclude} onChange={() => onModeChange("include")} />
          <span>
            {t("copyTo.relations.include")}
            <span style={{ display: "block", fontSize: 12, color: "#8b877e", marginTop: 1 }}>
              {analysis.tooMany
                ? t("copyTo.relations.tooMany")
                : extras.length > 0
                  ? extras.map(([table, n]) => `+ ${n.toLocaleString()} ${table}`).join(", ")
                  : t("copyTo.relations.nothingToAdd")}
            </span>
          </span>
        </label>
        <label style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 13, cursor: "pointer" }}>
          <input type="radio" name="copy-relations" checked={mode === "skip"} onChange={() => onModeChange("skip")} />
          <span>
            {t("copyTo.relations.skip")}
            <span style={{ display: "block", fontSize: 12, color: "#8b877e", marginTop: 1 }}>
              {leftOut > 0 ? t("copyTo.relations.skipHint", { count: leftOut }) : t("copyTo.relations.skipLooseHint")}
            </span>
          </span>
        </label>
        {unresolvable > 0 && <div style={{ fontSize: 12, color: "#8b877e" }}>{t("copyTo.relations.unresolvable", { count: unresolvable })}</div>}
      </div>
    </div>
  );
}
