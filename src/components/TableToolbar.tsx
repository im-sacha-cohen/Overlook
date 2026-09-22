"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnMeta, FilterGroup, FilterMatch, Row, RowFilter, RowQuery, RowSort, TableMeta } from "@/lib/types";
import { useLang } from "@/lib/i18n/LanguageProvider";
import { Combobox, MultiCombobox, type ComboOption } from "./Combobox";
import { EquivalentSqlBar } from "./EquivalentSqlBar";
import { DateField } from "./DateField";
import { Hint, Kbd } from "./Hint";
import { opNeedsValue, opsFor } from "@/lib/db/where";

export type ViewKind = "table" | "board" | "calendar" | "gallery";

interface Props {
  view: ViewKind;
  onSetView: (v: ViewKind) => void;
  columns: ColumnMeta[];
  groupBy: string;
  onSetGroupBy: (col: string) => void;
  filters: RowFilter[];
  onFiltersChange: (f: RowFilter[]) => void;
  filterMatch: FilterMatch;
  onFilterMatchChange: (m: FilterMatch) => void;
  filterGroups: FilterGroup[];
  onFilterGroupsChange: (g: FilterGroup[]) => void;
  sorts: RowSort[];
  onSortsChange: (s: RowSort[]) => void;
  search: string;
  onSearchChange: (s: string) => void;
  onAddRow: () => void;
  /** Columns and types of the table on screen. */
  onOpenSchema: () => void;
  /** The statement the current view runs, shown on demand. */
  sql: string;
  /** Rows of the table a foreign key points to, matching what was typed. */
  onSuggestRelation: (col: ColumnMeta, query: string) => Promise<Row[]>;
  getRelationLabel: (col: ColumnMeta, row: Row) => string;
  /** Most frequent values of a column matching what was typed. */
  /** Rows the view would show with these filters (the one being edited included). */
  onCountRows: (filters: RowFilter[]) => Promise<number>;
  /** `table`: where the column lives, when it is reached through a foreign key. */
  onSuggestValues: (column: string, query: string, options: { via?: string[]; within: RowQuery }) => Promise<{ value: string; count: number; id?: string }[]>;
  /** Every table of the connection, to filter on columns of related tables. */
  tables: TableMeta[];
  /** The table on screen. */
  tableName: string;
  /** False while a dialog or panel covers the table, so its keys don't reach the toolbar. */
  shortcutsEnabled: boolean;
}

