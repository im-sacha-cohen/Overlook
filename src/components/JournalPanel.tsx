"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { JournalAction, JournalEntry } from "@/lib/types";
import { api, type JournalFilters } from "@/lib/client/api";
import { toText } from "@/lib/client/format";
import { useLang } from "@/lib/i18n/LanguageProvider";

const PAGE = 100;

const ACTIONS: JournalAction[] = [
  "insertRow",
  "updateRow",
  "updateRows",
  "deleteRows",
  "importRows",
  "createTable",
  "dropTables",
  "emptyTables",
  "addColumn",
  "renameColumn",
  "changeColumnType",
  "dropColumn",
  "query",
  "sqlScript",
  "dropDatabase",
];

/** Entries the journal holds enough to reverse. */
export function canUndoJournalEntry(e: JournalEntry): boolean {
  if (e.error || !e.tableName || !e.details?.pkColumn || e.details.truncated) return false;
  if (e.action === "updateRow" || e.action === "updateRows" || e.action === "deleteRows") return (e.details.before?.length ?? 0) > 0;
  if (e.action === "insertRow") return e.details.after?.[0]?.[e.details.pkColumn] !== undefined;
  return false;
}

interface Props {
  connectionId: string | null;
  tables: string[];
  onClose: () => void;
  onUndo: (entry: JournalEntry) => Promise<boolean>;
}

const field: React.CSSProperties = {
  height: 28,
  padding: "0 8px",
  border: "1px solid #e8e5df",
  borderRadius: 7,
  background: "#fff",
  fontSize: 12.5,
  color: "var(--fg)",
  minWidth: 0,
};

