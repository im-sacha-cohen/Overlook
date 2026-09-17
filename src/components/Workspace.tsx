"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api, userHeader } from "@/lib/client/api";
import type { ColumnMeta, Connection, ConnectionInput, LogicalType, QueryResult, Row, RowFilter, RowSort, TableMeta, WriteOp, JournalEntry } from "@/lib/types";
import { ENV_COLORS } from "@/lib/client/env";
import { nowForColumn, toText } from "@/lib/client/format";
import { HistoryEntry, timeNow } from "@/lib/client/history";
import { clearLegacyColumnLayout, orderColumns, readLegacyColumnLayouts } from "@/lib/client/columnLayout";
import { EMPTY_PREFS, type SavedView, type TablePrefs } from "@/lib/prefs";
import { loadOpenTabs, saveOpenTabs } from "@/lib/client/openTabs";
import { TopBar } from "./TopBar";
import { ConnectionTabs, type WorkspaceTab } from "./ConnectionTabs";
import { Sidebar } from "./Sidebar";
import { TableToolbar, type ViewKind } from "./TableToolbar";
import { TableView } from "./views/TableView";
import { BoardView } from "./views/BoardView";
import { GalleryView } from "./views/GalleryView";
import { CalendarView } from "./views/CalendarView";
import { DetailPanel } from "./DetailPanel";
import { RelationTrail, type TrailEntry } from "./RelationTrail";
import { SchemaPanel } from "./SchemaPanel";
import { CsvImportModal } from "./CsvImportModal";
import { SqlImportModal } from "./SqlImportModal";
import { CreateTableModal } from "./CreateTableModal";
import { BulkEditModal } from "./BulkEditModal";
import { JournalPanel } from "./JournalPanel";
import { SchemaDiagram } from "./SchemaDiagram";
import { ConnectionForm } from "./ConnectionForm";
import { ConnectionImportModal } from "./ConnectionTransfer";
import { ProdGuardDialog } from "./ProdGuardDialog";
import { DropTablesDialog } from "./DropTablesDialog";
import { CommandPalette, type CmdItem } from "./CommandPalette";
import { QueryConsole } from "./QueryConsole";
import { EquivalentSqlBar } from "./EquivalentSqlBar";
import { SavedViewsBar } from "./SavedViewsBar";
import { WritePreviewBox } from "./WritePreviewBox";
import { SelectionBar } from "./SelectionBar";
import { Pagination } from "./Pagination";
import { ExportModal, type ExportChoice } from "./ExportModal";
import { ExportProgress, type ExportProgressState } from "./ExportProgress";
import { ImportProgress, type ImportProgressState } from "./ImportProgress";
import { Toast } from "./Toast";
import { SaveIndicator } from "./SaveIndicator";
import { SettingsPanel } from "./SettingsPanel";
import { useLang } from "@/lib/i18n/LanguageProvider";

const VIEW_KINDS: ViewKind[] = ["table", "board", "calendar", "gallery"];
const PAGE_SIZE = 100;
const EMPTY_TABLES: TableMeta[] = [];
const EMPTY_ROWS: Row[] = [];
// How long a connection can take before we offer to cancel.
const SLOW_CONNECTION_MS = 3000;

interface Props {
  initialConnections: Connection[];
  dockerDetected?: boolean;
}

interface PendingGuard {
  label: string;
  /** Receives the typed connection name on production, nothing elsewhere. */
  run: (confirm?: string) => Promise<void>;
  /** The write to preview in the dialog. */
  op?: WriteOp;
  /** Ask for the connection name (production). Defaults to true. */
  requireName?: boolean;
}

let historySeq = 0;

function GridSkeleton() {
  return (
    <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          style={{ height: i === 0 ? 14 : 12, width: `${i === 0 ? 100 : 92 - ((i * 13) % 30)}%`, borderRadius: 6, background: "var(--border-3)", animation: "om-pulse 1.4s ease-in-out infinite", animationDelay: `${i * 0.06}s` }}
        />
      ))}
    </div>
  );
}

