"use client";

import { useLang } from "@/lib/i18n/LanguageProvider";

interface Props {
  count: number;
  onClear: () => void;
  onDelete: () => void;
  onEdit: () => void;
}

export function SelectionBar({ count, onClear, onDelete, onEdit }: Props) {
  const { t } = useLang();
  if (count === 0) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 22,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "9px 10px 9px 16px",
        background: "#26241f",
        color: "#f7f6f2",
        borderRadius: 10,
        fontSize: 13,
        boxShadow: "0 12px 30px rgba(35,31,24,0.25)",
        zIndex: 55,
        animation: "om-pop 0.14s ease",
      }}
    >
      <span>{t("selectionBar.selected", { count })}</span>
      <button
        onClick={onEdit}
        style={{ padding: "6px 12px", background: "transparent", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 7, color: "#f7f6f2", cursor: "pointer", fontSize: 12.5 }}
      >
        {t("selectionBar.edit")}
      </button>
      <button
        onClick={onDelete}
        style={{ padding: "6px 12px", background: "oklch(0.5 0.18 25)", border: "none", borderRadius: 7, color: "#fff", fontWeight: 500, cursor: "pointer", fontSize: 12.5 }}
      >
        {t("selectionBar.delete")}
      </button>
      <button
        onClick={onClear}
        style={{ padding: "6px 12px", background: "transparent", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 7, color: "#f7f6f2", cursor: "pointer", fontSize: 12.5 }}
      >
        {t("selectionBar.deselect")}
      </button>
    </div>
  );
}
