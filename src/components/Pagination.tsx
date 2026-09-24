"use client";

import { useState } from "react";
import { useLang } from "@/lib/i18n/LanguageProvider";
import { Select } from "./Select";

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const PAGE_SIZES = [25, 50, 100, 250, 500, 1000];
const MAX_PAGE_SIZE = 5000;

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }: Props) {
  const { t, lang } = useLang();
  const [custom, setCustom] = useState<string | null>(null);
  // A table that fits in the smallest page needs neither pages nor their size.
  if (total <= pageSize && total <= PAGE_SIZES[0]) return null;
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 32px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg)",
        fontSize: 12.5,
        color: "#8b877e",
      }}
    >
      <span>
        {from}–{to} {t("pagination.of")} {total.toLocaleString(lang === "fr" ? "fr-FR" : "en-US")}
      </span>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {custom === null ? (
          <Select
            size="sm"
            value={String(pageSize)}
            onChange={(v) => (v === "custom" ? setCustom(String(pageSize)) : onPageSizeChange(Number(v)))}
            options={[
              ...[...new Set([...PAGE_SIZES, pageSize])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: n.toLocaleString(lang === "fr" ? "fr-FR" : "en-US") })),
              { value: "custom", label: t("pagination.customSize") },
            ]}
            style={{ color: "#4b473f" }}
          />
        ) : (
          <input
            autoFocus
            type="number"
            min={1}
            max={MAX_PAGE_SIZE}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setCustom(null);
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            onBlur={() => {
              const n = Math.round(Number(custom));
              if (Number.isFinite(n) && n >= 1) onPageSizeChange(Math.min(n, MAX_PAGE_SIZE));
              setCustom(null);
            }}
            style={{ width: 72, border: "1px solid #e8e5df", borderRadius: 6, padding: "3px 6px", fontSize: 12.5, fontFamily: "var(--font-mono)" }}
          />
        )}
        {t("pagination.perPage")}
      </label>
      <div style={{ flex: 1 }} />
      <button
        onClick={() => onPageChange(0)}
        disabled={page === 0}
        style={{ padding: "4px 9px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 6, cursor: page === 0 ? "default" : "pointer", color: page === 0 ? "#c2bdb3" : "#4b473f" }}
      >
        {t("pagination.first")}
      </button>
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page === 0}
        style={{ padding: "4px 9px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 6, cursor: page === 0 ? "default" : "pointer", color: page === 0 ? "#c2bdb3" : "#4b473f" }}
      >
        {t("pagination.previous")}
      </button>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>
        {t("pagination.page", { page: page + 1, total: lastPage + 1 })}
      </span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= lastPage}
        style={{ padding: "4px 9px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 6, cursor: page >= lastPage ? "default" : "pointer", color: page >= lastPage ? "#c2bdb3" : "#4b473f" }}
      >
        {t("pagination.next")}
      </button>
      <button
        onClick={() => onPageChange(lastPage)}
        disabled={page >= lastPage}
        style={{ padding: "4px 9px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 6, cursor: page >= lastPage ? "default" : "pointer", color: page >= lastPage ? "#c2bdb3" : "#4b473f" }}
      >
        {t("pagination.last")}
      </button>
    </div>
  );
}
