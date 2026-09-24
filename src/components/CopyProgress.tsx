"use client";

import type { CopyEvent, ConflictMode } from "@/lib/client/copy";
import { useLang } from "@/lib/i18n/LanguageProvider";

/** A copy to another connection running in the background: its dialog closed as soon as it started. */
export interface CopyTask {
  id: number;
  /** What is sent, e.g. "12 row(s) of users". */
  label: string;
  sourceName: string;
  targetName: string;
  onConflict: ConflictMode;
  plan: Extract<CopyEvent, { type: "plan" }> | null;
  /** Rows read so far, per table. */
  progress: Record<string, number>;
  result: { read: number; written: number; added: number; skipped: number } | null;
  status: "running" | "done" | "error";
  error?: string;
}

interface Props {
  task: CopyTask;
  onCancel: () => void;
  onDismiss: () => void;
}

export function CopyProgress({ task, onCancel, onDismiss }: Props) {
  const { t, lang } = useLang();
  const locale = lang === "fr" ? "fr-FR" : "en-US";
  const total = task.plan ? task.plan.tables.reduce((sum, x) => sum + x.total, 0) : 0;
  const done = Object.values(task.progress).reduce((a, b) => a + b, 0);
  const pct = task.status === "done" ? 100 : total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const { result, plan } = task;
  const unchanged = result ? result.read - result.written - result.skipped : 0;

  return (
    <div
      style={{
        width: 300,
        background: "#26241f",
        color: "#f7f6f2",
        borderRadius: 11,
        padding: "12px 14px",
        boxShadow: "0 12px 30px rgba(35,31,24,0.25)",
        animation: "om-pop 0.14s ease",
        fontSize: 12.5,
        pointerEvents: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {task.status === "running" && t("copyProgress.running")}
          {task.status === "done" && t("copyProgress.done")}
          {task.status === "error" && t("copyProgress.error")}
        </span>
        <div style={{ flex: 1 }} />
        {task.status === "running" ? (
          <button onClick={onCancel} style={{ background: "transparent", border: "none", color: "#d8d4cc", cursor: "pointer", fontSize: 12 }}>
            {t("copyTo.stop")}
          </button>
        ) : (
          <button onClick={onDismiss} style={{ background: "transparent", border: "none", color: "#d8d4cc", cursor: "pointer", fontSize: 14 }}>
            ✕
          </button>
        )}
      </div>
      <div style={{ color: "#a8a39a", marginBottom: 8, lineHeight: 1.45 }}>
        {task.label} · {task.sourceName} → {task.targetName}
      </div>

      {task.status !== "error" && (
        <>
          <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", transition: "width 0.15s ease" }} />
          </div>
          {task.status === "running" && total > 0 && (
            <div style={{ marginTop: 6, color: "#a8a39a" }}>{t("copyProgress.rows", { done: done.toLocaleString(locale), total: total.toLocaleString(locale) })}</div>
          )}
        </>
      )}
      {task.status === "error" && <div style={{ color: "oklch(0.78 0.11 25)", lineHeight: 1.45, wordBreak: "break-word" }}>{task.error}</div>}

      {result && (
        <div style={{ marginTop: 6, lineHeight: 1.45 }}>
          <div>{t("copyTo.done", { count: result.written, name: task.targetName })}</div>
          <div style={{ color: "#a8a39a", fontSize: 12 }}>
            {result.added > 0 && <div>{t("copyTo.doneAdded", { count: result.added })}</div>}
            {unchanged > 0 && <div>{t(task.onConflict === "replace" ? "copyTo.doneUnchanged" : "copyTo.doneSkipped", { count: unchanged })}</div>}
            {result.skipped > 0 && <div style={{ color: "oklch(0.82 0.11 80)" }}>{t("copyTo.doneOrphans", { count: result.skipped })}</div>}
          </div>
        </div>
      )}
      {plan && task.status !== "running" && (plan.missing.length > 0 || Object.keys(plan.droppedColumns).length > 0) && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: "#a8a39a", lineHeight: 1.45 }}>
          {plan.missing.length > 0 && <div>{t("copyTo.skippedTables", { names: plan.missing.join(", ") })}</div>}
          {Object.entries(plan.droppedColumns).map(([table, cols]) => (
            <div key={table}>{t("copyTo.droppedColumns", { table, columns: cols.join(", ") })}</div>
          ))}
        </div>
      )}
    </div>
  );
}
