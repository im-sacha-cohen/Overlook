import { getDb } from "./metadata";

// Rows per page of the grid: one setting for every table, connection and browser.
export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 5000;
const PAGE_SIZE_KEY = "pageSize";

export function getPageSize(): number {
  const row = getDb().prepare("SELECT value FROM app_settings WHERE key = ?").get(PAGE_SIZE_KEY) as { value: string } | undefined;
  const n = Number(row?.value);
  return Number.isInteger(n) && n >= 1 && n <= MAX_PAGE_SIZE ? n : DEFAULT_PAGE_SIZE;
}

export function setPageSize(size: unknown): number {
  const n = Number(size);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_SIZE) throw new Error(`Le nombre de lignes par page doit être entre 1 et ${MAX_PAGE_SIZE}`);
  getDb()
    .prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .run(PAGE_SIZE_KEY, String(n));
  return n;
}
