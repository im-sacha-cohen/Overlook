"use client";

import { useState } from "react";
import { useLang } from "@/lib/i18n/LanguageProvider";

/** A name copied with the mouse often brings a space along: ignore those. */
export function prodNameMatches(typed: string, name: string): boolean {
  return typed.trim() === name.trim();
}

interface Props {
  /** The production connection's name, to type back. */
  name: string;
  value: string;
  onChange: (value: string) => void;
  /** Enter in the field. */
  onSubmit?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
}

/** "Type <name> to confirm", with the name ready to copy: the same everywhere a production write asks for it. */
export function ProdNameConfirm({ name, value, onChange, onSubmit, autoFocus, disabled }: Props) {
  const { t } = useLang();
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 12.5, color: "#8b877e" }}>
        <span>{t("prodGuard.typeBefore")}</span>
        <CopyableName name={name} />
        <span>{t("prodGuard.typeAfter")}</span>
      </div>
      <input
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit?.()}
        placeholder={name}
        style={{
          border: "1px solid #e8e5df",
          borderRadius: 8,
          padding: "8px 10px",
          outline: "none",
          fontFamily: "var(--font-mono)",
          fontSize: 13.5,
          background: "#fff",
        }}
      />
    </>
  );
}

/** The name to type, framed as a button that copies it, so it can be pasted instead. */
function CopyableName({ name }: { name: string }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={t("prodGuard.copyName")}
      onClick={async () => {
        await navigator.clipboard.writeText(name);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "3px 8px",
        background: copied ? "var(--env-prod-bg)" : "#faf9f6",
        border: "1px solid var(--env-prod-border)",
        borderRadius: 6,
        cursor: "pointer",
        fontFamily: "var(--font-mono)",
        fontSize: 12.5,
        fontWeight: 600,
        color: "#26241f",
      }}
    >
      {name}
      <span style={{ fontFamily: "var(--font-sans)", fontWeight: 400, fontSize: 11.5, color: copied ? "var(--env-prod-fg)" : "#8b877e" }}>
        {copied ? t("equivalentSql.copied") : "⧉"}
      </span>
    </button>
  );
}
