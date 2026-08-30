export interface ColumnLayout {
  order: string[];
  widths: Record<string, number>;
}

function storageKey(connectionId: string, table: string): string {
  return `overlook:cols:${connectionId}:${table}`;
}

export function loadColumnLayout(connectionId: string, table: string): ColumnLayout {
  try {
    const raw = localStorage.getItem(storageKey(connectionId, table));
    if (!raw) return { order: [], widths: {} };
    const parsed = JSON.parse(raw);
    return { order: Array.isArray(parsed.order) ? parsed.order : [], widths: parsed.widths ?? {} };
  } catch {
    return { order: [], widths: {} };
  }
}

export function saveColumnLayout(connectionId: string, table: string, layout: ColumnLayout): void {
  try {
    localStorage.setItem(storageKey(connectionId, table), JSON.stringify(layout));
  } catch {
    // best-effort only (private browsing, storage disabled, etc.)
  }
}

export function orderColumns<T extends { name: string }>(columns: T[], order: string[]): T[] {
  if (order.length === 0) return columns;
  const byName = new Map(columns.map((c) => [c.name, c] as const));
  const ordered: T[] = [];
  for (const name of order) {
    const c = byName.get(name);
    if (c) {
      ordered.push(c);
      byName.delete(name);
    }
  }
  for (const c of columns) if (byName.has(c.name)) ordered.push(c);
  return ordered;
}
