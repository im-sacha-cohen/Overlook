import { sanitizeTablePrefs, type SavedView } from "../prefs";

/** What a shared link carries: a view's filters, sorts, grouping and layout kind. */
export type SharedView = Pick<SavedView, "filters" | "filterMatch" | "filterGroups" | "sorts" | "groupBy" | "view">;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeSharedView(view: SharedView): string {
  return toBase64Url(JSON.stringify(view));
}

/** Null when the parameter is missing or not a view; values are sanitized like saved preferences. */
export function decodeSharedView(param: string | null): SharedView | null {
  if (!param) return null;
  try {
    const p = sanitizeTablePrefs(JSON.parse(fromBase64Url(param)));
    return { filters: p.filters, filterMatch: p.filterMatch, filterGroups: p.filterGroups, sorts: p.sorts, groupBy: p.groupBy, view: p.view };
  } catch {
    return null;
  }
}
