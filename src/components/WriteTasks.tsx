"use client";

import { useLang } from "@/lib/i18n/LanguageProvider";
import { CopyButton } from "./CopyButton";

/** A confirmed write running in the background: its dialog closed as soon as it was confirmed. */
export interface WriteTask {
  id: number;
  label: string;
  connectionName: string;
  status: "running" | "done" | "error";
  error?: string;
  /** The SQL to run it by hand, offered when it failed. */
  script?: string;
}

interface Props {
  task: WriteTask;
  onDismiss: () => void;
}

export function WriteTaskCard({ task, onDismiss }: Props) {
  const { t } = useLang();
  const failed = task.status === "error";
  return (
    <div
      style={{
        width: 300,
        background: "#26241f",
        color: "#f7f6f2",
        borderRadius: 11,
        padding: "11px 14px",
        boxShadow: "0 12px 30px rgba(35,31,24,0.25)",
        animation: "om-pop 0.14s ease",
        fontSize: 12.5,
        pointerEvents: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            flex: "none",
            background: failed ? "oklch(0.7 0.16 25)" : task.status === "done" ? "oklch(0.75 0.13 150)" : "var(--accent)",
            animation: task.status === "running" ? "om-pulse 1s ease-in-out infinite" : undefined,
          }}
        />
        <span style={{ fontWeight: 500 }}>
          {task.status === "running" && t("writeTasks.running", { connection: task.connectionName })}
          {task.status === "done" && t("writeTasks.done")}
          {failed && t("writeTasks.failed", { connection: task.connectionName })}
        </span>
        <div style={{ flex: 1 }} />
        {task.status !== "running" && (
          <button onClick={onDismiss} style={{ background: "transparent", border: "none", color: "#d8d4cc", cursor: "pointer", fontSize: 14, padding: 0 }}>
            ✕
          </button>
        )}
      </div>
      <div
        style={{ marginTop: 5, color: "#a8a39a", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
      >
        {task.label}
      </div>
      {failed && task.error && <div style={{ marginTop: 6, color: "oklch(0.78 0.11 25)", lineHeight: 1.45, wordBreak: "break-word" }}>{task.error}</div>}
      {failed && task.script && (
        <div style={{ marginTop: 8 }}>
          <CopyButton text={task.script} label={t("writePreview.copy")} dark />
        </div>
      )}
    </div>
  );
}
