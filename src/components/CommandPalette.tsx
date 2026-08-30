"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n/LanguageProvider";

export interface CmdItem {
  icon: string;
  label: string;
  hint: string;
  onRun: () => void;
}

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  items: CmdItem[];
  onClose: () => void;
}

export function CommandPalette({ query, onQueryChange, items, onClose }: Props) {
  const { t } = useLang();
  const [selected, setSelected] = useState(0);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    setSelected(0);
  }, [query, items.length]);

  useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[selected]?.onRun();
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(35,31,24,0.14)",
        display: "flex",
        justifyContent: "center",
        paddingTop: "13vh",
        zIndex: 70,
        animation: "om-fade 0.12s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxHeight: "60vh",
          display: "flex",
          flexDirection: "column",
          background: "#fff",
          border: "1px solid #e5e2db",
          borderRadius: 13,
          boxShadow: "var(--shadow-pop)",
          overflow: "hidden",
          animation: "om-pop 0.14s ease",
        }}
      >
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          placeholder={t("cmdPalette.placeholder")}
          style={{ border: "none", outline: "none", padding: "15px 17px", fontSize: 15, borderBottom: "1px solid #f2f0ea" }}
        />
        <div className="om-sb" style={{ overflowY: "auto", padding: 6 }}>
          {items.map((c, i) => (
            <div
              key={i}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              onClick={() => c.onRun()}
              onMouseEnter={() => setSelected(i)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "9px 11px",
                borderRadius: 8,
                cursor: "pointer",
                background: i === selected ? "#f5f3ee" : "transparent",
              }}
            >
              <span style={{ width: 18, textAlign: "center", color: "#b4afa5", fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{c.icon}</span>
              <span style={{ flex: 1 }}>{c.label}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#b4afa5" }}>{c.hint}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
