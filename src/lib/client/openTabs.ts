const STORAGE_KEY = "overlook:openTabs";

export interface StoredTab {
  tabId: string;
  connectionId: string;
  table: string | null;
  view: string;
}

function isStoredTab(v: unknown): v is StoredTab {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return typeof t.tabId === "string" && typeof t.connectionId === "string" && typeof t.view === "string" && (t.table === null || typeof t.table === "string");
}

export function loadOpenTabs(): StoredTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isStoredTab) : [];
  } catch {
    return [];
  }
}

export function saveOpenTabs(tabs: StoredTab[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    // best-effort only
  }
}
