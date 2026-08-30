"use client";

import { useState } from "react";
import { useLang } from "@/lib/i18n/LanguageProvider";

export function EquivalentSqlBar({ sql }: { sql: string }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "9px 16px", background: "#f7f6f2", borderBottom: "1px solid var(--border)", fontFamily: "var(--font-mono)", fontSize: 12, color: "#5c584f", overflow: "hidden" }}>
      <span style={{ color: "#a09b91", flex: "none" }}>{t("equivalentSql.label")}</span>
      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sql}</span>
      <div style={{ flex: 1 }} />
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(sql);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }}
        style={{ flex: "none", padding: "3px 9px", background: "#fff", border: "1px solid #e5e2db", borderRadius: 6, color: "#4b473f", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12.5 }}
      >
        {copied ? t("equivalentSql.copied") : t("equivalentSql.copy")}
      </button>
    </div>
  );
}
