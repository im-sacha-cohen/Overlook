"use client";

import { useState } from "react";
import { useLang } from "@/lib/i18n/LanguageProvider";

/** Copies `text` and says so for a moment. */
export function CopyButton({ text, label, dark = false }: { text: string; label?: string; dark?: boolean }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      style={{
        flex: "none",
        padding: "3px 9px",
        background: dark ? "transparent" : "#fff",
        border: `1px solid ${dark ? "rgba(255,255,255,0.25)" : "#e5e2db"}`,
        borderRadius: 6,
        color: dark ? "#f7f6f2" : "#4b473f",
        cursor: "pointer",
        fontFamily: "var(--font-sans)",
        fontSize: 12,
      }}
    >
      {copied ? t("equivalentSql.copied") : label ?? t("equivalentSql.copy")}
    </button>
  );
}
