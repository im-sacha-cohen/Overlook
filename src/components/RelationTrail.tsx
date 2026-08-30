"use client";

import type { ViewKind } from "./TableToolbar";
import { useLang } from "@/lib/i18n/LanguageProvider";

export interface TrailEntry {
  table: string;
  view: ViewKind;
  filterColumn: string | null;
  filterValue: string | null;
  label: string;
}

interface Props {
  trail: TrailEntry[];
  currentTable: string;
  onJump: (index: number) => void;
  onClear: () => void;
}

export function RelationTrail({ trail, currentTable, onJump, onClear }: Props) {
  const { t } = useLang();
  if (trail.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 3,
        flexWrap: "wrap",
        marginBottom: 10,
        fontSize: 12.5,
      }}
    >
      <span style={{ color: "#b4afa5", marginRight: 3 }}>{t("relationTrail.path")}</span>
      {trail.map((entry, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <button
            onClick={() => onJump(i)}
            style={{
              background: "transparent",
              border: "none",
              padding: "2px 5px",
              borderRadius: 5,
              color: "var(--accent)",
              cursor: "pointer",
              fontSize: 12.5,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f2f0ea")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {entry.label}
          </button>
          <span style={{ color: "#d2cec4" }}>›</span>
        </span>
      ))}
      <span style={{ fontWeight: 500, color: "#4b473f", padding: "2px 5px" }}>{currentTable}</span>
      <div style={{ flex: 1 }} />
      <button
        onClick={onClear}
        style={{ background: "transparent", border: "none", color: "#a8a39a", cursor: "pointer", fontSize: 11.5, padding: "2px 5px" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#4b473f")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "#a8a39a")}
      >
        {t("relationTrail.reset")}
      </button>
    </div>
  );
}
