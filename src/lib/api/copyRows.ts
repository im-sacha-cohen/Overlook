// Copies rows, or whole tables, from one connection to another. The target tables
// must already exist: only the columns both sides have are copied.
//
// Foreign keys are never switched off. Before writing, the rows are checked against
// the target: those pointing to a parent row it lacks are reported, and the user
// chooses to bring those parent rows along ("include") or to leave the rows out
// ("skip"). While copying, a row whose parent still isn't there is left out rather
// than failing the whole copy halfway.
import { primaryKeyOf, referencingFirst, type ConflictMode, type DatabaseAdapter } from "../db/adapter";
import type { Engine, Row, TableMeta } from "../types";

export type RelationMode = "include" | "skip";
export const RELATION_MODES: RelationMode[] = ["include", "skip"];

export interface CopyPlan {
  /** Whole tables, or a single table when `ids` is given. */
  tables: string[];
  /** Primary key values of the rows to copy (row mode, one table). */
  ids?: string[];
  onConflict: ConflictMode;
  /** Whole tables only: delete the target's rows first. */
  emptyFirst: boolean;
  /** Target tables emptied too, because they point to the emptied ones (see CopyAnalysis.emptyBlockers). */
  emptyAlso?: string[];
  /** What to do with rows pointing to a parent row the target lacks. */
  relations?: RelationMode;
}

/** Rows pointing, through one foreign key, to parent rows the target doesn't have. */
export interface RelationIssue {
  fromTable: string;
  column: string;
  toTable: string;
  toColumn: string;
  /** The target has the constraint: such a row can't be written at all. Otherwise the link just leads nowhere. */
  enforced: boolean;
  /** Rows to copy that point to a missing parent. */
  rows: number;
  /** Distinct missing parents, and a few of their keys. */
  missing: number;
  sample: string[];
  /** Missing parents the source doesn't have either: they can't be brought along. */
  unresolvable: number;
}

export interface CopyAnalysis {
  missingTables: string[];
  droppedColumns: Record<string, string[]>;
  relations: RelationIssue[];
  /** Parent rows "include" would add, per table. */
  extras: Record<string, number>;
  /** Rows to copy that "skip" leaves out: pointing to at least one missing parent the target enforces. */
  orphans: number;
  /** More parent rows than a copy brings along: copy their tables instead. */
  tooMany: boolean;
  /** With emptyFirst: target tables pointing to the emptied ones, which must be emptied too. */
  emptyBlockers: { table: string; references: string }[];
}

export type CopyEvent =
  | { type: "plan"; tables: { name: string; total: number }[]; missing: string[]; droppedColumns: Record<string, string[]> }
  | { type: "progress"; table: string; read: number; written: number }
  | { type: "done"; read: number; written: number; added: number; skipped: number }
  | { type: "error"; message: string };

const PAGE = 500;
/** Parent rows brought along at most, beyond which copying their tables is the better way. */
export const MAX_EXTRA_ROWS = 20_000;
const SAMPLE = 5;

/**
 * Values as the target's driver takes them: a JSON object read from one engine is
 * text for another, and SQLite binds neither a Date nor an object.
 */
