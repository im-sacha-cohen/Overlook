"use client";

import { useLang } from "@/lib/i18n/LanguageProvider";
import { LANGUAGES } from "@/lib/i18n/translations";

interface Props {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: Props) {
  const { t, lang, setLang } = useLang();

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(35,31,24,0.14)", display: "grid", placeItems: "center", zIndex: 60, animation: "om-fade 0.12s ease" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 420, background: "#fff", border: "1px solid #e5e2db", borderRadius: 13, boxShadow: "var(--shadow-pop)", animation: "om-pop 0.14s ease", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid #f2f0ea" }}>
          <div style={{ fontWeight: 600 }}>{t("settings.title")}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ width: 26, height: 26, background: "transparent", border: "none", borderRadius: 6, color: "#8b877e", cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <div style={{ padding: "18px", display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <div style={{ fontSize: 12, color: "#8b877e", marginBottom: 8 }}>{t("settings.language")}</div>
            <div style={{ display: "flex", gap: 8 }}>
              {LANGUAGES.map((l) => (
                <button
                  key={l.value}
                  onClick={() => setLang(l.value)}
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${lang === l.value ? "var(--accent-hover)" : "#e8e5df"}`,
                    background: lang === l.value ? "var(--accent-bg)" : "#fff",
                    color: lang === l.value ? "oklch(0.5 0.1 250)" : "#4b473f",
                    fontSize: 13,
                    fontWeight: lang === l.value ? 500 : 400,
                    cursor: "pointer",
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ borderTop: "1px solid #f2f0ea", paddingTop: 18 }}>
            <div style={{ fontSize: 12, color: "#8b877e", marginBottom: 8 }}>{t("settings.support")}</div>
            <div style={{ fontSize: 13, color: "#4b473f", lineHeight: 1.5, marginBottom: 12 }}>{t("settings.supportText")}</div>
            <a
              href="https://buymeacoffee.com/ImSachaCOHEN/e/571161"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 16px",
                borderRadius: 8,
                border: "1px solid #000",
                background: "#5F7FFF",
                color: "#fff",
                fontSize: 13.5,
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              ☕ {t("settings.buyMeACoffee")}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
