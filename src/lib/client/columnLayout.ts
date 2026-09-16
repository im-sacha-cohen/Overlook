// Column order/widths used to live in localStorage. They are now part of the
// server-side table preferences; this module only reclaims what older versions
// left in the browser, plus the ordering helper the views use.
export interface ColumnLayout {
  order: string[];
  widths: Record<string, number>;
}

const LEGACY_PREFIX = "overlook:cols:";

// Reads any layout an older build stored for this connection. The entries are kept
// until the server confirms the migration (see clearLegacyColumnLayout), so a reload
// mid-migration doesn't lose them.
export function readLegacyColumnLayouts(connectionId: string): Record<string, ColumnLayout> {
  const out: Record<string, ColumnLayout> = {};
  try {
    const prefix = `${LEGACY_PREFIX}${connectionId}:`;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) {
      const table = key.slice(prefix.length);
      try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? "");
        out[table] = { order: Array.isArray(parsed.order) ? parsed.order : [], widths: parsed.widths ?? {} };
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage disabled: nothing to migrate.
  }
  return out;
}

export function clearLegacyColumnLayout(connectionId: string, table: string): void {
  try {
    localStorage.removeItem(`${LEGACY_PREFIX}${connectionId}:${table}`);
  } catch {
    // Storage disabled: nothing to clear.
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