export function valueForTarget(value: unknown, engine: Engine, nativeType: string): unknown {
  if (value === null || value === undefined || Buffer.isBuffer(value)) return value ?? null;
  if (value instanceof Date) return engine === "sqlite" ? value.toISOString() : value;
  if (Array.isArray(value)) return engine === "postgres" && nativeType.toUpperCase() === "ARRAY" ? value : JSON.stringify(value);
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

const keyOf = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

function chunks<T>(list: T[], size = PAGE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

interface Relation {
  table: string;
  column: string;
  toTable: string;
  toColumn: string;
  enforced: boolean;
}

/** Everything a copy needs to know about both sides, loaded once. */
interface Context {
  source: DatabaseAdapter;
  target: DatabaseAdapter;
  targetEngine: Engine;
  plan: CopyPlan;
  signal?: AbortSignal;
  sourceByName: Map<string, TableMeta>;
  targetByName: Map<string, TableMeta>;
  /** Plan tables the target has, parents first. */
  ordered: string[];
  missing: string[];
  columnsOf: Map<string, string[]>;
  droppedColumns: Record<string, string[]>;
  rowMode: boolean;
  /** Target tables emptied before writing. */
  emptied: Set<string>;
}

async function loadContext(source: DatabaseAdapter, target: DatabaseAdapter, targetEngine: Engine, plan: CopyPlan, signal?: AbortSignal): Promise<Context> {
  const [sourceTables, targetTables] = await Promise.all([source.listTables(), target.listTables()]);
  const sourceByName = new Map(sourceTables.map((t) => [t.name, t]));
  const targetByName = new Map(targetTables.map((t) => [t.name, t]));
  for (const name of plan.tables) if (!sourceByName.has(name)) throw new Error(`Table introuvable : ${name}`);
  const rowMode = plan.ids !== undefined;
  if (rowMode && plan.tables.length !== 1) throw new Error("La copie de lignes porte sur une seule table");

  const missing = plan.tables.filter((t) => !targetByName.has(t));
  const present = plan.tables.filter((t) => targetByName.has(t));
  const ordered = parentsFirst(present, sourceByName, targetByName);

  const droppedColumns: Record<string, string[]> = {};
  const columnsOf = new Map<string, string[]>();
  for (const name of sourceByName.keys()) {
    if (!targetByName.has(name)) continue;
    const targetCols = new Set(targetByName.get(name)!.columns.map((c) => c.name));
    const sourceCols = sourceByName.get(name)!.columns.map((c) => c.name);
    columnsOf.set(name, sourceCols.filter((c) => targetCols.has(c)));
    const dropped = sourceCols.filter((c) => !targetCols.has(c));
    if (dropped.length > 0 && ordered.includes(name)) droppedColumns[name] = dropped;
  }
  const noCommon = ordered.filter((t) => columnsOf.get(t)!.length === 0);
  if (noCommon.length > 0) throw new Error(`Aucune colonne en commun avec la cible : ${noCommon.join(", ")}`);

  const emptied = new Set(!rowMode && plan.emptyFirst ? [...ordered, ...(plan.emptyAlso ?? []).filter((t) => targetByName.has(t))] : []);
  return { source, target, targetEngine, plan, signal, sourceByName, targetByName, ordered, missing, columnsOf, droppedColumns, rowMode, emptied };
}

function referencesOf(metas: TableMeta[]): { fromTable: string; toTable: string }[] {
  return metas.flatMap((m) => m.columns.filter((c) => c.references).map((c) => ({ fromTable: m.name, toTable: c.references!.table })));
}

/** Referenced tables first, so a row never points at one not written yet. */
function parentsFirst(tables: string[], sourceByName: Map<string, TableMeta>, targetByName: Map<string, TableMeta>): string[] {
  const metas = tables.flatMap((t) => [sourceByName.get(t), targetByName.get(t)].filter((m): m is TableMeta => !!m));
  return referencingFirst(tables, referencesOf(metas)).reverse();
}

/**
 * The links a table's copied rows carry: the target's foreign keys (enforced), and
 * the source's ones the target lacks, when it has the parent table (a link that
 * just leads nowhere if the parent row is missing).
 */
function relationsOf(ctx: Context, table: string): Relation[] {
  const targetMeta = ctx.targetByName.get(table);
  const copied = new Set(ctx.columnsOf.get(table) ?? []);
  if (!targetMeta) return [];
  const out: Relation[] = [];
  const parentColumn = (toTable: string, column: string | undefined) => column || primaryKeyOf(ctx.targetByName.get(toTable) ?? ctx.sourceByName.get(toTable)!)?.name;
  for (const c of targetMeta.columns) {
    if (!c.references || !copied.has(c.name) || !ctx.targetByName.has(c.references.table)) continue;
    const toColumn = parentColumn(c.references.table, c.references.column);
    if (toColumn) out.push({ table, column: c.name, toTable: c.references.table, toColumn, enforced: true });
  }
  for (const c of ctx.sourceByName.get(table)?.columns ?? []) {
    if (!c.references || !copied.has(c.name) || out.some((r) => r.column === c.name)) continue;
    if (!ctx.targetByName.has(c.references.table)) continue;
    const toColumn = parentColumn(c.references.table, c.references.column);
    if (toColumn && ctx.targetByName.get(c.references.table)!.columns.some((x) => x.name === toColumn)) {
      out.push({ table, column: c.name, toTable: c.references.table, toColumn, enforced: false });
    }
  }
  return out;
}

/** Reads a plan table's rows in pages: the selected ones, or all of them in key order. */
async function* pages(ctx: Context, name: string): AsyncGenerator<Row[]> {
  const pk = primaryKeyOf(ctx.sourceByName.get(name)!);
  if (ctx.rowMode) {
    if (!pk) throw new Error(`La table ${name} n'a pas de clé primaire`);
    for (const ids of chunks(ctx.plan.ids!)) yield await ctx.source.selectRowsByPk(name, pk.name, ids);
    return;
  }
  for (let offset = 0; ; offset += PAGE) {
    const { rows } = await ctx.source.selectRows(name, { limit: PAGE, offset, sorts: pk ? [{ column: pk.name, dir: "asc" }] : [] });
    if (rows.length > 0) yield rows;
    if (rows.length < PAGE) return;
  }
}

/** Keys of `values` the target has in `table.column` (none for a table about to be emptied). */
async function existingInTarget(ctx: Context, table: string, column: string, values: unknown[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (ctx.emptied.has(table)) return found;
  for (const part of chunks(values)) for (const r of await ctx.target.selectRowsByPk(table, column, part)) found.add(keyOf(r[column]));
  return found;
}

/** Parent rows to bring along: table → parent column → key → the value as read. */
type Extras = Map<string, Map<string, Map<string, unknown>>>;

function extraCount(extras: Extras): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [table, byColumn] of extras) out[table] = [...byColumn.values()].reduce((sum, keys) => sum + keys.size, 0);
  return out;
}

/**
 * Walks the rows to copy and, through their links, the parent rows the target
 * lacks, then those parents' own parents. Writes nothing.
 */
async function walkRelations(ctx: Context): Promise<{ issues: RelationIssue[]; extras: Extras; tooMany: boolean; orphans: number }> {
  const whole = new Set(ctx.rowMode ? [] : ctx.ordered);
  // Row mode: the selected rows are coming too, their children may point to them.
  const first = ctx.plan.tables[0];
  const selected = ctx.rowMode ? { table: first, pk: primaryKeyOf(ctx.sourceByName.get(first)!)?.name, ids: new Set(ctx.plan.ids) } : null;
  const extras: Extras = new Map();
  const issues = new Map<string, RelationIssue & { keys: Set<string> }>();
  let added = 0;
  let tooMany = false;
  let orphans = 0;
  const queue: { table: string; rows: Row[] }[] = [];

  const has = (table: string, column: string, key: string) => extras.get(table)?.get(column)?.has(key) ?? false;

  /** Returns the rows (of this batch) pointing to a missing parent the target enforces. */
  async function examine(table: string, rows: Row[]): Promise<Set<Row>> {
    const orphaned = new Set<Row>();
    for (const rel of relationsOf(ctx, table)) {
      // A table copied whole brings every row its children can point to.
      if (whole.has(rel.toTable)) continue;
      const counts = new Map<string, { value: unknown; n: number }>();
      for (const r of rows) {
        const v = r[rel.column];
        if (v === null || v === undefined) continue;
        const k = keyOf(v);
        const entry = counts.get(k);
        if (entry) entry.n += 1;
        else counts.set(k, { value: v, n: 1 });
      }
      const sameBatch = rel.toTable === table ? new Set(rows.map((r) => keyOf(r[rel.toColumn]))) : null;
      for (const k of [...counts.keys()]) {
        const coming = selected && rel.toTable === selected.table && rel.toColumn === selected.pk && selected.ids.has(k);
        if (coming || sameBatch?.has(k) || has(rel.toTable, rel.toColumn, k)) counts.delete(k);
      }
      if (counts.size === 0) continue;
      const there = await existingInTarget(ctx, rel.toTable, rel.toColumn, [...counts.values()].map((e) => e.value));
      for (const k of there) counts.delete(k);
      if (counts.size === 0) continue;
      if (rel.enforced) for (const r of rows) if (r[rel.column] !== null && r[rel.column] !== undefined && counts.has(keyOf(r[rel.column]))) orphaned.add(r);

      const id = `${rel.table}.${rel.column}`;
      const issue = issues.get(id) ?? { fromTable: rel.table, column: rel.column, toTable: rel.toTable, toColumn: rel.toColumn, enforced: rel.enforced, rows: 0, missing: 0, sample: [], unresolvable: 0, keys: new Set<string>() };
      issues.set(id, issue);
      for (const [k, { n }] of counts) {
        issue.rows += n;
        if (!issue.keys.has(k)) {
          issue.keys.add(k);
          if (issue.sample.length < SAMPLE) issue.sample.push(k);
        }
      }

      // The missing parents, as the source has them: what "include" would add.
      const found: Row[] = [];
      if (ctx.sourceByName.has(rel.toTable)) {
        for (const part of chunks([...counts.values()].map((e) => e.value))) found.push(...(await ctx.source.selectRowsByPk(rel.toTable, rel.toColumn, part)));
      }
      const foundKeys = new Set(found.map((r) => keyOf(r[rel.toColumn])));
      issue.unresolvable += [...counts.keys()].filter((k) => !foundKeys.has(k)).length;
      const fresh = found.filter((r) => !has(rel.toTable, rel.toColumn, keyOf(r[rel.toColumn])));
      if (added + fresh.length > MAX_EXTRA_ROWS) {
        tooMany = true;
        continue;
      }
      const byColumn = extras.get(rel.toTable) ?? new Map<string, Map<string, unknown>>();
      extras.set(rel.toTable, byColumn);
      const keys = byColumn.get(rel.toColumn) ?? new Map<string, unknown>();
      byColumn.set(rel.toColumn, keys);
      for (const r of fresh) keys.set(keyOf(r[rel.toColumn]), r[rel.toColumn]);
      added += fresh.length;
      if (fresh.length > 0) queue.push({ table: rel.toTable, rows: fresh });
    }
    return orphaned;
  }

  for (const name of ctx.ordered) {
    for await (const rows of pages(ctx, name)) {
      if (ctx.signal?.aborted) throw new Error("Analyse annulée");
      orphans += (await examine(name, rows)).size;
    }
  }
  while (queue.length > 0 && !tooMany) {
    if (ctx.signal?.aborted) throw new Error("Analyse annulée");
    const next = queue.shift()!;
    await examine(next.table, next.rows);
  }
  const report = [...issues.values()].map(({ keys, ...issue }) => ({ ...issue, missing: keys.size }));
  return { issues: report, extras, tooMany, orphans };
}

/**
 * With emptyFirst: the target tables that point to the emptied ones, and so on up.
 * Emptying a table they point to would fail while they still hold rows.
 */
function emptyBlockers(ctx: Context): { table: string; references: string }[] {
  if (ctx.rowMode || !ctx.plan.emptyFirst) return [];
  const emptied = new Set(ctx.ordered);
  const out: { table: string; references: string }[] = [];
  for (let grew = true; grew; ) {
    grew = false;
    for (const meta of ctx.targetByName.values()) {
      // An empty table points to nothing: it doesn't stand in the way.
      if (emptied.has(meta.name) || meta.rowCount === 0) continue;
      const ref = meta.columns.find((c) => c.references && c.references.table !== meta.name && emptied.has(c.references.table));
      if (!ref) continue;
      emptied.add(meta.name);
      out.push({ table: meta.name, references: ref.references!.table });
      grew = true;
    }
  }
  return out;
}

/** What a copy would run into, without writing anything. */
export async function analyzeCopy(source: DatabaseAdapter, target: DatabaseAdapter, targetEngine: Engine, plan: CopyPlan, signal?: AbortSignal): Promise<CopyAnalysis> {
  // The tables that would be emptied count as empty when looking for parents.
  const blockers = emptyBlockers(await loadContext(source, target, targetEngine, { ...plan, emptyAlso: [] }, signal));
  const ctx = await loadContext(source, target, targetEngine, { ...plan, emptyAlso: blockers.map((b) => b.table) }, signal);
  const { issues, extras, tooMany, orphans } = await walkRelations(ctx);
  return { missingTables: ctx.missing, droppedColumns: ctx.droppedColumns, relations: issues, extras: extraCount(extras), orphans, tooMany, emptyBlockers: blockers };
}

export async function* copyRows(source: DatabaseAdapter, target: DatabaseAdapter, targetEngine: Engine, plan: CopyPlan, signal?: AbortSignal): AsyncGenerator<CopyEvent> {
  const ctx = await loadContext(source, target, targetEngine, plan, signal);
  const blockers = emptyBlockers(ctx).filter((b) => !ctx.emptied.has(b.table));
  if (blockers.length > 0) {
    throw new Error(`Pour vider ${ctx.ordered.join(", ")}, il faut aussi vider ${blockers.map((b) => b.table).join(", ")} (qui y fait référence). Rien n'a été copié.`);
  }

  const extras: Extras = plan.relations === "include" ? (await walkRelations(ctx)).extras : new Map();
  const extraTables = [...extras.keys()].filter((t) => ctx.targetByName.has(t) && ctx.columnsOf.has(t));
  const all = parentsFirst([...new Set([...ctx.ordered, ...extraTables])], ctx.sourceByName, ctx.targetByName);
  const extraTotals = extraCount(extras);

  yield {
    type: "plan",
    tables: all.map((name) => ({
      name,
      total: (ctx.ordered.includes(name) ? (ctx.rowMode ? plan.ids!.length : ctx.sourceByName.get(name)!.rowCount) : 0) + (extraTotals[name] ?? 0),
    })),
    missing: ctx.missing,
    droppedColumns: ctx.droppedColumns,
  };
  if (all.length === 0) {
    yield { type: "done", read: 0, written: 0, added: 0, skipped: 0 };
    return;
  }

  // "Cancel if any row is already there": look before writing anything, so nothing is half copied.
  if (plan.onConflict === "error" && ctx.emptied.size === 0) {
    for (const name of ctx.ordered) {
      const targetMeta = ctx.targetByName.get(name)!;
      const pk = primaryKeyOf(targetMeta);
      if (!pk || !ctx.columnsOf.get(name)!.includes(pk.name) || targetMeta.columns.filter((c) => c.isPrimaryKey).length > 1) continue;
      if (!ctx.rowMode && targetMeta.rowCount === 0) continue;
      for await (const rows of pages(ctx, name)) {
        if (signal?.aborted) throw new Error("Copie annulée");
        const existing = await target.selectRowsByPk(name, pk.name, rows.map((r) => r[pk.name]));
        if (existing.length > 0) {
          throw new Error(`${name} : des lignes avec la même clé (${pk.name} = ${String(existing[0][pk.name])}…) existent déjà dans la cible. Rien n'a été copié.`);
        }
      }
    }
  }

  if (ctx.emptied.size > 0) await target.emptyTables([...ctx.emptied]);
  // Once emptied, the target's rows count again when looking for parents.
  ctx.emptied.clear();

  let read = 0;
  let written = 0;
  let added = 0;
  let skipped = 0;

  // Rows whose enforced parent the target still lacks are left out: the database would refuse them.
  async function keepLinked(name: string, rows: Row[]): Promise<Row[]> {
    let kept = rows;
    for (const rel of relationsOf(ctx, name).filter((r) => r.enforced)) {
      const values = [...new Map(kept.filter((r) => r[rel.column] !== null && r[rel.column] !== undefined).map((r) => [keyOf(r[rel.column]), r[rel.column]])).values()];
      if (values.length === 0) continue;
      const ok = await existingInTarget(ctx, rel.toTable, rel.toColumn, values);
      // A row may point to another of the same batch (a parent in the same table).
      if (rel.toTable === name) for (const r of kept) ok.add(keyOf(r[rel.toColumn]));
      kept = kept.filter((r) => r[rel.column] === null || r[rel.column] === undefined || ok.has(keyOf(r[rel.column])));
    }
    return kept;
  }

  for (const name of all) {
    const cols = ctx.columnsOf.get(name)!;
    const nativeTypes = new Map(ctx.targetByName.get(name)!.columns.map((c) => [c.name, c.nativeType]));
    let tableRead = 0;
    let tableWritten = 0;
    const write = async (rows: Row[], onConflict: ConflictMode) => {
      if (signal?.aborted) throw new Error(`Copie annulée : ${written} ligne(s) déjà écrite(s)`);
      const kept = await keepLinked(name, rows);
      skipped += rows.length - kept.length;
      const values = kept.map((r) => Object.fromEntries(cols.map((c) => [c, valueForTarget(r[c], targetEngine, nativeTypes.get(c) ?? "")])));
      const n = values.length > 0 ? await target.bulkInsert(name, values, { onConflict }) : 0;
      tableRead += rows.length;
      tableWritten += n;
      read += rows.length;
      written += n;
      return n;
    };

    // Parent rows brought along first: the table's own copied rows may point to them.
    for (const [column, keys] of extras.get(name) ?? []) {
      for (const part of chunks([...keys.values()])) {
        const rows = await source.selectRowsByPk(name, column, part);
        // They were missing from the target: a conflict can only come from a row written meanwhile.
        added += await write(rows, plan.onConflict === "replace" ? "replace" : "skip");
        yield { type: "progress", table: name, read: tableRead, written: tableWritten };
      }
    }
    if (ctx.ordered.includes(name)) {
      for await (const rows of pages(ctx, name)) {
        await write(rows, plan.onConflict);
        yield { type: "progress", table: name, read: tableRead, written: tableWritten };
      }
    }
  }
  yield { type: "done", read, written, added, skipped };
}
