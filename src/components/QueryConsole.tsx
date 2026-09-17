"use client";

import { useCallback, useEffect, useState } from "react";
import type { QueryHistoryEntry, QueryResult, SavedQuery } from "@/lib/types";
import { toText } from "@/lib/client/format";
import { api } from "@/lib/client/api";
import { useLang } from "@/lib/i18n/LanguageProvider";

interface Props {
  connectionId: string;
  onRun: (sql: string, allowWrite: boolean) => Promise<QueryResult>;
}

const smallBtn: React.CSSProperties = {
  padding: "6px 11px",
  background: "transparent",
  border: "1px solid var(--border-3)",
  borderRadius: 8,
  color: "var(--fg)",
  fontSize: 12.5,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const sectionTitle: React.CSSProperties = {
  padding: "0 8px 6px",
  fontSize: 11.5,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#a8a39a",
  fontWeight: 600,
};

export function QueryConsole({ connectionId, onRun }: Props) {
  const { t, lang } = useLang();
  const [sql, setSql] = useState("SELECT * FROM ");
  const [allowWrite, setAllowWrite] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  // The saved query currently open in the editor, if any.
  const [current, setCurrent] = useState<SavedQuery | null>(null);
  // Non-null while the "name this query" field is shown.
  const [naming, setNaming] = useState<string | null>(null);

  const refreshHistory = useCallback(() => {
    api.listQueryHistory(connectionId).then((r) => setHistory(r.entries)).catch(() => {});
  }, [connectionId]);

  useEffect(() => {
    api.listSavedQueries(connectionId).then((r) => setSaved(r.queries)).catch(() => {});
    refreshHistory();
  }, [connectionId, refreshHistory]);

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      const res = await onRun(sql, allowWrite);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
      refreshHistory();
    }
  }

  async function saveAs(name: string) {
    if (!name.trim() || !sql.trim()) return;
    try {
      const { query } = await api.createSavedQuery(connectionId, name, sql);
      setSaved((prev) => [...prev, query].sort((a, b) => a.name.localeCompare(b.name)));
      setCurrent(query);
      setNaming(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveCurrent() {
    if (!current) return;
    try {
      const { query } = await api.updateSavedQuery(connectionId, current.id, current.name, sql);
      setSaved((prev) => prev.map((q) => (q.id === query.id ? query : q)));
      setCurrent(query);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function removeSaved(query: SavedQuery) {
    if (!window.confirm(t("queryConsole.confirmDelete", { name: query.name }))) return;
    try {
      await api.deleteSavedQuery(connectionId, query.id);
      setSaved((prev) => prev.filter((q) => q.id !== query.id));
      if (current?.id === query.id) setCurrent(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function openSql(text: string, query: SavedQuery | null) {
    setSql(text);
    setCurrent(query);
    setNaming(null);
  }

  const dirty = current !== null && current.sql !== sql;
  const timeFormat = new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-US", { dateStyle: "short", timeStyle: "short" });

  return (
    <div style={{ display: "flex", gap: 20, height: "100%" }}>
      <div className="om-sb" style={{ width: 230, flex: "none", overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <div style={sectionTitle}>{t("queryConsole.saved")}</div>
          {saved.length === 0 && <div style={{ padding: "2px 8px", fontSize: 12.5, color: "#a8a39a" }}>{t("queryConsole.noSaved")}</div>}
          {saved.map((q) => (
            <div
              key={q.id}
              onClick={() => openSql(q.sql, q)}
              title={q.sql}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 7, cursor: "pointer", fontSize: 13, background: current?.id === q.id ? "#f4f2ed" : "transparent" }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeSaved(q);
                }}
                title={t("common.delete")}
                style={{ width: 18, height: 18, display: "grid", placeItems: "center", background: "transparent", border: "none", color: "#a8a39a", cursor: "pointer", fontSize: 11 }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div>
          <div style={sectionTitle}>{t("queryConsole.history")}</div>
          {history.length === 0 && <div style={{ padding: "2px 8px", fontSize: 12.5, color: "#a8a39a" }}>{t("queryConsole.noHistory")}</div>}
          {history.map((h) => (
            <div
              key={h.id}
              onClick={() => openSql(h.sql, null)}
              title={h.error ?? h.sql}
              style={{ padding: "6px 8px", borderRadius: 7, cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f7f6f2")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: h.error ? "var(--env-prod-fg)" : "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {h.sql.replace(/\s+/g, " ")}
              </div>
              <div style={{ fontSize: 10.5, color: "#a8a39a", marginTop: 2 }}>
                {timeFormat.format(new Date(h.ranAt))} · {h.error ? t("queryConsole.failed") : t("queryConsole.rows", { count: h.rowCount ?? 0 })} · {h.durationMs} ms
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
      {current && (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          {current.name}
          {dirty && <span style={{ marginLeft: 6 }}>· {t("queryConsole.modified")}</span>}
        </div>
      )}
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        spellCheck={false}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleRun();
        }}
        style={{
          height: 140,
          resize: "vertical",
          border: "1px solid #e8e5df",
          borderRadius: 10,
          padding: "12px 14px",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          lineHeight: 1.7,
          outline: "none",
          background: "#fff",
        }}
      />
      <div style={{ display: "flex", flexWrap: "wrap", rowGap: 8, alignItems: "center", gap: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#6f6b62", whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={allowWrite} onChange={(e) => setAllowWrite(e.target.checked)} />
          {t("queryConsole.allowWrite")}
        </label>
        <div style={{ flex: 1 }} />
        {naming !== null ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveAs(naming);
            }}
            style={{ display: "flex", gap: 6 }}
          >
            <input
              autoFocus
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setNaming(null);
              }}
              placeholder={t("queryConsole.namePlaceholder")}
              style={{ ...smallBtn, width: 180, cursor: "text", outline: "none", background: "#fff" }}
            />
            <button type="submit" style={smallBtn} disabled={!naming.trim()}>
              {t("common.save")}
            </button>
          </form>
        ) : (
          <>
            {dirty && (
              <button onClick={saveCurrent} style={smallBtn}>
                {t("common.save")}
              </button>
            )}
            <button onClick={() => setNaming(current ? `${current.name} (2)` : "")} style={smallBtn}>
              {current ? t("queryConsole.saveAs") : t("queryConsole.save")}
            </button>
          </>
        )}
        <div style={{ fontSize: 11.5, color: "#a8a39a", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{t("queryConsole.cmdEnterToRun")}</div>
        <button
          onClick={handleRun}
          disabled={running}
          style={{ padding: "7px 14px", background: "var(--accent)", border: "1px solid var(--accent-hover)", borderRadius: 8, color: "#fff", fontWeight: 500, cursor: "pointer" }}
        >
          {running ? t("queryConsole.running") : t("queryConsole.run")}
        </button>
      </div>
      {error && (
        <div style={{ padding: "10px 12px", background: "var(--env-prod-bg)", border: "1px solid var(--env-prod-border)", borderRadius: 9, fontSize: 12.5, color: "var(--env-prod-fg)" }}>
          {error}
        </div>
      )}
      {result && (
        <div className="om-sb" style={{ flex: 1, minHeight: 0, overflow: "auto", border: "1px solid #eceae4", borderRadius: 10 }}>
          {result.columns.length === 0 ? (
            <div style={{ padding: 14, fontSize: 13, color: "#6f6b62" }}>{t("queryConsole.rowsAffected", { count: result.rowCount })}</div>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
              <thead>
                <tr style={{ position: "sticky", top: 0, background: "#f7f6f2" }}>
                  {result.columns.map((c) => (
                    <th key={c} style={{ textAlign: "left", padding: "7px 10px", fontFamily: "var(--font-mono)", fontWeight: 500, color: "#6f6b62", borderBottom: "1px solid #eceae4" }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f4f2ed" }}>
                    {result.columns.map((c) => (
                      <td key={c} style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>
                        {r[c] === null || r[c] === undefined ? <span style={{ color: "#c2bdb3" }}>null</span> : toText(r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
