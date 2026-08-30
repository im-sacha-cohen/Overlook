"use client";

import { useLang } from "@/lib/i18n/LanguageProvider";

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, pageSize, total, onPageChange }: Props) {
  const { t, lang } = useLang();
  if (total <= pageSize) return null;
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