// A filter value with suggestions fetched for what was typed; any value can still be entered.
// With `preview`, the typed value comes first with the number of rows it would leave.
// Opening lists every value; typing narrows the list and puts the typed text first.
function SuggestedFilterValue({ value, placeholder, onChange, load, preview }: {
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  load: (query: string) => Promise<ComboOption[]>;
  preview?: (value: string) => Promise<ComboOption | null>;
}) {
  const [options, setOptions] = useState<ComboOption[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  // The loaders close over the other filters: keep the latest without refetching on every render.
  const fns = useRef({ load, preview });
  useEffect(() => {
    fns.current = { load, preview };
  });
  useEffect(() => {
    if (query === null) return;
    let stale = false;
    const timer = setTimeout(() => {
      const { load, preview } = fns.current;
      Promise.all([load(query), query.trim() && preview ? preview(query) : Promise.resolve(null)]).then(([o, first]) => {
        if (!stale) setOptions(first ? [first, ...o.filter((x) => x.value !== first.value)] : o);
      });
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);
  return <Combobox value={value} allowCustom filterOptions={false} width={130} options={options} placeholder={placeholder} onChange={onChange} onQueryChange={setQuery} />;
}

const smallBtn: React.CSSProperties = {
  flex: "none",
  whiteSpace: "nowrap",
  minHeight: 27,
  padding: "0 9px",
  background: "#fff",
  border: "1px solid #e8e5df",
  borderRadius: 7,
  color: "#4b473f",
  fontSize: 12.5,
  cursor: "pointer",
};

// Same icons on the buttons and on the chips they create, so "filter" and "sort" read apart.
function FilterIcon() {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" style={{ flex: "none" }}>
      <path d="M2.5 3.5h11l-4.2 5v4.3l-2.6-1.3v-3z" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
      <path d="M5 13V3M2.5 5.5 5 3l2.5 2.5M11 3v10M8.5 10.5 11 13l2.5-2.5" />
    </svg>
  );
}

function CountBadge({ n }: { n: number }) {
  if (n === 0) return null;
  return <span style={{ minWidth: 16, height: 16, padding: "0 4px", borderRadius: 8, background: "var(--accent)", color: "#fff", fontSize: 10.5, fontWeight: 600, display: "inline-grid", placeItems: "center" }}>{n}</span>;
}

// Columns whose repeated values (roles, statuses stored as text…) are worth suggesting.
const SUGGESTED_TYPES: ColumnMeta["logicalType"][] = ["text", "json", "unknown"];

export function TableToolbar({ view, onSetView, columns, groupBy, onSetGroupBy, filters, onFiltersChange, filterMatch, onFilterMatchChange, filterGroups, onFilterGroupsChange, sorts, onSortsChange, search, onSearchChange, onAddRow, onOpenSchema, sql, onSuggestRelation, getRelationLabel, onSuggestValues, shortcutsEnabled, tables, tableName, onCountRows }: Props) {
  const { t, lang } = useLang();
  const searchRef = useRef<HTMLInputElement>(null);
  const rowsLabel = useCallback(
    (n: number) => t(n === 1 ? "toolbar.rows_one" : "toolbar.rows_other", { count: n.toLocaleString(lang === "fr" ? "fr-FR" : "en-US") }),
    [t, lang]
  );
  // The filter/sort just added opens its column picker straight away.
  const [showSql, setShowSql] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [justAdded, setJustAdded] = useState<{ kind: "filter" | "sort"; index: number } | null>(null);

  const selectableCols = columns.filter((c) => !c.hidden);
  const groupableCols = columns.filter((c) => c.logicalType === "select" || c.logicalType === "checkbox");
  const VIEWS: [ViewKind, string][] = [
    ["table", t("toolbar.table")],
    ["board", t("toolbar.board")],
    ["calendar", t("toolbar.calendar")],
    ["gallery", t("toolbar.gallery")],
  ];
  // Filters can also test a column of the table a foreign key points to: "dossier › public_id".
  const tableByName = useMemo(() => new Map(tables.map((tb) => [tb.name, tb])), [tables]);
  const filterKey = (f: Pick<RowFilter, "column" | "via">) => [...(f.via ?? []), f.column].join(">");
  const parseKey = (key: string): Pick<RowFilter, "column" | "via"> => {
    const parts = key.split(">");
    const column = parts.pop()!;
    return parts.length ? { column, via: parts } : { column };
  };
  const resolveCol = (f: Pick<RowFilter, "column" | "via">): ColumnMeta | undefined => {
    if (!f.via?.length) return selectableCols.find((c) => c.name === f.column);
    let cols: ColumnMeta[] = columns;
    for (const fk of f.via) {
      const ref = cols.find((c) => c.name === fk)?.references?.table;
      const tb = ref ? tableByName.get(ref) : undefined;
      if (!tb) return undefined;
      cols = tb.columns;
    }
    return cols.find((c) => c.name === f.column);
  };
  const columnOptions = selectableCols.map((c) => ({ value: c.name, hint: c.nativeType }));
  const filterColumnOptions = useMemo((): ComboOption[] => {
    const own = columns.filter((c) => !c.hidden).map((c) => ({ value: c.name, hint: c.nativeType }));
    // A key back to this same table (parent_id…) isn't a related table: its columns are already listed.
    const fks = columns.filter((c) => c.references && c.references.table !== tableName && tableByName.has(c.references.table));
    const related = fks.flatMap((fk) => {
      const tb = tableByName.get(fk.references!.table)!;
      // Two keys to the same table (client_id, affaire_id → client) say which one.
      const twin = fks.filter((o) => o.references!.table === tb.name).length > 1;
      const prefix = twin ? `${tb.name} (${fk.name})` : tb.name;
      return tb.columns.map((c) => ({ value: `${fk.name}>${c.name}`, label: `↗ ${prefix} › ${c.name}`, hint: c.nativeType }));
    });
    return [...own, ...related];
  }, [columns, tableByName, tableName]);
  const opLabel = (op: RowFilter["op"], col?: ColumnMeta): string => {
    const isDate = col?.logicalType === "date";
    switch (op) {
      case "eq": return t("toolbar.opEq");
      case "neq": return t("toolbar.opNeq");
      case "in": return t(col?.logicalType === "json" ? "toolbar.opHasAny" : "toolbar.opIn");
      case "notIn": return t(col?.logicalType === "json" ? "toolbar.opHasNone" : "toolbar.opNotIn");
      case "contains": return t("toolbar.opContains");
      case "notContains": return t("toolbar.opNotContains");
      case "gt": return t(isDate ? "toolbar.opAfter" : "toolbar.opGt");
      case "lt": return t(isDate ? "toolbar.opBefore" : "toolbar.opLt");
      case "between": return t("toolbar.opBetween");
      case "empty": return t("toolbar.opEmpty");
      case "notEmpty": return t("toolbar.opNotEmpty");
    }
  };
  const loadRelation = useCallback(
    async (col: ColumnMeta, q: string): Promise<ComboOption[]> => {
      const refCol = col.references?.column ?? "";
      return (await onSuggestRelation(col, q))
        .filter((r) => r[refCol] !== null && r[refCol] !== undefined)
        .map((r) => {
          const key = String(r[refCol]);
          const label = getRelationLabel(col, r);
          return { value: key, label: label.endsWith(` — ${key}`) ? label.slice(0, -key.length - 3) : label, hint: t("toolbar.hintId", { id: key }) };
        });
    },
    [onSuggestRelation, getRelationLabel, t]
  );
  // Counts are taken among the rows the other filters keep, so they are the rows you'd see.
  // Under "any", or inside a group, other filters don't simply narrow: count on the search alone.
  const withinFor = (i: number): RowQuery =>
    filterMatch === "all" && !filters[i].group ? { filters: filters.filter((_, j) => j !== i), filterGroups, search } : { search };
  const hintFor = (count: number | undefined, id?: string) => [count === undefined ? null : rowsLabel(count), id ? t("toolbar.hintId", { id }) : null].filter(Boolean).join(" · ");
  const loadValuesFor = (i: number) => async (q: string): Promise<ComboOption[]> => {
    const f = filters[i];
    return (await onSuggestValues(f.column, q, { via: f.via, within: withinFor(i) })).map((v) => ({ value: v.value, hint: hintFor(v.count, v.id) }));
  };
  // A foreign key: the related rows by label, with how many rows point at each.
  const loadRelationFor = (i: number, col: ColumnMeta) => async (q: string): Promise<ComboOption[]> => {
    const f = filters[i];
    const [related, counts] = await Promise.all([loadRelation(col, q), onSuggestValues(f.column, "", { via: f.via, within: withinFor(i) }).catch(() => [])]);
    const byKey = new Map(counts.map((c) => [c.value, c.count]));
    return related.map((o) => ({ ...o, hint: hintFor(byKey.get(o.value) ?? 0, o.value) }));
  };
  // Suggestions for "is one of": the column's own options, foreign keys or frequent values.
  const loadChoicesFor = (i: number, col: ColumnMeta) => async (q: string): Promise<ComboOption[]> => {
    if (col.options?.length) return col.options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase())).map((o) => ({ value: o }));
    if (col.references) return loadRelationFor(i, col)(q);
    return loadValuesFor(i)(q);
  };
  // Columns with a known set of values (roles in JSON, statuses, foreign keys) start on
  // the multi-select; free text starts on "contains".
  const defaultOp = (col?: ColumnMeta): RowFilter["op"] => {
    if (col && (col.logicalType === "json" || col.options?.length || col.references)) return "in";
    return opsFor(col?.logicalType).includes("contains") ? "contains" : "eq";
  };
  // "« tech » — 12 lignes": what the view would show with this value, before picking it.
  const previewFor = (i: number) => async (value: string): Promise<ComboOption | null> => {
    const f = filters[i];
    try {
      const n = await onCountRows(filters.map((x, j) => (j === i ? { ...x, value, disabled: false } : x)));
      return { value, label: `${opLabel(f.op, resolveCol(f))} « ${value} »`, hint: rowsLabel(n) };
    } catch {
      return null;
    }
  };
  const newFilter = (col?: ColumnMeta): RowFilter => ({ column: col?.name ?? "", op: defaultOp(col), value: "", values: [] });
  const updateFilter = (i: number, patch: Partial<RowFilter>) => onFiltersChange(filters.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setOp = (i: number, op: RowFilter["op"]) => {
    const f = filters[i];
    // "is" → "is one of" keeps the value typed so far, and back.
    if ((op === "in" || op === "notIn") && !(f.values?.length) && f.value) updateFilter(i, { op, values: [f.value] });
    else if ((f.op === "in" || f.op === "notIn") && op !== "in" && op !== "notIn" && !f.value && f.values?.length) updateFilter(i, { op, value: f.values[0] });
    else updateFilter(i, { op });
  };
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const day = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  // Quick ranges for date filters: they switch the filter to "between".
  const datePresets = (i: number) => {
    const today = new Date();
    const between = (from: Date, to: Date) => () => updateFilter(i, { op: "between", value: day(from), value2: day(to) });
    return [
      { label: t("toolbar.presetLast7"), onPick: between(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6), today) },
      { label: t("toolbar.presetThisMonth"), onPick: between(new Date(today.getFullYear(), today.getMonth(), 1), new Date(today.getFullYear(), today.getMonth() + 1, 0)) },
    ];
  };
  // A day covers the whole day; datetime columns can narrow it down to a minute.
  const dateInput = (col: ColumnMeta, value: string, placeholder: string, onChange: (v: string) => void, presets?: { label: string; onPick: () => void }[]) => (
    <div style={{ width: col.nativeType.trim().toLowerCase() === "date" ? 118 : 150, flex: "none" }}>
      <DateField
        column={col}
        optionalTime
        presets={presets}
        value={value}
        placeholder={placeholder}
        onCommit={(v) => onChange(v ?? "")}
        triggerStyle={{ height: 22, padding: "0 7px", fontSize: 12.5, border: "1px solid transparent", borderRadius: 5 }}
      />
    </div>
  );
  const valueStyle: React.CSSProperties = { width: 110, height: 22, border: "1px solid transparent", background: "#fff", borderRadius: 5, padding: "0 7px", fontSize: 12.5, color: "#26241f", outline: "none", fontFamily: "inherit" };

  const addFilter = (group?: string) => {
    setJustAdded({ kind: "filter", index: filters.length });
    onFiltersChange([...filters, { ...newFilter(selectableCols[0]), ...(group ? { group } : {}) }]);
  };
  const addGroup = () => {
    const id = crypto.randomUUID().slice(0, 8);
    onFilterGroupsChange([...filterGroups, { id, match: "any" }]);
    addFilter(id);
  };
  const removeFilter = (i: number) => {
    const next = filters.filter((_, j) => j !== i);
    onFiltersChange(next);
    // A group goes away with its last condition.
    const used = new Set(next.map((f) => f.group).filter(Boolean));
    if (filterGroups.some((g) => !used.has(g.id))) onFilterGroupsChange(filterGroups.filter((g) => used.has(g.id)));
  };
  const addSort = () => {
    setJustAdded({ kind: "sort", index: sorts.length });
    onSortsChange([...sorts, { column: selectableCols[0]?.name ?? "", dir: "asc" }]);
  };
  const clearAll = () => {
    onFiltersChange([]);
    onFilterGroupsChange([]);
    onSortsChange([]);
    onFilterMatchChange("all");
  };

  // Shortcuts outside text fields: "/" search, F filter, S sort, ⇧⌫ clear filters and sorts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!shortcutsEnabled || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable)) return;
      const key = e.key.toLowerCase();
      if (key === "/") searchRef.current?.focus();
      else if (key === "f" && !e.shiftKey) addFilter();
      else if (key === "g" && !e.shiftKey) addGroup();
      else if (key === "s" && !e.shiftKey) addSort();
      else if (key === "backspace" && e.shiftKey && (filters.length > 0 || sorts.length > 0)) clearAll();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Top-level items in filter order: a lone filter, or a group where its first filter is.
  const knownGroups = new Set(filterGroups.map((g) => g.id));
  const topItems: { group?: string; indexes: number[] }[] = [];
  filters.forEach((f, i) => {
    if (f.group && knownGroups.has(f.group)) {
      const existing = topItems.find((it) => it.group === f.group);
      if (existing) existing.indexes.push(i);
      else topItems.push({ group: f.group, indexes: [i] });
    } else topItems.push({ indexes: [i] });
  });
  const groupMatchOf = (id: string): FilterMatch => filterGroups.find((g) => g.id === id)?.match ?? "all";
  const connectorFor = (m: FilterMatch) => (
    <span style={{ fontSize: 11.5, fontWeight: 600, color: "oklch(0.55 0.08 250)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{m === "any" ? t("toolbar.or") : t("toolbar.and")}</span>
  );
  const matchPicker = (value: FilterMatch, onChange: (m: FilterMatch) => void) => (
    <Combobox
      value={value}
      width={value === "any" ? 116 : 80}
      options={[
        { value: "all", label: t("toolbar.matchAll") },
        { value: "any", label: t("toolbar.matchAny") },
      ]}
      onChange={(v) => onChange(v === "any" ? "any" : "all")}
      inputStyle={{ border: "1px solid var(--accent-border)", fontWeight: 500 }}
    />
  );
  const chipFor = (i: number) => {
    const f = filters[i];
    const col = resolveCol(f);
    const columnLabel = filterColumnOptions.find((o) => o.value === filterKey(f))?.label ?? f.column;
    return (
    <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, height: 28, padding: "0 4px 0 6px", background: f.disabled ? "#f6f4ef" : "var(--accent-bg)", border: `1px ${f.disabled ? "dashed #d9d5cc" : "solid var(--accent-border)"}`, borderRadius: 8, fontSize: 12.5 }}>
      <Hint label={f.disabled ? t("toolbar.enableFilter") : t("toolbar.disableFilter")}>
        <button
          role="switch"
          aria-checked={!f.disabled}
          onClick={() => updateFilter(i, { disabled: !f.disabled })}
          style={{ position: "relative", width: 22, height: 13, padding: 0, border: "none", borderRadius: 7, background: f.disabled ? "#d6d2c9" : "var(--accent)", cursor: "pointer", transition: "background 0.12s ease" }}
        >
          <span style={{ position: "absolute", top: 2, left: f.disabled ? 2 : 11, width: 9, height: 9, borderRadius: "50%", background: "#fff", transition: "left 0.12s ease" }} />
        </button>
      </Hint>
      <span style={{ display: "contents" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: f.disabled ? "#a8a39a" : "oklch(0.5 0.1 250)", fontWeight: 500, opacity: f.disabled ? 0.7 : 1 }}>
        <FilterIcon />
        {t("toolbar.where")}
      </span>
      <Combobox
        value={filterKey(f)}
        options={filterColumnOptions}
        width={Math.min(230, Math.max(120, columnLabel.length * 7 + 30))}
        autoFocus={justAdded?.kind === "filter" && justAdded.index === i}
        ariaLabel={t("combobox.column")}
        onChange={(v) => {
          const target = parseKey(v);
          const next = resolveCol(target);
          // Same kind of column: keep operator and values. Otherwise start over, a "3" is not a date.
          const sameKind = next?.logicalType === col?.logicalType && !!next?.references === !!col?.references;
          updateFilter(i, sameKind ? { ...target, via: target.via } : { ...newFilter(next), ...target, via: target.via, value2: undefined });
        }}
      />
      <Combobox
        value={f.op}
        width={Math.max(96, opLabel(f.op, col).length * 7 + 30)}
        options={opsFor(col?.logicalType).map((op) => ({ value: op, label: opLabel(op, col) }))}
        onChange={(v) => setOp(i, v as RowFilter["op"])}
      />
      {opNeedsValue(f.op) &&
        (col && (f.op === "in" || f.op === "notIn") ? (
          <MultiCombobox values={f.values ?? []} onChange={(values) => updateFilter(i, { values })} load={loadChoicesFor(i, col)} placeholder={t("toolbar.valuesPlaceholder")} />
        ) : col?.references && (f.op === "eq" || f.op === "neq") ? (
          <SuggestedFilterValue value={f.value} placeholder={t("toolbar.valuePlaceholder")} onChange={(v) => updateFilter(i, { value: v })} load={loadRelationFor(i, col)} preview={previewFor(i)} />
        ) : col && !col.options?.length && SUGGESTED_TYPES.includes(col.logicalType) ? (
          <SuggestedFilterValue value={f.value} placeholder={t("toolbar.valuePlaceholder")} onChange={(v) => updateFilter(i, { value: v })} load={loadValuesFor(i)} preview={previewFor(i)} />
        ) : col?.options?.length ? (
          // A fixed set of values (statuses…) gets suggestions; anything else is a plain field.
          <Combobox value={f.value} allowCustom width={110} options={col.options.map((o) => ({ value: o }))} placeholder={t("toolbar.valuePlaceholder")} onChange={(v) => updateFilter(i, { value: v })} />
        ) : col?.logicalType === "date" ? (
          dateInput(col, f.value, f.op === "between" ? t("toolbar.fromPlaceholder") : t("toolbar.valuePlaceholder"), (v) => updateFilter(i, { value: v }), datePresets(i))
        ) : (
          <input
            type={col?.logicalType === "number" ? "number" : "text"}
            value={f.value}
            onChange={(e) => updateFilter(i, { value: e.target.value })}
            placeholder={f.op === "between" ? t("toolbar.fromPlaceholder") : t("toolbar.valuePlaceholder")}
            style={valueStyle}
          />
        ))}
      {f.op === "between" && (
        <>
          <span style={{ color: "#6f6b62" }}>{t("toolbar.and")}</span>
          {col?.logicalType === "date" ? (
            dateInput(col, f.value2 ?? "", t("toolbar.toPlaceholder"), (v) => updateFilter(i, { value2: v }), datePresets(i))
          ) : (
            <input
              type={col?.logicalType === "number" ? "number" : "text"}
              value={f.value2 ?? ""}
              onChange={(e) => updateFilter(i, { value2: e.target.value })}
              placeholder={t("toolbar.toPlaceholder")}
              style={valueStyle}
            />
          )}
        </>
      )}
      </span>
      <button
        onClick={() => removeFilter(i)}
        style={{ width: 20, height: 20, display: "grid", placeItems: "center", background: "transparent", border: "none", borderRadius: 5, color: "#9a958b", cursor: "pointer" }}
      >
        ×
      </button>
    </div>
    );
  };

  return (
    <div className="om-toolbar">
      <div className="om-toolbar-row" style={{ display: "flex", flexWrap: "nowrap", rowGap: 8, alignItems: "center", gap: 4, marginTop: 16, borderBottom: "1px solid var(--border)" }}>
        {VIEWS.map(([v, label]) => (
          <button
            key={v}
            onClick={() => onSetView(v)}
            style={{
              flex: "none",
              padding: "7px 11px",
              marginBottom: -1,
              background: "transparent",
              border: "none",
              borderBottom: `2px solid ${view === v ? "#26241f" : "transparent"}`,
              color: view === v ? "#26241f" : "#8b877e",
              fontWeight: view === v ? 600 : 400,
              fontSize: 13.5,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
        <div className="om-toolbar-actions" style={{ display: "flex", flex: "1 1 0", minWidth: 0, flexWrap: "nowrap", justifyContent: "flex-end", marginLeft: "auto", alignItems: "center", gap: 6, paddingBottom: 6 }}>
          <div style={{ position: "relative", flex: "0 1 190px", minWidth: 120 }}>
            <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "#a8a39a", fontSize: 12, pointerEvents: "none" }}>⌕</span>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  onSearchChange("");
                  e.currentTarget.blur();
                }
              }}
              placeholder={t("toolbar.searchPlaceholder")}
              title={t("toolbar.searchHint")}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              style={{ ...smallBtn, width: "100%", height: 27, padding: "0 22px 0 24px", cursor: "text", outline: "none", boxSizing: "border-box" }}
            />
            {!search && !searchFocused && (
              <span aria-hidden style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <Kbd>/</Kbd>
              </span>
            )}
            {search && (
              <button
                onClick={() => onSearchChange("")}
                aria-label={t("common.close")}
                style={{ position: "absolute", right: 3, top: "50%", transform: "translateY(-50%)", width: 20, height: 20, display: "grid", placeItems: "center", background: "transparent", border: "none", color: "#9a958b", cursor: "pointer" }}
              >
                ×
              </button>
            )}
          </div>
          <Combobox
            value={groupBy}
            width={120}
            options={[{ value: "", label: t("toolbar.noGroup") }, ...groupableCols.map((c) => ({ value: c.name, label: t("toolbar.groupBy", { column: c.name }) }))]}
            onChange={onSetGroupBy}
            inputStyle={{ height: 27, border: "1px solid #e8e5df", borderRadius: 7, color: "#4b473f" }}
          />
          <Hint label={t("toolbar.addFilterHint")} keys={["F"]}>
            <button
              style={{ ...smallBtn, display: "inline-flex", alignItems: "center", gap: 5 }}
              onClick={() => addFilter()}
            >
              <FilterIcon />
              {t("toolbar.addFilter")}
              <CountBadge n={filters.length} />
            </button>
          </Hint>
          <Hint label={t("toolbar.addSortHint")} keys={["S"]}>
            <button
              style={{ ...smallBtn, display: "inline-flex", alignItems: "center", gap: 5 }}
              onClick={addSort}
            >
              <SortIcon />
              {t("toolbar.addSort")}
              <CountBadge n={sorts.length} />
            </button>
          </Hint>
          <button style={{ ...smallBtn, display: "inline-flex", alignItems: "center", gap: 5 }} title={t("toolbar.schemaHint")} onClick={onOpenSchema}>
            <span style={{ color: "#b4afa5" }}>⌗</span>
            <span className="om-wide-only">{t("toolbar.schema")}</span>
          </button>
          <button
            style={{ ...smallBtn, fontFamily: "var(--font-mono)", fontSize: 11.5, ...(showSql ? { background: "var(--accent-bg)", border: "1px solid var(--accent-border)", color: "var(--accent-hover)" } : {}) }}
            aria-pressed={showSql}
            title={t("toolbar.showSqlHint")}
            onClick={() => setShowSql((v) => !v)}
          >
            SQL
          </button>
          <button
            onClick={onAddRow}
            title={t("toolbar.newRow")}
            style={{ flex: "none", whiteSpace: "nowrap", minHeight: 27, minWidth: 27, padding: "0 10px", background: "var(--accent)", border: "1px solid var(--accent-hover)", borderRadius: 7, color: "#fff", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}
          >
            <span className="om-wide-only">{t("toolbar.newRow")}</span>
            <span className="om-narrow-only" aria-hidden>+</span>
          </button>
        </div>
      </div>

      {(filters.length > 0 || sorts.length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7, padding: "12px 0 0" }}>
          {topItems.length > 1 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "#6f6b62" }}>
              {t("toolbar.matchPrefix")}
              {matchPicker(filterMatch, onFilterMatchChange)}
              {t("toolbar.matchSuffix")}
            </span>
          )}
          {topItems.map((item, k) => (
            <div key={item.group ?? `f${item.indexes[0]}`} style={{ display: "contents" }}>
              {k > 0 && connectorFor(filterMatch)}
              {item.group ? (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "4px 6px", border: "1px solid var(--accent-border)", borderRadius: 10, background: "color-mix(in oklab, var(--accent-bg) 45%, transparent)" }}>
                  <span style={{ fontSize: 16, color: "oklch(0.6 0.06 250)", fontWeight: 300 }}>(</span>
                  {item.indexes.map((i, n) => (
                    <div key={i} style={{ display: "contents" }}>
                      {n > 0 && connectorFor(groupMatchOf(item.group!))}
                      {chipFor(i)}
                    </div>
                  ))}
                  <span style={{ fontSize: 16, color: "oklch(0.6 0.06 250)", fontWeight: 300 }}>)</span>
                  {item.indexes.length > 1 && matchPicker(groupMatchOf(item.group), (m) => onFilterGroupsChange(filterGroups.map((g) => (g.id === item.group ? { ...g, match: m } : g))))}
                  <button onClick={() => addFilter(item.group)} title={t("toolbar.addToGroup")} style={{ height: 22, padding: "0 7px", background: "#fff", border: "1px solid var(--accent-border)", borderRadius: 6, fontSize: 12, color: "var(--accent-hover)", cursor: "pointer" }}>
                    +
                  </button>
                </div>
              ) : (
                chipFor(item.indexes[0])
              )}
            </div>
          ))}
          {sorts.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, height: 28, padding: "0 4px 0 8px", background: "#f6f4ef", border: "1px solid #e8e5df", borderRadius: 8, fontSize: 12.5 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#8b877e", fontWeight: 500 }} title={t("toolbar.addSortHint")}>
                <SortIcon />
                {t("toolbar.sortBy")}
              </span>
              <Combobox
                value={s.column}
                options={columnOptions}
                autoFocus={justAdded?.kind === "sort" && justAdded.index === i}
                ariaLabel={t("combobox.column")}
                onChange={(v) => onSortsChange(sorts.map((x, j) => (j === i ? { ...x, column: v } : x)))}
              />
              <button
                onClick={() => onSortsChange(sorts.map((x, j) => (j === i ? { ...x, dir: x.dir === "asc" ? "desc" : "asc" } : x)))}
                style={{ padding: "2px 7px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 5, fontSize: 12, color: "#4b473f", cursor: "pointer" }}
              >
                {s.dir === "asc" ? "A → Z" : "Z → A"}
              </button>
              <button
                onClick={() => onSortsChange(sorts.filter((_, j) => j !== i))}
                style={{ width: 20, height: 20, display: "grid", placeItems: "center", background: "transparent", border: "none", borderRadius: 5, color: "#9a958b", cursor: "pointer" }}
              >
                ×
              </button>
            </div>
          ))}
          <Hint label={t("toolbar.addGroupHint")} keys={["G"]}>
            <button
              onClick={addGroup}
              style={{ height: 28, padding: "0 9px", background: "transparent", border: "1px dashed var(--accent-border)", borderRadius: 8, fontSize: 12.5, color: "var(--accent-hover)", cursor: "pointer" }}
            >
              {t("toolbar.addGroup")}
            </button>
          </Hint>
          <Hint label={t("toolbar.clearAllHint")} keys={["⇧", "⌫"]}>
            <button
              onClick={clearAll}
              style={{ height: 28, padding: "0 9px", background: "transparent", border: "1px dashed #d9d5cc", borderRadius: 8, fontSize: 12.5, color: "#8b877e", cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--env-prod-fg)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#8b877e")}
            >
              {t("toolbar.clearAll")}
            </button>
          </Hint>
        </div>
      )}

      {showSql && (
        <div style={{ marginTop: 12, border: "1px solid var(--border-3)", borderRadius: 8, overflow: "hidden" }}>
          <EquivalentSqlBar sql={sql} wrap />
        </div>
      )}
    </div>
  );
}