export function JournalPanel({ connectionId, tables, onClose, onUndo }: Props) {
  const { t, lang } = useLang();
  const [allConnections, setAllConnections] = useState(false);
  const [table, setTable] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const filters = useMemo<JournalFilters>(
    () => ({
      connectionId: allConnections ? undefined : connectionId ?? undefined,
      table: allConnections ? undefined : table || undefined,
      action: action || undefined,
      // Dates are picked as local days: widen them to cover the whole day.
      from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
      search: debouncedSearch.trim() || undefined,
    }),
    [allConnections, connectionId, table, action, from, to, debouncedSearch],
  );

  const load = useCallback(
    async (beforeId?: number) => {
      setLoading(true);
      setError(null);
      try {
        const { entries: page } = await api.listJournal({ ...filters, beforeId });
        setEntries((prev) => (beforeId ? [...prev, ...page] : page));
        setHasMore(page.length >= PAGE);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    load();
  }, [load]);

  const dateFormat = new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-US", { dateStyle: "short", timeStyle: "medium" });

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(35,31,24,0.14)", display: "flex", justifyContent: "flex-end", zIndex: 45, animation: "om-fade 0.12s ease" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 560, maxWidth: "100vw", background: "#fff", borderLeft: "1px solid #e5e2db", display: "flex", flexDirection: "column", animation: "om-pop 0.16s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "15px 20px", borderBottom: "1px solid #f2f0ea" }}>
          <div style={{ fontWeight: 600 }}>{t("journal.title")}</div>
          <div style={{ flex: 1 }} />
          <a
            href={api.journalExportUrl(filters)}
            download
            style={{ padding: "4px 10px", border: "1px solid #e8e5df", borderRadius: 7, fontSize: 12.5, color: "#4b473f", textDecoration: "none" }}
          >
            {t("journal.exportCsv")}
          </a>
          <button onClick={onClose} style={{ width: 26, height: 26, background: "transparent", border: "none", borderRadius: 6, color: "#8b877e", cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <div style={{ padding: "12px 20px", borderBottom: "1px solid #f2f0ea", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("journal.searchPlaceholder")} style={{ ...field, gridColumn: "1 / -1" }} />
          <select value={allConnections ? "all" : "this"} onChange={(e) => setAllConnections(e.target.value === "all")} style={field}>
            <option value="this">{t("journal.thisConnection")}</option>
            <option value="all">{t("journal.allConnections")}</option>
          </select>
          <select value={table} onChange={(e) => setTable(e.target.value)} disabled={allConnections} style={field}>
            <option value="">{t("journal.allTables")}</option>
            {tables.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select value={action} onChange={(e) => setAction(e.target.value)} style={{ ...field, gridColumn: "1 / -1" }}>
            <option value="">{t("journal.allActions")}</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {t(`journal.action.${a}`)}
              </option>
            ))}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#8b877e" }}>
            {t("journal.from")}
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ ...field, flex: 1 }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#8b877e" }}>
            {t("journal.to")}
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ ...field, flex: 1 }} />
          </label>
        </div>

        <div className="om-sb" style={{ flex: 1, overflowY: "auto", padding: "4px 20px 40px" }}>
          {error && <div style={{ padding: "12px 0", fontSize: 12.5, color: "var(--env-prod-fg)" }}>{error}</div>}
          {!loading && !error && entries.length === 0 && <div style={{ padding: "18px 0", fontSize: 13, color: "#a8a39a" }}>{t("journal.empty")}</div>}
          {entries.map((e) => {
            const expanded = open === e.id;
            return (
              <div key={e.id} style={{ padding: "10px 0", borderBottom: "1px solid #f5f3ee" }}>
                <div onClick={() => setOpen(expanded ? null : e.id)} style={{ display: "flex", gap: 10, cursor: "pointer" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 500 }}>{t(`journal.action.${e.action}`)}</span>
                      {e.tableName && <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "#6f6b62" }}>{e.tableName}</span>}
                      {e.rows !== null && <span style={{ fontSize: 12, color: "#8b877e" }}>· {t("journal.rows", { count: e.rows })}</span>}
                      {e.error && <span style={{ fontSize: 11.5, padding: "1px 6px", borderRadius: 5, background: "var(--env-prod-bg)", color: "var(--env-prod-fg)" }}>{t("journal.failed")}</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: "#a8a39a", marginTop: 2 }}>
                      {dateFormat.format(new Date(e.at))}
                      {allConnections && ` · ${e.connectionName}`}
                      {` · ${e.actor ?? t("journal.anonymous")}`}
                      {e.ip && ` · ${e.ip}`}
                    </div>
                  </div>
                  {canUndoJournalEntry(e) && e.connectionId === connectionId && (
                    <button
                      onClick={async (ev) => {
                        ev.stopPropagation();
                        if (await onUndo(e)) load();
                      }}
                      style={{ alignSelf: "flex-start", padding: "3px 8px", background: "#fff", border: "1px solid #eceae4", borderRadius: 6, fontSize: 12, color: "#8b877e", cursor: "pointer" }}
                    >
                      {t("history.undo")}
                    </button>
                  )}
                </div>
                {expanded && (
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                    {e.error && <div style={{ fontSize: 12.5, color: "var(--env-prod-fg)" }}>{e.error}</div>}
                    {e.sql && (
                      <pre className="om-sb" style={{ margin: 0, maxHeight: 200, overflow: "auto", padding: "8px 10px", background: "#faf9f6", border: "1px solid #f0eee9", borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 11.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {e.sql}
                      </pre>
                    )}
                    {e.details?.before && e.details.before.length > 0 && (e.action === "updateRow" || e.action === "updateRows") && (
                      <ChangeTable before={e.details.before} after={e.details.after?.[0]} pkColumn={e.details.pkColumn} />
                    )}
                    {e.details?.truncated && <div style={{ fontSize: 11.5, color: "#a8a39a" }}>{t("journal.truncated")}</div>}
                  </div>
                )}
              </div>
            );
          })}
          {hasMore && (
            <button
              onClick={() => load(entries[entries.length - 1]?.id)}
              disabled={loading}
              style={{ marginTop: 12, width: "100%", padding: "8px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 8, fontSize: 12.5, color: "#4b473f", cursor: "pointer" }}
            >
              {loading ? t("common.loading") : t("journal.loadMore")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ChangeTable({ before, after, pkColumn }: { before: Record<string, unknown>[]; after?: Record<string, unknown>; pkColumn?: string }) {
  const { t } = useLang();
  const columns = [...new Set(before.flatMap((r) => Object.keys(r)))].filter((c) => c !== pkColumn);
  return (
    <div className="om-sb" style={{ maxHeight: 200, overflow: "auto", border: "1px solid #f0eee9", borderRadius: 8 }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "#faf9f6" }}>
            {pkColumn && <th style={cellHead}>{pkColumn}</th>}
            {columns.map((c) => (
              <th key={c} style={cellHead}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {before.slice(0, 50).map((row, i) => (
            <tr key={i} style={{ borderTop: "1px solid #f5f3ee" }}>
              {pkColumn && <td style={cell}>{toText(row[pkColumn])}</td>}
              {columns.map((c) => (
                <td key={c} style={cell}>
                  <span style={{ color: "#a8a39a", textDecoration: "line-through" }}>{row[c] === null ? "null" : toText(row[c])}</span>
                  {after && c in after && <span> → {after[c] === null ? "null" : toText(after[c])}</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {before.length > 50 && <div style={{ padding: "4px 8px", fontSize: 11.5, color: "#a8a39a" }}>{t("journal.moreRows", { count: before.length - 50 })}</div>}
    </div>
  );
}

const cellHead: React.CSSProperties = { textAlign: "left", padding: "5px 8px", fontFamily: "var(--font-mono)", fontWeight: 500, color: "#6f6b62" };
const cell: React.CSSProperties = { padding: "5px 8px", whiteSpace: "nowrap" };
