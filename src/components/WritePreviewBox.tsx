"use client";

import { useEffect, useState } from "react";
import type { WriteOp, WritePreview } from "@/lib/types";
import { api } from "@/lib/client/api";
import { useLang } from "@/lib/i18n/LanguageProvider";
import { CopyButton } from "./CopyButton";

interface Props {
  connectionId: string;
  op: WriteOp;
}

/** The SQL a write is about to run, and how many rows it concerns. */
export function WritePreviewBox({ connectionId, op }: Props) {
  const { t } = useLang();
  const opKey = JSON.stringify(op);
  const [state, setState] = useState<{ key: string; preview?: WritePreview; error?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .previewWrite(connectionId, JSON.parse(opKey) as WriteOp)
      .then((preview) => !cancelled && setState({ key: opKey, preview }))
      .catch((err) => !cancelled && setState({ key: opKey, error: err instanceof Error ? err.message : String(err) }));
    return () => {
      cancelled = true;
    };
  }, [connectionId, opKey]);

  const current = state?.key === opKey ? state : null;
  const rows = current?.preview?.rows;
  const text = !current ? t("writePreview.loading") : current.error ? t("writePreview.error", { message: current.error }) : current.preview?.sql || t("writePreview.nothing");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows !== null && rows !== undefined && (
        <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--fg)" }}>{t(`writePreview.rows.${op.kind}`, { count: rows.toLocaleString() })}</div>
      )}
      <SqlBox text={text} error={!!current?.error} copyText={current?.preview?.script || undefined} />
    </div>
  );
}

/**
 * SQL shown before it runs. `copyText` is what the copy button gives: the
 * statements with every value whole, ready to run by hand.
 */
export function SqlBox({ text, error = false, copyText }: { text: string; error?: boolean; copyText?: string }) {
  const { t } = useLang();
  return (
    <div style={{ position: "relative" }}>
      <pre
        className="om-sb"
        style={{
          margin: 0,
          maxHeight: 160,
          overflow: "auto",
          padding: copyText ? "8px 124px 8px 10px" : "8px 10px",
          background: "#faf9f6",
          border: "1px solid #f0eee9",
          borderRadius: 8,
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          color: error ? "var(--env-prod-fg)" : "#4b473f",
        }}
      >
        {text}
      </pre>
      {copyText && (
        <div style={{ position: "absolute", top: 6, right: 6 }}>
          <CopyButton text={copyText} label={t("writePreview.copy")} />
        </div>
      )}
    </div>
  );
}