export function Workspace({ initialConnections, dockerDetected }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useLang();

  const [connections, setConnections] = useState<Connection[]>(initialConnections);
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(() => {
    const fromUrl = searchParams.get("c");
    if (fromUrl && initialConnections.some((c) => c.id === fromUrl)) return fromUrl;
    return initialConnections[0]?.id ?? null;
  });
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => {
    const active = searchParams.get("c");
    const resolved = active && initialConnections.some((c) => c.id === active) ? active : initialConnections[0]?.id;
    if (!resolved) return [];
    const v = searchParams.get("v");
    return [
      {
        tabId: "main",
        connectionId: resolved,
        table: searchParams.get("t"),
        view: (VIEW_KINDS as string[]).includes(v ?? "") ? (v as ViewKind) : "table",
      },
    ];
  });
  const [activeTabId, setActiveTabId] = useState<string | null>(() => {
    const active = searchParams.get("c");
    const resolved = active && initialConnections.some((c) => c.id === active) ? active : initialConnections[0]?.id;
    return resolved ? "main" : null;
  });
  // Tables and rows are keyed by the connection (and table) they came from, so switching
  // never shows another connection's data, and reopening a tab shows what it had at once.
  const [tablesByConnection, setTablesByConnection] = useState<Record<string, TableMeta[]>>({});
  const [tablesErrors, setTablesErrors] = useState<Record<string, string>>({});
  const [slowConnectionId, setSlowConnectionId] = useState<string | null>(null);
  const tables = (activeConnectionId && tablesByConnection[activeConnectionId]) || EMPTY_TABLES;
  const tablesError = activeConnectionId ? tablesErrors[activeConnectionId] ?? null : null;
  const tablesPending = !!activeConnectionId && !tablesByConnection[activeConnectionId] && !tablesError;
  const tablesByConnectionRef = useRef(tablesByConnection);
  tablesByConnectionRef.current = tablesByConnection;
  const activeConnectionIdRef = useRef(activeConnectionId);
  activeConnectionIdRef.current = activeConnectionId;
  const previousTabIdRef = useRef<string | null>(null);
  const [activeTable, setActiveTable] = useState<string | null>(() => searchParams.get("t"));
  const [hiddenCols, setHiddenCols] = useState<Record<string, Set<string>>>({});

  const [dir, setDir] = useState<"doc" | "query">("doc");
  const [view, setView] = useState<ViewKind>(() => {
    const fromUrl = searchParams.get("v");
    return (VIEW_KINDS as string[]).includes(fromUrl ?? "") ? (fromUrl as ViewKind) : "table";
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const relatedCache = useRef(new Map<string, Row | null>());
  const [relationTrail, setRelationTrail] = useState<TrailEntry[]>([]);
  const [filters, setFilters] = useState<RowFilter[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sorts, setSorts] = useState<RowSort[]>([]);
  const [groupBy, setGroupBy] = useState("");
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState("");
  const [rowsByKey, setRowsByKey] = useState<Record<string, { rows: Row[]; total: number }>>({});
  const rowsKey = activeConnectionId && activeTable ? `${activeConnectionId}\u0000${activeTable}` : null;
  const rowsEntry = rowsKey ? rowsByKey[rowsKey] : undefined;
  const rows = rowsEntry?.rows ?? EMPTY_ROWS;
  const total = rowsEntry?.total ?? 0;
  const [page, setPage] = useState(0);
  const [loadingRows, setLoadingRows] = useState(false);
  const [autoRefreshByConnection, setAutoRefreshByConnection] = useState<Record<string, boolean>>({});
  const rowsRequestSeq = useRef(0);

  // Saved view preferences for the active connection, loaded from the server.
  // Kept in a ref so saving them back doesn't re-trigger the effect that applies them.
  const prefsRef = useRef<{ connectionId: string | null; tables: Record<string, TablePrefs> }>({ connectionId: null, tables: {} });
  const [prefsEpoch, setPrefsEpoch] = useState(0);
  const hydratedKey = useRef<string | null>(null);

  const [editing, setEditing] = useState<{ rowId: string; column: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [detailRow, setDetailRow] = useState<Row | null>(null);

  const [panel, setPanel] = useState<"schema" | "diagram" | "csv" | "sql-import" | "history" | "bulk-edit" | "create-table" | "settings" | null>(null);
  const [connectionFormOpen, setConnectionFormOpen] = useState(false);
  const [importConnectionsOpen, setImportConnectionsOpen] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);

  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState("");

  const [unlockedConnections, setUnlockedConnections] = useState<Set<string>>(new Set());
  const [pendingGuard, setPendingGuard] = useState<PendingGuard | null>(null);
  const [dropTablesRequest, setDropTablesRequest] = useState<string[] | null>(null);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [toast, setToast] = useState("");

  const [saveIndicator, setSaveIndicator] = useState<{ id: number; undo: () => Promise<void> } | null>(null);
  const saveIndicatorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgressState | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);
  const importAbortRef = useRef<AbortController | null>(null);

  const activeConnection = useMemo(() => connections.find((c) => c.id === activeConnectionId) ?? null, [connections, activeConnectionId]);
  const activeTableMeta = useMemo(() => tables.find((t) => t.name === activeTable) ?? null, [tables, activeTable]);
  const columns = useMemo((): ColumnMeta[] => {
    if (!activeTableMeta) return [];
    const hidden = rowsKey ? hiddenCols[rowsKey] : undefined;
    return activeTableMeta.columns.map((c) => ({ ...c, hidden: hidden?.has(c.name) ?? false }));
  }, [activeTableMeta, hiddenCols, rowsKey]);
  const visibleColumns = useMemo(() => columns.filter((c) => !c.hidden), [columns]);
  const orderedVisibleColumns = useMemo(() => orderColumns(visibleColumns, columnOrder), [visibleColumns, columnOrder]);
  const pkColumn = useMemo(() => columns.find((c) => c.isPrimaryKey)?.name ?? null, [columns]);
  const pkColumnRef = useRef(pkColumn);
  pkColumnRef.current = pkColumn;

  useEffect(() => {
    const parts = [activeTable, activeConnection?.name].filter(Boolean) as string[];
    const desired = parts.length ? `${parts.join(" · ")} — Overlook` : "Overlook — éditeur de base de données";
    document.title = desired;
    // Next.js re-syncs <title> from route metadata after each router.replace
    // (used above to persist the active tab in the URL), which replaces the
    // <title> element itself — re-assert our value whenever that happens.
    const observer = new MutationObserver(() => {
      if (document.title !== desired) document.title = desired;
    });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [activeTable, activeConnection]);

  const flash = useCallback((msg: string) => setToast(msg), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  const pushHistory = useCallback((text: string, undo?: () => Promise<void>) => {
    historySeq += 1;
    const entry: HistoryEntry = { id: String(historySeq), time: timeNow(), text, who: `Toi · ${activeTable ?? ""}`, undo };
    setHistory((h) => [entry, ...h].slice(0, 60));
  }, [activeTable]);

  const showSaveIndicator = useCallback((undo: () => Promise<void>) => {
    const id = Date.now();
    setSaveIndicator({ id, undo });
    if (saveIndicatorTimer.current) clearTimeout(saveIndicatorTimer.current);
    saveIndicatorTimer.current = setTimeout(() => {
      setSaveIndicator((cur) => (cur?.id === id ? null : cur));
    }, 3000);
  }, []);

  async function handleRevertSave() {
    if (!saveIndicator) return;
    const { undo } = saveIndicator;
    setSaveIndicator(null);
    if (saveIndicatorTimer.current) clearTimeout(saveIndicatorTimer.current);
    try {
      await undo();
      flash(t("toast.bulkEditUndone"));
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err));
    }
  }

  // ---------- loaders ----------
  // `silent` is the auto-refresh path: no loading state, no error toast, and state
  // is only replaced when the data actually changed, so the screen doesn't move.
  const loadTables = useCallback(async (connectionId: string, { silent = false } = {}) => {
    if (!silent) {
      setSlowConnectionId(null);
      setTablesErrors((prev) => {
        if (!(connectionId in prev)) return prev;
        const next = { ...prev };
        delete next[connectionId];
        return next;
      });
    }
    try {
      const { tables } = await api.listTables(connectionId);
      setTablesByConnection((prev) =>
        JSON.stringify(prev[connectionId]) === JSON.stringify(tables) ? prev : { ...prev, [connectionId]: tables },
      );
      setTablesErrors((prev) => {
        if (!(connectionId in prev)) return prev;
        const next = { ...prev };
        delete next[connectionId];
        return next;
      });
      // The user may have moved to another connection while this was loading.
      if (activeConnectionIdRef.current !== connectionId) return;
      setActiveTable((prev) => (prev && tables.some((t) => t.name === prev) ? prev : tables[0]?.name ?? null));
    } catch (err) {
      if (silent) return;
      const message = err instanceof Error ? err.message : String(err);
      // With tables already on screen, a failed refresh is just a notice; otherwise it replaces the loading screen.
      if (tablesByConnectionRef.current[connectionId]) flash(message);
      else setTablesErrors((prev) => ({ ...prev, [connectionId]: message }));
    }
  }, [flash]);

  const loadRows = useCallback(async ({ silent = false } = {}) => {
    if (!activeConnectionId || !activeTable) return;
    const key = `${activeConnectionId}\u0000${activeTable}`;
    // Drop responses that land after a newer request (table/page/filter changed meanwhile).
    const seq = ++rowsRequestSeq.current;
    if (!silent) setLoadingRows(true);
    try {
      const res = await api.selectRows(activeConnectionId, activeTable, {
        filters,
        sorts,
        search: debouncedSearch,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      if (seq !== rowsRequestSeq.current) return;
      setRowsByKey((prev) => {
        const cur = prev[key];
        if (cur && cur.total === res.total && JSON.stringify(cur.rows) === JSON.stringify(res.rows)) return prev;
        return { ...prev, [key]: { rows: res.rows, total: res.total } };
      });
      if (silent) {
        const pk = pkColumnRef.current;
        if (pk) {
          setDetailRow((d) => {
            if (!d) return d;
            const fresh = res.rows.find((r) => r[pk] === d[pk]);
            return fresh && JSON.stringify(fresh) !== JSON.stringify(d) ? fresh : d;
          });
        }
      }
    } catch (err) {
      if (!silent && seq === rowsRequestSeq.current) {
        flash(err instanceof Error ? err.message : String(err));
        // Leave the loading placeholder for an empty grid rather than spinning forever.
        setRowsByKey((prev) => (prev[key] ? prev : { ...prev, [key]: { rows: [], total: 0 } }));
      }
    } finally {
      if (!silent && seq === rowsRequestSeq.current) setLoadingRows(false);
    }
  }, [activeConnectionId, activeTable, filters, sorts, debouncedSearch, page, flash]);

  useEffect(() => {
    if (activeConnectionId) loadTables(activeConnectionId);
  }, [activeConnectionId, loadTables]);

  // After a few seconds without an answer, say so and offer to go back.
  useEffect(() => {
    if (!tablesPending || !activeConnectionId) return;
    const connectionId = activeConnectionId;
    const id = setTimeout(() => setSlowConnectionId(connectionId), SLOW_CONNECTION_MS);
    return () => clearTimeout(id);
  }, [tablesPending, activeConnectionId]);

  // A connection that failed keeps retrying quietly (e.g. a Docker database still starting);
  // the error screen stays until one attempt succeeds.
  const CONNECTION_RETRY_MS = 10000;
  useEffect(() => {
    if (!tablesError || !activeConnectionId) return;
    const connectionId = activeConnectionId;
    const id = setInterval(() => {
      if (!document.hidden) loadTables(connectionId, { silent: true });
    }, CONNECTION_RETRY_MS);
    return () => clearInterval(id);
  }, [tablesError, activeConnectionId, loadTables]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const autoRefresh = activeConnectionId !== null && (autoRefreshByConnection[activeConnectionId] ?? false);
  const toggleAutoRefresh = useCallback(() => {
    if (!activeConnectionId) return;
    const next = !(autoRefreshByConnection[activeConnectionId] ?? false);
    setAutoRefreshByConnection((prev) => ({ ...prev, [activeConnectionId]: next }));
    api.saveConnectionPrefs(activeConnectionId, { autoRefresh: next }).catch(() => {
      // Best effort: the toggle still applies to this session.
    });
  }, [activeConnectionId, autoRefreshByConnection]);

  const AUTO_REFRESH_INTERVAL_MS = 5000;
  useEffect(() => {
    if (!autoRefresh || !activeConnectionId) return;
    const tick = () => {
      if (document.hidden) return;
      // Skip a tick while the user is typing (inline cell, detail panel field…)
      // so a background refresh doesn't clobber in-progress input.
      const focused = document.activeElement;
      const typing = focused instanceof HTMLTextAreaElement || focused instanceof HTMLSelectElement || (focused instanceof HTMLInputElement && focused.type !== "checkbox");
      if (editing || typing) return;
      loadTables(activeConnectionId, { silent: true });
      loadRows({ silent: true });
    };
    const id = setInterval(tick, AUTO_REFRESH_INTERVAL_MS);
    // Hidden tabs skip ticks; catch up as soon as the tab is shown again.
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [autoRefresh, activeConnectionId, editing, loadTables, loadRows]);

  // ---------- saved view preferences (filters, sorts, layout, auto-refresh) ----------
  useEffect(() => {
    const connectionId = activeConnectionId;
    if (!connectionId) return;
    let cancelled = false;
    (async () => {
      let tables: Record<string, TablePrefs> = {};
      let autoRefreshPref = false;
      try {
        const loaded = await api.getPrefs(connectionId);
        tables = loaded.tables;
        autoRefreshPref = loaded.connection.autoRefresh;
      } catch {
        // Fall back to defaults rather than blocking the workspace.
      }
      // Column layouts older builds left in this browser are moved to the server once.
      for (const [table, layout] of Object.entries(readLegacyColumnLayouts(connectionId))) {
        const base = tables[table] ?? EMPTY_PREFS;
        if (base.columnOrder.length > 0 || Object.keys(base.columnWidths).length > 0) {
          clearLegacyColumnLayout(connectionId, table);
          continue;
        }
        const migrated = { ...base, columnOrder: layout.order, columnWidths: layout.widths };
        tables[table] = migrated;
        // Only drop the browser copy once the server has it.
        api.saveTablePrefs(connectionId, table, migrated).then(() => clearLegacyColumnLayout(connectionId, table)).catch(() => {});
      }
      if (cancelled) return;
      prefsRef.current = { connectionId, tables };
      hydratedKey.current = null;
      setAutoRefreshByConnection((prev) => ({ ...prev, [connectionId]: autoRefreshPref }));
      setPrefsEpoch((n) => n + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeConnectionId]);

  useEffect(() => {
    setEditing(null);
    setSelectedIds(new Set());
    setPage(0);
    // A search is a quick look: it doesn't follow you to another table.
    setSearch("");
    setDebouncedSearch("");
    if (!activeConnectionId || !activeTable || prefsRef.current.connectionId !== activeConnectionId) {
      hydratedKey.current = null;
      return;
    }
    const prefs = prefsRef.current.tables[activeTable] ?? EMPTY_PREFS;
    setSavedViews(prefs.savedViews);
    setActiveViewId(prefs.activeViewId);
    setFilters(prefs.filters);
    setSorts(prefs.sorts);
    setGroupBy(prefs.groupBy);
    setColumnOrder(prefs.columnOrder);
    setColumnWidths(prefs.columnWidths);
    setHiddenCols((prev) => ({ ...prev, [`${activeConnectionId}\u0000${activeTable}`]: new Set(prefs.hiddenColumns) }));
    setView(prefs.view);
    hydratedKey.current = `${activeConnectionId}:${activeTable}`;
  }, [activeConnectionId, activeTable, prefsEpoch]);

  // Save back once the table has been hydrated, so applying prefs can't erase them.
  useEffect(() => {
    if (!activeConnectionId || !activeTable) return;
    if (hydratedKey.current !== `${activeConnectionId}:${activeTable}`) return;
    const prefs: TablePrefs = {
      savedViews,
      activeViewId,
      filters,
      sorts,
      groupBy,
      view,
      columnOrder,
      columnWidths,
      hiddenColumns: [...(hiddenCols[`${activeConnectionId}\u0000${activeTable}`] ?? [])],
    };
    prefsRef.current.tables[activeTable] = prefs;
    const id = setTimeout(() => {
      api.saveTablePrefs(activeConnectionId, activeTable, prefs).catch(() => {
        // Best effort: preferences still apply to this session.
      });
    }, 400);
    return () => clearTimeout(id);
  }, [activeConnectionId, activeTable, savedViews, activeViewId, filters, sorts, groupBy, view, columnOrder, columnWidths, hiddenCols]);

  // ---------- saved views ----------
  const currentViewState = useMemo(
    () => ({ filters, sorts, groupBy, view, hiddenColumns: [...(rowsKey ? hiddenCols[rowsKey] ?? [] : [])].sort() }),
    [filters, sorts, groupBy, view, hiddenCols, rowsKey],
  );
  const activeSavedView = savedViews.find((v) => v.id === activeViewId) ?? null;
  const activeViewDirty = useMemo(() => {
    if (!activeSavedView) return false;
    const v = activeSavedView;
    const saved = { filters: v.filters, sorts: v.sorts, groupBy: v.groupBy, view: v.view, hiddenColumns: [...v.hiddenColumns].sort() };
    return JSON.stringify(saved) !== JSON.stringify(currentViewState);
  }, [activeSavedView, currentViewState]);

  function applyViewState(state: Omit<SavedView, "id" | "name">) {
    setFilters(state.filters);
    setSorts(state.sorts);
    setGroupBy(state.groupBy);
    setView(state.view);
    if (rowsKey) setHiddenCols((prev) => ({ ...prev, [rowsKey]: new Set(state.hiddenColumns) }));
  }

  function applySavedView(id: string) {
    const v = savedViews.find((x) => x.id === id);
    if (!v) return;
    applyViewState(v);
    setActiveViewId(id);
  }

  function clearSavedView() {
    // Back to the plain table: no filter, sort or grouping, every column shown.
    applyViewState({ ...EMPTY_PREFS, hiddenColumns: [] });
    setActiveViewId("");
  }

  function saveNewView(name: string) {
    const id = crypto.randomUUID();
    setSavedViews((prev) => [...prev, { id, name, ...currentViewState }]);
    setActiveViewId(id);
  }

  function updateActiveView() {
    if (!activeViewId) return;
    setSavedViews((prev) => prev.map((v) => (v.id === activeViewId ? { ...v, ...currentViewState } : v)));
  }

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    setPage(0);
  }, [filters, sorts, debouncedSearch]);

  useEffect(() => {
    setHistory([]);
    setDetailRow(null);
    setSelectedTables(new Set());
    setRelationTrail([]);
  }, [activeConnectionId]);

  // ---------- persist current connection/table/view in the URL ----------
  useEffect(() => {
    const params = new URLSearchParams();
    if (activeConnectionId) params.set("c", activeConnectionId);
    if (activeTable) params.set("t", activeTable);
    if (view !== "table") params.set("v", view);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId, activeTable, view, pathname]);

  // ---------- app tabs: restore persisted tabs once on mount, then keep them in sync ----------
  useEffect(() => {
    const stored = loadOpenTabs().filter((t) => initialConnections.some((c) => c.id === t.connectionId));
    if (stored.length > 0) {
      setTabs((prev) => {
        const existingIds = new Set(prev.map((t) => t.tabId));
        const restored = stored
          .filter((t) => !existingIds.has(t.tabId))
          .map((t) => ({ ...t, view: ((VIEW_KINDS as string[]).includes(t.view) ? t.view : "table") as ViewKind }));
        return [...restored, ...prev];
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveOpenTabs(tabs.map(({ tabId, connectionId, table, view }) => ({ tabId, connectionId, table, view })));
  }, [tabs]);

  // keep the active tab's remembered position (table/view/last-open row) in sync as the user browses
  useEffect(() => {
    if (!activeConnectionId || !activeTabId) return;
    const filterColumn = pkColumn && detailRow ? pkColumn : null;
    const filterValue = pkColumn && detailRow && detailRow[pkColumn] !== null && detailRow[pkColumn] !== undefined ? String(detailRow[pkColumn]) : null;
    setTabs((prev) =>
      prev.map((t) => (t.tabId === activeTabId ? { ...t, connectionId: activeConnectionId, table: activeTable, view, filterColumn, filterValue } : t))
    );
  }, [activeConnectionId, activeTabId, activeTable, view, pkColumn, detailRow]);

  // ---------- keyboard shortcut ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
        setCmdQuery("");
      } else if ((e.metaKey || e.ctrlKey) && k === "a") {
        const tag = (document.activeElement?.tagName || "").toLowerCase();
        if (tag !== "input" && tag !== "textarea" && tag !== "select" && view === "table" && dir === "doc" && pkColumn) {
          e.preventDefault();
          setSelectedIds(new Set(rows.map((r) => String(r[pkColumn]))));
        }
      } else if (k === "escape") {
        setCmdOpen(false);
        setPanel(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, dir, pkColumn, rows]);

  // ---------- guard helper ----------
  const runGuarded = useCallback(
    (label: string, action: (confirm?: string) => Promise<void>, op?: WriteOp) => {
      if (activeConnection && activeConnection.envType === "prod") {
        setPendingGuard({ label, op, run: action });
      } else {
        action().catch((err) => flash(err instanceof Error ? err.message : String(err)));
      }
    },
    [activeConnection, flash]
  );

  // Bulk and schema changes: always show the SQL and rows concerned first, and on
  // production also ask for the connection name.
  const confirmWrite = useCallback(
    (label: string, op: WriteOp, action: (confirm?: string) => Promise<void>) => {
      setPendingGuard({ label, op, requireName: activeConnection?.envType === "prod", run: action });
    },
    [activeConnection]
  );

  const isSchemaLocked = activeConnection?.envType === "prod" && !unlockedConnections.has(activeConnection.id);

  // ---------- connection actions ----------
  async function refreshConnections() {
    const { connections } = await api.listConnections();
    setConnections(connections);
    return connections;
  }

  // ---------- app tabs ----------
  function switchToTab(tabId: string) {
    const tab = tabs.find((t) => t.tabId === tabId);
    if (!tab || tabId === activeTabId) return;
    previousTabIdRef.current = activeTabId;
    setActiveTabId(tabId);
    setActiveConnectionId(tab.connectionId);
    setActiveTable(tab.table);
    setView(tab.view);
    setRelationTrail([]);
    if (tab.filterColumn && tab.filterValue !== null && tab.filterValue !== undefined && tab.table) {
      const { connectionId, table, filterColumn, filterValue } = tab;
      api
        .selectRows(connectionId, table, { filters: [{ column: filterColumn, op: "eq", value: filterValue }], limit: 1 })
        .then((res) => setDetailRow(res.rows[0] ?? null))
        .catch(() => setDetailRow(null));
    } else {
      setDetailRow(null);
    }
  }

  function switchToConnection(connectionId: string) {
    const existing = tabs.find((t) => t.connectionId === connectionId);
    if (existing) {
      switchToTab(existing.tabId);
      return;
    }
    const tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setTabs((prev) => [...prev, { tabId, connectionId, table: null, view: "table" as ViewKind }]);
    previousTabIdRef.current = activeTabId;
    setActiveTabId(tabId);
    setActiveConnectionId(connectionId);
    setActiveTable(null);
    setView("table");
    setDetailRow(null);
    setRelationTrail([]);
  }

  function closeTab(tabId: string) {
    setTabs((prev) => prev.filter((t) => t.tabId !== tabId));
    if (tabId !== activeTabId) return;
    const remaining = tabs.filter((t) => t.tabId !== tabId);
    const fallback = remaining[remaining.length - 1] ?? null;
    if (fallback) {
      switchToTab(fallback.tabId);
    } else {
      setActiveTabId(null);
      setActiveConnectionId(null);
      setActiveTable(null);
      setDetailRow(null);
      setRelationTrail([]);
    }
  }

  // "Cancel" on a connection that is still loading: drop its tab and go back where the user was.
  function cancelPendingConnection() {
    if (!activeTabId) return;
    const pendingTabId = activeTabId;
    const previous = previousTabIdRef.current;
    if (previous && previous !== pendingTabId && tabs.some((t) => t.tabId === previous)) {
      switchToTab(previous);
      setTabs((prev) => prev.filter((t) => t.tabId !== pendingTabId));
    } else {
      closeTab(pendingTabId);
    }
  }

  function openRelationInNewTab(col: ColumnMeta, value: unknown) {
    if (!activeConnectionId || !col.references || value === undefined || value === null || value === "") return;
    const tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const connectionId = activeConnectionId;
    const table = col.references.table;
    const filterColumn = col.references.column;
    const filterValue = String(value);
    setTabs((prev) => [...prev, { tabId, connectionId, table, view: "table" as ViewKind }]);
    setActiveTabId(tabId);
    setActiveConnectionId(connectionId);
    setActiveTable(table);
    setView("table");
    setDetailRow(null);
    setRelationTrail([]);
    api
      .selectRows(connectionId, table, { filters: [{ column: filterColumn, op: "eq", value: filterValue }], limit: 1 })
      .then((res) => setDetailRow(res.rows[0] ?? null))
      .catch(() => {});
  }

  async function handleSaveConnection(input: ConnectionInput) {
    if (editingConnectionId) {
      await api.updateConnection(editingConnectionId, input);
      // Settings changed (host, credentials…): what we had loaded may no longer apply.
      if (editingConnectionId === activeConnectionId) loadTables(editingConnectionId);
    } else {
      const { connection } = await api.createConnection(input);
      switchToConnection(connection.id);
    }
    await refreshConnections();
    setConnectionFormOpen(false);
    setEditingConnectionId(null);
    flash(t("toast.connectionSaved"));
  }

  async function forgetConnectionLocally(id: string) {
    const next = await refreshConnections();
    const remainingTabs = tabs.filter((t) => t.connectionId !== id);
    setTabs(remainingTabs);
    if (activeConnectionId === id) {
      const fallback = remainingTabs[remainingTabs.length - 1];
      if (fallback) {
        switchToTab(fallback.tabId);
      } else if (next[0]) {
        switchToConnection(next[0].id);
      } else {
        setActiveTabId(null);
        setActiveConnectionId(null);
        setActiveTable(null);
      }
    }
  }

  async function handleDeleteConnection(id: string) {
    await api.deleteConnection(id);
    await forgetConnectionLocally(id);
    flash(t("toast.connectionDeleted"));
  }

  async function handleDatabaseDropped(id: string) {
    setConnectionFormOpen(false);
    setEditingConnectionId(null);
    await forgetConnectionLocally(id);
    flash(t("toast.databaseDropped"));
  }

  // ---------- row cell interactions ----------
  function handleCellClick(row: Row, col: (typeof columns)[number]) {
    if (!pkColumn) return flash(t("toast.noPrimaryKey"));
    const rowId = String(row[pkColumn]);
    if (col.isPrimaryKey) return;
    if (col.logicalType === "checkbox") {
      const next = !row[col.name];
      commitFieldChange(row, col.name, next);
      return;
    }
    if (col.logicalType === "select" && col.options && col.options.length > 0) {
      const idx = col.options.indexOf(String(row[col.name]));
      const next = col.options[(idx + 1) % col.options.length];
      commitFieldChange(row, col.name, next);
      return;
    }
    setEditing({ rowId, column: col.name });
    setEditValue(toText(row[col.name]));
  }

  function handlePasteCells(updates: { row: Row; values: Row }[]) {
    if (!activeConnectionId || !activeTable || !pkColumn) return flash(t("toast.noPrimaryKey"));
    const connectionId = activeConnectionId;
    const table = activeTable;
    const pk = pkColumn;
    const cells = updates.reduce((n, u) => n + Object.keys(u.values).length, 0);
    const run = async () => {
      const previous = updates.map((u) => ({ id: u.row[pk] as string | number, values: Object.fromEntries(Object.keys(u.values).map((k) => [k, u.row[k]])) }));
      for (const u of updates) await api.updateRow(connectionId, table, u.row[pk] as string | number, pk, u.values);
      const undo = async () => {
        for (const p of previous) await api.updateRow(connectionId, table, p.id, pk, p.values);
        await loadRows();
      };
      pushHistory(t("history.cellsPasted", { count: cells }), undo);
      showSaveIndicator(undo);
      await loadRows();
    };
    // A single cell is an ordinary edit; a block gets a confirmation first.
    if (cells === 1) {
      run().catch((err) => flash(err instanceof Error ? err.message : String(err)));
      return;
    }
    setPendingGuard({
      label: t("guard.pasteCells", { cells, rows: updates.length, table }),
      requireName: activeConnection?.envType === "prod",
      run,
    });
  }

  async function commitFieldChange(row: Row, colName: string, value: unknown) {
    if (!activeConnectionId || !activeTable || !pkColumn) return;
    const rowId = row[pkColumn] as string | number;
    const previous = row[colName];
    try {
      await api.updateRow(activeConnectionId, activeTable, rowId, pkColumn, { [colName]: value });
      const key = `${activeConnectionId}\u0000${activeTable}`;
      setRowsByKey((prev) => {
        const cur = prev[key];
        if (!cur) return prev;
        return { ...prev, [key]: { ...cur, rows: cur.rows.map((r) => (r[pkColumn] === rowId ? { ...r, [colName]: value } : r)) } };
      });
      if (detailRow && detailRow[pkColumn] === rowId) setDetailRow((d) => (d ? { ...d, [colName]: value } : d));
      const undo = async () => {
        await api.updateRow(activeConnectionId, activeTable, rowId, pkColumn, { [colName]: previous });
        await loadRows();
      };
      pushHistory(`${colName} → ${toText(value)}`, undo);
      showSaveIndicator(undo);
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err));
    }
  }

  function handleCellCommit() {
    if (!editing) return;
    const col = columns.find((c) => c.name === editing.column);
    const row = rows.find((r) => pkColumn && String(r[pkColumn]) === editing.rowId);
    // Leaving a cell untouched must not rewrite it (a date or JSON value would round-trip as text).
    if (col && row && editValue !== toText(row[col.name])) {
      const value = col.logicalType === "number" ? (editValue === "" ? null : Number(editValue)) : editValue;
      commitFieldChange(row, col.name, value);
    }
    setEditing(null);
  }

  function handleCellCancel() {
    setEditing(null);
  }

  function defaultRowValues(): Row {
    const row: Row = {};
    columns.forEach((c) => {
      if (c.isPrimaryKey || c.logicalType === "relation") return;
      if (c.logicalType === "checkbox") row[c.name] = false;
      else if (c.logicalType === "number") row[c.name] = 0;
      else if (c.logicalType === "select") row[c.name] = c.options?.[0] ?? "";
      // Dates and JSON have no sensible blank: a nullable column is left out so
      // the column default (or NULL) applies, a NOT NULL one gets a real value.
      else if (c.logicalType === "date") {
        if (!c.nullable) row[c.name] = nowForColumn(c);
      } else if (c.logicalType === "json") {
        if (!c.nullable) row[c.name] = "{}";
      } else row[c.name] = "";
    });
    return row;
  }

  async function handleAddRow(overrides?: Row) {
    if (!activeConnectionId || !activeTable) return;
    try {
      const { row } = await api.insertRow(activeConnectionId, activeTable, { ...defaultRowValues(), ...overrides });
      pushHistory(t("toast.rowCreated"), pkColumn ? async () => {
        await api.deleteRow(activeConnectionId, activeTable, row[pkColumn] as string, pkColumn);
        await loadRows();
      } : undefined);
      await loadRows();
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err));
    }
  }

  function requestDeleteRow(row: Row) {
    if (!activeConnectionId || !activeTable || !pkColumn) return flash(t("toast.noPrimaryKey"));
    const rowId = row[pkColumn] as string | number;
    runGuarded(t("guard.deleteRow", { pk: pkColumn, id: String(rowId), table: activeTable }), async (confirm) => {
      await api.deleteRow(activeConnectionId, activeTable, rowId, pkColumn, confirm);
      pushHistory(t("history.rowDeleted", { id: String(rowId) }), async () => {
        await api.insertRow(activeConnectionId, activeTable, row);
        await loadRows();
      });
      setDetailRow(null);
      await loadRows();
    }, { kind: "deleteRows", table: activeTable, pkColumn, pkValues: [rowId] });
  }

  // ---------- multi-row selection ----------
  function toggleSelect(rowId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  function selectAll(ids: string[]) {
    setSelectedIds(new Set(ids));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  function requestBulkDelete() {
    if (!activeConnectionId || !activeTable || !pkColumn) return flash(t("toast.noPrimaryKey"));
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const deletedRows = rows.filter((r) => ids.includes(String(r[pkColumn])));
    confirmWrite(t("guard.bulkDeleteRows", { count: ids.length, table: activeTable }), { kind: "deleteRows", table: activeTable, pkColumn, pkValues: ids }, async (confirm) => {
      await api.deleteRows(activeConnectionId, activeTable, pkColumn, ids, confirm);
      pushHistory(t("toast.rowsDeleted", { count: ids.length }), async () => {
        for (const r of deletedRows) await api.insertRow(activeConnectionId, activeTable, r);
        await loadRows();
      });
      setSelectedIds(new Set());
      setDetailRow(null);
      await loadRows();
    });
  }

  async function requestBulkEdit(col: ColumnMeta, value: unknown) {
    if (!activeConnectionId || !activeTable || !pkColumn) {
      flash(t("toast.noPrimaryKey"));
      return;
    }
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const previousByRow = new Map(
      rows.filter((r) => ids.includes(String(r[pkColumn]))).map((r) => [String(r[pkColumn]), r[col.name]] as const)
    );
    const finish = async () => {
      pushHistory(t("history.bulkFieldChange", { column: col.name, value: String(value), count: ids.length }), async () => {
        for (const [id, prev] of previousByRow) {
          await api.updateRow(activeConnectionId, activeTable, id, pkColumn, { [col.name]: prev });
        }
        await loadRows();
      });
      setPanel(null);
      flash(t("toast.rowsUpdated", { count: ids.length }));
      await loadRows();
    };
    confirmWrite(
      t("guard.bulkEditField", { column: col.name, count: ids.length, table: activeTable }),
      { kind: "updateRows", table: activeTable, pkColumn, pkValues: ids, values: { [col.name]: value } },
      async (confirm) => {
        await api.updateRows(activeConnectionId, activeTable, pkColumn, ids, { [col.name]: value }, confirm);
        await finish();
      }
    );
  }

  // ---------- export ----------
  function openExportModal() {
    setExportModalOpen(true);
  }

  async function handleStartExport(choice: ExportChoice) {
    if (!activeConnectionId) return;
    setExportModalOpen(false);

    const params = new URLSearchParams();
    params.set("format", choice.format);
    params.set("structure", choice.includeStructure ? "1" : "0");
    params.set("data", choice.includeData ? "1" : "0");
    if (choice.tables.length > 0 && choice.tables.length < tables.length) {
      params.set("tables", choice.tables.map(encodeURIComponent).join(","));
    }

    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExportProgress({ doneRows: 0, totalRows: 0, doneTables: 0, totalTables: 0, status: "running" });

    try {
      const res = await fetch(`/api/connections/${activeConnectionId}/export?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Erreur ${res.status}`);
      }
      const totalRows = Number(res.headers.get("X-Total-Rows") ?? 0);
      const totalTables = Number(res.headers.get("X-Total-Tables") ?? 0);
      setExportProgress({ doneRows: 0, totalRows, doneTables: 0, totalTables, status: "running" });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const chunks: Uint8Array[] = [];
      let buffer = "";
      let doneRows = 0;
      let doneTables = 0;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const sqlMatch = /^-- @@progress table="(.*)" rows=(\d+)$/.exec(line);
          if (sqlMatch) {
            doneRows += Number(sqlMatch[2]);
            doneTables += 1;
          } else if (line.trim().startsWith("{")) {
            try {
              const obj = JSON.parse(line);
              if (obj.type === "table_end") {
                doneRows += obj.rows;
                doneTables += 1;
              }
            } catch {
              // not a progress line, ignore
            }
          }
        }
        setExportProgress({ doneRows, totalRows, doneTables, totalTables, status: "running" });
      }

      const blob = new Blob(chunks as BlobPart[]);
      const match = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "");
      const filename = match ? match[1] : "export";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setExportProgress({ doneRows, totalRows, doneTables, totalTables, status: "done" });
      flash(t("toast.exported"));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setExportProgress(null);
        flash(t("toast.exportCancelled"));
        return;
      }
      setExportProgress((prev) => ({
        doneRows: prev?.doneRows ?? 0,
        totalRows: prev?.totalRows ?? 0,
        doneTables: prev?.doneTables ?? 0,
        totalTables: prev?.totalTables ?? 0,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      exportAbortRef.current = null;
    }
  }

  function cancelExport() {
    exportAbortRef.current?.abort();
  }

  // ---------- SQL import ----------
  async function runImportSql(sql: string, confirm?: string) {
    if (!activeConnectionId) return;
    const controller = new AbortController();
    importAbortRef.current = controller;
    setImportProgress({ done: 0, total: 0, failed: [], status: "running" });

    let done = 0;
    let total = 0;
    let failed: { statement: number; sql: string; message: string }[] = [];
    try {
      const res = await fetch(`/api/connections/${activeConnectionId}/import-sql`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...userHeader() },
        body: JSON.stringify({ sql, confirm }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || t("workspace.errorStatus", { status: res.status }));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === "progress") {
              done = obj.index;
              total = obj.total;
            } else if (obj.type === "done") {
              done = obj.executed + obj.failed.length;
              total = done;
              failed = obj.failed;
            }
          } catch {
            // ignore malformed line
          }
        }
        setImportProgress({ done, total, failed, status: "running" });
      }

      await loadTables(activeConnectionId);
      await loadRows();
      setImportProgress({ done, total, failed, status: "done" });
      if (failed.length === 0) {
        pushHistory(t("history.sqlImported"));
        flash(t("toast.sqlImportedCount", { count: done }));
      } else {
        pushHistory(t("history.sqlImportedWithErrors", { count: failed.length }));
        flash(t("toast.sqlImportedPartial", { ok: done - failed.length, failed: failed.length }));
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setImportProgress(null);
        flash(t("toast.importCancelled"));
        return;
      }
      setImportProgress({ done, total, failed, status: "error", error: err instanceof Error ? err.message : String(err) });
    } finally {
      importAbortRef.current = null;
    }
  }

  function handleImportSql(sql: string) {
    if (!activeConnectionId) return;
    setPanel(null);
    if (activeConnection?.envType === "prod") {
      setPendingGuard({
        label: t("guard.runSqlScript", { connection: activeConnection.name }),
        run: async (confirm) => {
          await runImportSql(sql, confirm);
        },
      });
      return;
    }
    void runImportSql(sql);
  }

  function cancelImport() {
    importAbortRef.current?.abort();
  }

  function toggleSort(colName: string) {
    setSorts((prev) => {
      const ex = prev.find((s) => s.column === colName);
      if (!ex) return [{ column: colName, dir: "asc" }];
      if (ex.dir === "asc") return [{ column: colName, dir: "desc" }];
      return [];
    });
  }

  // ---------- column layout (resize / reorder) ----------
  // Both land in the saved preferences through the effect above.
  function handleResizeColumn(name: string, width: number) {
    setColumnWidths((prev) => ({ ...prev, [name]: width }));
  }

  function handleReorderColumns(newOrder: string[]) {
    setColumnOrder(newOrder);
  }

  // ---------- navigating & previewing relations ----------
  function selectTable(name: string) {
    setActiveTable(name);
    setDetailRow(null);
    setRelationTrail([]);
  }

  const getTableLabelColumn = useCallback(
    (tableName: string): string | null => {
      const meta = tables.find((tb) => tb.name === tableName);
      if (!meta) return null;
      const textCol = meta.columns.find((c) => c.logicalType === "text" && !c.isPrimaryKey);
      return textCol?.name ?? meta.columns[0]?.name ?? null;
    },
    [tables]
  );

  const searchRelation = useCallback(
    async (col: ColumnMeta, query: string): Promise<Row[]> => {
      if (!activeConnectionId || !col.references) return [];
      const labelColumn = getTableLabelColumn(col.references.table) ?? col.references.column;
      try {
        const res = await api.selectRows(activeConnectionId, col.references.table, {
          filters: query.trim() ? [{ column: labelColumn, op: "contains", value: query.trim() }] : [],
          limit: 20,
        });
        return res.rows;
      } catch {
        return [];
      }
    },
    [activeConnectionId, getTableLabelColumn]
  );

  const getRelationLabel = useCallback(
    (col: ColumnMeta, row: Row): string => {
      if (!col.references) return "";
      const labelColumn = getTableLabelColumn(col.references.table);
      const idValue = row[col.references.column];
      if (labelColumn && labelColumn !== col.references.column) {
        const label = row[labelColumn];
        if (label !== undefined && label !== null && String(label) !== "") {
          return idValue !== undefined && idValue !== null ? `${String(label)} — ${String(idValue)}` : String(label);
        }
      }
      return idValue !== undefined && idValue !== null ? String(idValue) : "";
    },
    [getTableLabelColumn]
  );

  async function fetchRelated(col: ColumnMeta, value: unknown): Promise<Row | null> {
    if (!activeConnectionId || !col.references) return null;
    const cacheKey = `${activeConnectionId}:${col.references.table}:${col.references.column}:${String(value)}`;
    if (relatedCache.current.has(cacheKey)) return relatedCache.current.get(cacheKey) ?? null;
    try {
      const res = await api.selectRows(activeConnectionId, col.references.table, {
        filters: [{ column: col.references.column, op: "eq", value: String(value) }],
        limit: 1,
      });
      const row = res.rows[0] ?? null;
      relatedCache.current.set(cacheKey, row);
      return row;
    } catch {
      return null;
    }
  }

  async function handleNavigateRelation(col: ColumnMeta, value: unknown, fromRow?: Row) {
    if (!activeConnectionId || !col.references || value === undefined || value === null || value === "") return;
    try {
      const related = await fetchRelated(col, value);
      if (!related) return flash(t("toast.relatedRowNotFound"));
      if (activeTable) {
        const fromPk = fromRow && pkColumn ? fromRow[pkColumn] : null;
        const label = fromPk !== null && fromPk !== undefined ? `${activeTable} #${String(fromPk)}` : activeTable;
        setRelationTrail((trail) => [
          ...trail,
          {
            table: activeTable,
            view,
            filterColumn: fromPk !== null && fromPk !== undefined && pkColumn ? pkColumn : null,
            filterValue: fromPk !== null && fromPk !== undefined ? String(fromPk) : null,
            label,
          },
        ]);
      }
      setActiveTable(col.references.table);
      setView("table");
      setDetailRow(related);
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err));
    }
  }

  async function goToTrailIndex(index: number) {
    const entry = relationTrail[index];
    if (!entry || !activeConnectionId) return;
    setRelationTrail((trail) => trail.slice(0, index));
    setActiveTable(entry.table);
    setView(entry.view);
    if (entry.filterColumn && entry.filterValue !== null) {
      try {
        const res = await api.selectRows(activeConnectionId, entry.table, {
          filters: [{ column: entry.filterColumn, op: "eq", value: entry.filterValue }],
          limit: 1,
        });
        setDetailRow(res.rows[0] ?? null);
      } catch {
        setDetailRow(null);
      }
    } else {
      setDetailRow(null);
    }
  }

  function clearRelationTrail() {
    setRelationTrail([]);
  }

  // ---------- schema panel ----------
  function requireUnlockedOrGuard(label: string, action: (confirm?: string) => Promise<void>, op?: WriteOp) {
    runGuarded(label, action, op);
  }

  async function handleCreateTable(name: string, tableColumns: { name: string; type: LogicalType }[]) {
    if (!activeConnectionId) return;
    await api.createTable(activeConnectionId, name, tableColumns);
    pushHistory(t("toast.tableCreated", { name }));
    flash(t("toast.tableCreated", { name }));
    setPanel(null);
    await loadTables(activeConnectionId);
    selectTable(name);
  }

  async function handleAddColumn(name: string, type: LogicalType) {
    if (!activeConnectionId || !activeTable) return;
    try {
      await api.addColumn(activeConnectionId, activeTable, name, type);
      pushHistory(t("history.columnAdded", { name, type }));
      flash(t("toast.columnAdded"));
      await loadTables(activeConnectionId);
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err));
    }
  }

  function handleRenameColumn(oldName: string, newName: string) {
    if (!activeConnectionId || !activeTable) return;
    requireUnlockedOrGuard(
      t("guard.renameColumn", { old: oldName, new: newName, table: activeTable }),
      async () => {
        await api.renameColumn(activeConnectionId, activeTable, oldName, newName);
        pushHistory(t("history.columnRenamed", { old: oldName, new: newName }));
        await loadTables(activeConnectionId);
      },
      { kind: "renameColumn", table: activeTable, oldName, newName }
    );
  }

  function handleChangeColumnType(name: string, type: LogicalType) {
    if (!activeConnectionId || !activeTable) return;
    confirmWrite(t("guard.changeColumnType", { name, type, table: activeTable }), { kind: "changeColumnType", table: activeTable, column: name, type }, async (confirm) => {
      await api.changeColumnType(activeConnectionId, activeTable, name, type, confirm);
      pushHistory(t("history.columnTypeChanged", { name, type }));
      await loadTables(activeConnectionId);
      await loadRows();
    });
  }

  function handleDropColumn(name: string) {
    if (!activeConnectionId || !activeTable) return;
    confirmWrite(t("guard.dropColumn", { name, table: activeTable }), { kind: "dropColumn", table: activeTable, column: name }, async (confirm) => {
      await api.dropColumn(activeConnectionId, activeTable, name, confirm);
      pushHistory(t("history.columnDropped", { name }));
      await loadTables(activeConnectionId);
      await loadRows();
    });
  }

  function handleToggleHidden(name: string) {
    if (!rowsKey) return;
    const key = rowsKey;
    setHiddenCols((prev) => {
      const set = new Set(prev[key] ?? []);
      if (set.has(name)) set.delete(name);
      else set.add(name);
      return { ...prev, [key]: set };
    });
  }

  // ---------- multi-table selection ----------
  function toggleTableSelect(name: string) {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function selectTableRange(names: string[], additive: boolean) {
    setSelectedTables((prev) => new Set(additive ? [...prev, ...names] : names));
  }

  function deselectAllTables() {
    setSelectedTables(new Set());
  }

  function selectOnlyTable(name: string) {
    setSelectedTables(new Set([name]));
  }

  function requestBulkDropTables() {
    if (!activeConnectionId || selectedTables.size === 0) return;
    setDropTablesRequest([...selectedTables]);
  }

  async function confirmDropTables(names: string[], { ignoreForeignKeys }: { ignoreForeignKeys: boolean }) {
    if (!activeConnectionId) return;
    const connectionId = activeConnectionId;
    const drop = async (confirm?: string) => {
      await api.dropTables(connectionId, names, { ignoreForeignKeys, confirm });
      pushHistory(`${t("toast.tablesDropped", { count: names.length })} (${names.join(", ")})`);
      setSelectedTables(new Set());
      if (activeTable && names.includes(activeTable)) setActiveTable(null);
      await loadTables(connectionId);
    };
    if (activeConnection?.envType === "prod") {
      // Prod still requires typing the connection name, after the options are chosen.
      setDropTablesRequest(null);
      setPendingGuard({ label: t("guard.bulkDropTables", { count: names.length, names: names.join(", ") }), op: { kind: "dropTables", tables: names, ignoreForeignKeys }, run: drop });
      return;
    }
    // Errors propagate to the dialog, which stays open to show them.
    await drop();
    setDropTablesRequest(null);
    flash(t("toast.tablesDropped", { count: names.length }));
  }

  // ---------- CSV import ----------
  async function handleImportCsv(csvRows: Row[]) {
    if (!activeConnectionId || !activeTable) return;
    const { inserted } = await api.importCsv(activeConnectionId, activeTable, csvRows);
    pushHistory(t("history.csvImported", { count: inserted }));
    flash(t("toast.csvImported", { count: inserted }));
    setPanel(null);
    await loadRows();
  }

  // ---------- change log ----------
  /** Reverses a journal entry after confirmation; resolves true once it's done. */
  function undoJournalEntry(entry: JournalEntry): Promise<boolean> {
    const d = entry.details;
    const table = entry.tableName;
    const pk = d?.pkColumn;
    if (!activeConnectionId || entry.connectionId !== activeConnectionId || !table || !pk || !d) return Promise.resolve(false);
    const connectionId = activeConnectionId;
    const count = entry.action === "insertRow" ? 1 : d.before?.length ?? 0;
    return new Promise<boolean>((resolve) => {
      setPendingGuard({
        label: t("journal.undoConfirm", { action: t(`journal.action.${entry.action}`), table, count }),
        requireName: activeConnection?.envType === "prod",
        run: async (confirm) => {
          if (entry.action === "insertRow") {
            const id = d.after?.[0]?.[pk] as string | number;
            await api.deleteRow(connectionId, table, id, pk, confirm);
          } else if (entry.action === "deleteRows") {
            for (const row of d.before ?? []) await api.insertRow(connectionId, table, row);
          } else {
            for (const row of d.before ?? []) {
              const { [pk]: id, ...values } = row;
              await api.updateRow(connectionId, table, id as string | number, pk, values);
            }
          }
          flash(t("journal.undone"));
          if (table === activeTable) await loadRows();
          resolve(true);
        },
      });
    });
  }

  // ---------- query mode ----------
  async function handleRunQuery(sql: string, allowWrite: boolean): Promise<QueryResult> {
    if (!activeConnectionId) throw new Error(t("error.noActiveConnection"));
    const trimmed = sql.trim().toLowerCase();
    const isSelect = trimmed.startsWith("select") || trimmed.startsWith("with") || trimmed.startsWith("explain") || trimmed.startsWith("pragma") || trimmed.startsWith("show");
    if (!isSelect && activeConnection?.envType === "prod") {
      return new Promise<QueryResult>((resolve, reject) => {
        setPendingGuard({
          label: t("guard.runWriteQuery", { connection: activeConnection.name, sql }),
          run: async (confirm) => {
            try {
              const res = await api.runQuery(activeConnectionId, sql, allowWrite, confirm);
              pushHistory(t("history.queryWrite"));
              resolve(res);
            } catch (err) {
              reject(err);
              throw err;
            }
          },
        });
      });
    }
    const res = await api.runQuery(activeConnectionId, sql, allowWrite);
    if (!isSelect) pushHistory(t("history.queryWrite"));
    return res;
  }

  const equivalentSql = useMemo(() => {
    if (!activeTable) return "";
    const clauses = filters
      .filter((f) => f.value !== "")
      .map((f) => `${f.column} ${f.op === "neq" ? "<>" : f.op === "eq" ? "=" : "ilike"} '${f.op === "contains" ? `%${f.value}%` : f.value}'`);
    const term = debouncedSearch.trim();
    if (term && columns.length > 0) clauses.push(`(${columns.map((c) => `${c.name} ilike '%${term}%'`).join(" or ")})`);
    const where = clauses.join(" and ");
    const order = sorts.map((s) => `${s.column} ${s.dir}`).join(", ");
    return `select ${visibleColumns.map((c) => c.name).join(", ") || "*"} from ${activeTable}${where ? ` where ${where}` : ""}${order ? ` order by ${order}` : ""} limit 200;`;
  }, [activeTable, filters, sorts, debouncedSearch, columns, visibleColumns]);

  // ---------- derived view helpers ----------
  const boardColumn = useMemo(() => {
    const groupCol = columns.find((c) => c.name === groupBy);
    return groupCol ?? columns.find((c) => c.logicalType === "select") ?? undefined;
  }, [columns, groupBy]);
  const dateColumn = useMemo(() => columns.find((c) => c.logicalType === "date"), [columns]);
  const titleColumn = useMemo(() => columns.find((c) => c.logicalType === "text") ?? columns[0], [columns]);
  const tagColumn = useMemo(() => columns.find((c) => c.logicalType === "select"), [columns]);
  const groupByColumnMeta = useMemo(() => columns.find((c) => c.name === groupBy), [columns, groupBy]);

  // ---------- command palette ----------
  const cmdItems: CmdItem[] = useMemo(() => {
    const items: CmdItem[] = [];
    tables.forEach((tbl) => items.push({ icon: "▦", label: t("cmdPalette.goTo", { table: tbl.name }), hint: tbl.name, onRun: () => { selectTable(tbl.name); setCmdOpen(false); } }));
    (
      [
        ["table", t("toolbar.table")],
        ["board", t("toolbar.board")],
        ["calendar", t("toolbar.calendar")],
        ["gallery", t("toolbar.gallery")],
      ] as [ViewKind, string][]
    ).forEach(([v, l]) => items.push({ icon: "◫", label: `${t("cmdPalette.view")} ${l}`, hint: t("cmdPalette.view"), onRun: () => { setView(v); setCmdOpen(false); } }));
    items.push({ icon: "⌗", label: t("cmdPalette.openSchema"), hint: t("cmdPalette.schemaTag"), onRun: () => { setPanel("schema"); setCmdOpen(false); } });
    items.push({ icon: "↧", label: t("cmdPalette.importCsv"), hint: t("cmdPalette.importTag"), onRun: () => { setPanel("csv"); setCmdOpen(false); } });
    items.push({ icon: "+", label: t("cmdPalette.newTable"), hint: t("cmdPalette.tableTagShort"), onRun: () => { setPanel("create-table"); setCmdOpen(false); } });
    items.push({ icon: "↺", label: t("sidebar.history"), hint: t("cmdPalette.historyTag"), onRun: () => { setPanel("history"); setCmdOpen(false); } });
    items.push({ icon: "+", label: t("toolbar.newRow"), hint: t("cmdPalette.newRowHint"), onRun: () => { handleAddRow(); setCmdOpen(false); } });
    items.push({ icon: dir === "query" ? "◇" : "◆", label: dir === "query" ? t("cmdPalette.toDocMode") : t("cmdPalette.toQueryMode"), hint: t("cmdPalette.modeTag"), onRun: () => { setDir((d) => (d === "doc" ? "query" : "doc")); setCmdOpen(false); } });
    if (!cmdQuery) return items.slice(0, 8);
    const q = cmdQuery.toLowerCase();
    return items.filter((c) => c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q)).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, dir, cmdQuery]);

  // ---------- empty states ----------
  if (connections.length === 0) {
    return (
      <div style={{ height: "100vh", display: "grid", placeItems: "center", fontFamily: "var(--font-sans)" }}>
        <div style={{ textAlign: "center", maxWidth: 380 }}>
          <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>{t("workspace.noConnectionTitle")}</div>
          <div style={{ fontSize: 13.5, color: "#8b877e", marginBottom: 18 }}>
            {t("workspace.connectFirstDb")}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => setConnectionFormOpen(true)}
              style={{ padding: "9px 16px", background: "var(--accent)", border: "1px solid var(--accent-hover)", borderRadius: 8, color: "#fff", fontWeight: 500, cursor: "pointer" }}
            >
              {t("connBadge.newConnection")}
            </button>
            <button
              onClick={() => setImportConnectionsOpen(true)}
              style={{ padding: "9px 16px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 8, color: "#4b473f", cursor: "pointer" }}
            >
              {t("connTransfer.importFromWelcome")}
            </button>
          </div>
        </div>
        {connectionFormOpen && <ConnectionForm onSave={handleSaveConnection} onClose={() => setConnectionFormOpen(false)} dockerDetected={dockerDetected} />}
        {importConnectionsOpen && (
          <ConnectionImportModal
            existing={connections}
            onClose={() => setImportConnectionsOpen(false)}
            onDone={async (created) => {
              setImportConnectionsOpen(false);
              await refreshConnections();
              // Land straight in the first imported connection rather than an empty workspace.
              if (created[0]) switchToConnection(created[0].id);
            }}
          />
        )}
      </div>
    );
  }

  const envStripColor = activeConnection ? ENV_COLORS[activeConnection.envType].strong : "transparent";

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--fg)", background: "var(--bg)", overflow: "hidden" }}>
      <div style={{ height: 4, flex: "none", background: envStripColor }} />

      <ConnectionTabs
        tabs={tabs}
        connections={connections}
        activeTabId={activeTabId}
        onSwitch={switchToTab}
        onClose={closeTab}
      />

      <TopBar
        connections={connections}
        activeConnection={activeConnection}
        onSwitchConnection={switchToConnection}
        onAddConnection={() => { setEditingConnectionId(null); setConnectionFormOpen(true); }}
        onEditConnection={(id) => { setEditingConnectionId(id); setConnectionFormOpen(true); }}
        onDeleteConnection={handleDeleteConnection}
        tableLabel={activeTable ?? ""}
        rowCountLabel={activeTable ? `${rows.length}/${total}` : ""}
        dir={dir}
        onSetDir={setDir}
        onOpenCmd={() => { setCmdOpen(true); setCmdQuery(""); }}
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={toggleAutoRefresh}
      />

      {dir === "query" && activeTable && <EquivalentSqlBar sql={equivalentSql} />}

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <Sidebar
          tables={tables}
          status={tablesError ? "error" : tablesPending ? "loading" : "ready"}
          activeTable={activeTable}
          showColumns={dir === "query"}
          onSelectTable={selectTable}
          onOpenSchema={() => setPanel("schema")}
          onOpenDiagram={() => setPanel("diagram")}
          onOpenCsv={() => setPanel("csv")}
          onOpenSqlImport={() => setPanel("sql-import")}
          onOpenHistory={() => setPanel("history")}
          onExport={openExportModal}
          selectedTables={selectedTables}
          onToggleTableSelect={toggleTableSelect}
          onSelectOnlyTable={selectOnlyTable}
          onSelectTableRange={selectTableRange}
          onDeselectAllTables={deselectAllTables}
          onBulkDropTables={requestBulkDropTables}
          onExportSelectedTables={openExportModal}
          onOpenCreateTable={() => setPanel("create-table")}
          onOpenSettings={() => setPanel("settings")}
        />

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {!activeConnectionId ? (
            <div style={{ flex: 1, display: "grid", placeItems: "center", color: "#a8a39a", fontSize: 13.5 }}>
              {t("empty.noConnection")}
            </div>
          ) : tablesError ? (
            <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 32 }}>
              <div style={{ textAlign: "center", maxWidth: 440 }}>
                <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
                  {t("connLoad.errorTitle", { name: activeConnection?.name ?? "" })}
                </div>
                <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 18, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{tablesError}</div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                  <button
                    onClick={() => loadTables(activeConnectionId)}
                    style={{ padding: "8px 14px", background: "var(--accent)", border: "1px solid var(--accent-hover)", borderRadius: 8, color: "#fff", fontWeight: 500, cursor: "pointer" }}
                  >
                    {t("connLoad.retry")}
                  </button>
                  <button
                    onClick={() => { setEditingConnectionId(activeConnectionId); setConnectionFormOpen(true); }}
                    style={{ padding: "8px 14px", background: "transparent", border: "1px solid var(--border-3)", borderRadius: 8, color: "var(--fg)", cursor: "pointer" }}
                  >
                    {t("connLoad.editConnection")}
                  </button>
                </div>
              </div>
            </div>
          ) : tablesPending ? (
            <div style={{ flex: 1, minHeight: 0, padding: "26px 32px 0", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13.5, color: "var(--muted)" }}>
                <span>{slowConnectionId === activeConnectionId ? t("connLoad.slow") : t("connLoad.connecting", { name: activeConnection?.name ?? "" })}</span>
                {slowConnectionId === activeConnectionId && (
                  <button
                    onClick={cancelPendingConnection}
                    style={{ padding: "4px 10px", background: "transparent", border: "1px solid var(--border-3)", borderRadius: 7, color: "var(--fg)", fontSize: 12.5, cursor: "pointer" }}
                  >
                    {t("common.cancel")}
                  </button>
                )}
              </div>
              <GridSkeleton />
            </div>
          ) : !activeTable ? (
            <div style={{ flex: 1, display: "grid", placeItems: "center", color: "#a8a39a", fontSize: 13.5 }}>{t("empty.noTable")}</div>
          ) : dir === "query" ? (
            <div style={{ flex: 1, minHeight: 0, padding: "18px 32px 32px" }}>
              <QueryConsole key={activeConnectionId} connectionId={activeConnectionId} onRun={handleRunQuery} />
            </div>
          ) : (
            <>
              <div style={{ flex: "none", padding: "26px 32px 0" }}>
                <RelationTrail trail={relationTrail} currentTable={activeTable} onJump={goToTrailIndex} onClear={clearRelationTrail} />
                <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                  <div style={{ fontSize: 27, fontWeight: 600, letterSpacing: "-0.02em" }}>{activeTable}</div>
                  {!pkColumn && <div style={{ fontSize: 12.5, color: "var(--env-prod-fg)" }}>Aucune clé primaire — édition désactivée</div>}
                </div>
                <SavedViewsBar
                  views={savedViews}
                  activeViewId={activeViewId}
                  dirty={activeViewDirty}
                  onApply={applySavedView}
                  onClear={clearSavedView}
                  onSaveNew={saveNewView}
                  onUpdate={updateActiveView}
                  onRename={(id, name) => setSavedViews((prev) => prev.map((v) => (v.id === id ? { ...v, name } : v)))}
                  onDelete={(id) => {
                    setSavedViews((prev) => prev.filter((v) => v.id !== id));
                    if (id === activeViewId) setActiveViewId("");
                  }}
                />
                <TableToolbar
                  view={view}
                  onSetView={setView}
                  columns={columns}
                  groupBy={groupBy}
                  onSetGroupBy={setGroupBy}
                  filters={filters}
                  onFiltersChange={setFilters}
                  sorts={sorts}
                  onSortsChange={setSorts}
                  search={search}
                  onSearchChange={setSearch}
                  onAddRow={() => handleAddRow()}
                />
              </div>

              <div className="om-sb" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 32px 60px" }}>
                {loadingRows && rowsEntry && <div style={{ color: "#a8a39a", fontSize: 13, paddingBottom: 10 }}>{t("common.loading")}</div>}
                {!rowsEntry && <GridSkeleton />}
                {rowsEntry && view === "table" && (
                  <TableView
                    columns={orderedVisibleColumns}
                    rows={rows}
                    pkColumn={pkColumn}
                    groupByColumn={groupByColumnMeta}
                    editing={editing}
                    editValue={editValue}
                    onEditValueChange={setEditValue}
                    onCellClick={handleCellClick}
                    onCellCommit={handleCellCommit}
                    onCellCancel={handleCellCancel}
                    onRowOpen={setDetailRow}
                    onAddRow={() => handleAddRow()}
                    sorts={sorts}
                    onToggleSort={toggleSort}
                    onOpenSchema={() => setPanel("schema")}
                    selectedIds={selectedIds}
                    onToggleSelect={toggleSelect}
                    onSelectAll={selectAll}
                    onDeselectAll={deselectAll}
                    columnWidths={columnWidths}
                    onResizeColumn={handleResizeColumn}
                    onReorderColumns={handleReorderColumns}
                    onNavigateRelation={handleNavigateRelation}
                    onFetchRelated={fetchRelated}
                    onOpenRelationInNewTab={openRelationInNewTab}
                    onSearchRelation={searchRelation}
                    getRelationLabel={getRelationLabel}
                    onEditRelation={(row, col, value) => commitFieldChange(row, col.name, value)}
                    onEditDate={(row, col, value) => commitFieldChange(row, col.name, value)}
                    onPasteCells={handlePasteCells}
                    onCellsCopied={(count) => flash(t("toast.cellsCopied", { count }))}
                  />
                )}
                {rowsEntry && view === "board" && (
                  <BoardView
                    columns={visibleColumns}
                    rows={rows}
                    boardColumn={boardColumn}
                    onRowOpen={setDetailRow}
                    onAddCard={(groupValue) => handleAddRow(boardColumn ? { [boardColumn.name]: groupValue } : undefined)}
                  />
                )}
                {rowsEntry && view === "gallery" && <GalleryView columns={visibleColumns} rows={rows} onRowOpen={setDetailRow} />}
                {rowsEntry && view === "calendar" && <CalendarView rows={rows} dateColumn={dateColumn} titleColumn={titleColumn} tagColumn={tagColumn} onRowOpen={setDetailRow} />}
              </div>
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
            </>
          )}
        </div>

        {detailRow && activeTable && (
          <DetailPanel
            row={detailRow}
            columns={columns}
            pkColumn={pkColumn}
            tableName={activeTable}
            onFieldCommit={(col, value) => commitFieldChange(detailRow, col.name, value)}
            onClose={() => setDetailRow(null)}
            onDelete={() => requestDeleteRow(detailRow)}
            recentHistory={history.slice(0, 3)}
            onSearchRelation={searchRelation}
            getRelationLabel={getRelationLabel}
          />
        )}
      </div>

      {panel === "schema" && activeTableMeta && (
        <SchemaPanel
          table={{ ...activeTableMeta, columns }}
          locked={!!isSchemaLocked}
          onUnlock={() => activeConnection && setUnlockedConnections((s) => new Set(s).add(activeConnection.id))}
          onRenameColumn={handleRenameColumn}
          onChangeColumnType={handleChangeColumnType}
          onToggleHidden={handleToggleHidden}
          onAddColumn={handleAddColumn}
          onDropColumn={handleDropColumn}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === "csv" && activeTable && (
        <CsvImportModal tableName={activeTable} columns={columns} onImport={handleImportCsv} onClose={() => setPanel(null)} />
      )}

      {panel === "sql-import" && activeConnection && (
        <SqlImportModal connectionName={activeConnection.name} onImport={handleImportSql} onClose={() => setPanel(null)} />
      )}

      {panel === "create-table" && activeConnection && (
        <CreateTableModal connectionName={activeConnection.name} onCreate={handleCreateTable} onClose={() => setPanel(null)} />
      )}

      {panel === "settings" && (
        <SettingsPanel
          connections={connections}
          onClose={() => setPanel(null)}
          onConnectionsExported={(count) => {
            setPanel(null);
            flash(t("toast.connectionsExported", { count }));
          }}
          onConnectionsImported={async (created) => {
            setPanel(null);
            flash(t("toast.connectionsImported", { count: created.length }));
            await refreshConnections();
          }}
        />
      )}

      {panel === "diagram" && activeConnectionId && (
        <SchemaDiagram
          connectionId={activeConnectionId}
          tables={tables}
          onOpenTable={(name) => {
            setPanel(null);
            selectTable(name);
          }}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === "history" && (
        <JournalPanel connectionId={activeConnectionId} tables={tables.map((tbl) => tbl.name)} onClose={() => setPanel(null)} onUndo={undoJournalEntry} />
      )}

      {connectionFormOpen && (
        <ConnectionForm
          initial={editingConnectionId ? connections.find((c) => c.id === editingConnectionId) : undefined}
          onSave={handleSaveConnection}
          onClose={() => { setConnectionFormOpen(false); setEditingConnectionId(null); }}
          onDatabaseDropped={() => editingConnectionId && handleDatabaseDropped(editingConnectionId)}
          dockerDetected={dockerDetected}
        />
      )}

      {cmdOpen && <CommandPalette query={cmdQuery} onQueryChange={setCmdQuery} items={cmdItems} onClose={() => setCmdOpen(false)} />}

      {dropTablesRequest && activeConnection && (
        <DropTablesDialog
          names={dropTablesRequest}
          engine={activeConnection.engine}
          connectionId={activeConnection.id}
          onConfirm={(options) => confirmDropTables(dropTablesRequest, options)}
          onCancel={() => setDropTablesRequest(null)}
        />
      )}
      {pendingGuard && activeConnection && (
        <ProdGuardDialog
          connectionName={activeConnection.name}
          actionLabel={pendingGuard.label}
          requireName={pendingGuard.requireName ?? true}
          danger={pendingGuard.op && ["deleteRows", "dropColumn", "dropTables"].includes(pendingGuard.op.kind)}
          details={pendingGuard.op && <WritePreviewBox connectionId={activeConnection.id} op={pendingGuard.op} />}
          onConfirm={async () => {
            await pendingGuard.run((pendingGuard.requireName ?? true) ? activeConnection.name : undefined);
            setPendingGuard(null);
          }}
          onCancel={() => setPendingGuard(null)}
        />
      )}

      <SelectionBar count={selectedIds.size} onClear={deselectAll} onDelete={requestBulkDelete} onEdit={() => setPanel("bulk-edit")} />

      {panel === "bulk-edit" && (
        <BulkEditModal
          count={selectedIds.size}
          columns={columns}
          onApply={requestBulkEdit}
          onClose={() => setPanel(null)}
        />
      )}

      {exportModalOpen && activeConnection && (
        <ExportModal
          connectionName={activeConnection.name}
          tables={tables}
          initialSelected={[...selectedTables]}
          onExport={handleStartExport}
          onClose={() => setExportModalOpen(false)}
        />
      )}

      {exportProgress && <ExportProgress state={exportProgress} onCancel={cancelExport} onDismiss={() => setExportProgress(null)} />}
      {importProgress && <ImportProgress state={importProgress} onCancel={cancelImport} onDismiss={() => setImportProgress(null)} />}

      <Toast message={toast} />
      <SaveIndicator
        visible={!!saveIndicator}
        label={t("toast.saved")}
        revertLabel={t("detailPanel.undo")}
        onRevert={handleRevertSave}
      />
    </div>
  );
}
