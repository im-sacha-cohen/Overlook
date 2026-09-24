import type { ConflictMode } from "../db/adapter";
import type { CopyAnalysis, CopyEvent, RelationMode } from "../api/copyRows";
import { userHeader } from "./api";

export type { ConflictMode, CopyAnalysis, CopyEvent, RelationMode };

export interface CopyRequest {
  target: string;
  tables: string[];
  ids?: string[];
  onConflict: ConflictMode;
  emptyFirst: boolean;
  /** Target tables emptied too, those pointing to the emptied ones. */
  emptyAlso?: string[];
  relations?: RelationMode;
  confirm?: string;
}

/** What the copy would run into (missing parents, tables to empty too), without writing. */
export async function analyzeCopy(sourceId: string, body: Omit<CopyRequest, "confirm">, signal?: AbortSignal): Promise<CopyAnalysis> {
  const res = await fetch(`/api/connections/${sourceId}/copy/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...userHeader() },
    body: JSON.stringify(body),
    signal,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `Erreur ${res.status}`);
  return payload as CopyAnalysis;
}

/** Runs a copy to another connection, handing each step to `onEvent` as it comes. */
export async function copyToConnection(sourceId: string, body: CopyRequest, onEvent: (e: CopyEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`/api/connections/${sourceId}/copy`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...userHeader() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const payload = await res.json().catch(() => ({}));
    throw Object.assign(new Error(payload.error || `Erreur ${res.status}`), { status: res.status });
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = done ? "" : lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as CopyEvent;
        if (event.type === "error") throw new Error(event.message);
        onEvent(event);
      }
      if (done) return;
    }
  } finally {
    // An error line ends the copy: stop reading rather than leave the response hanging.
    reader.cancel().catch(() => {});
  }
}
