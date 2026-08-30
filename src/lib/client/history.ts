export interface HistoryEntry {
  id: string;
  time: string;
  text: string;
  who: string;
  undo?: () => Promise<void>;
}

export function timeNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
