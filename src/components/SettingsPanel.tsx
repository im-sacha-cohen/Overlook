"use client";

import { useEffect, useState } from "react";
import { api, getUserName, setUserName } from "@/lib/client/api";
import type { Connection } from "@/lib/types";
import { useLang } from "@/lib/i18n/LanguageProvider";
import { LANGUAGES } from "@/lib/i18n/translations";
import { ExportConnections, ImportConnections } from "./ConnectionTransfer";

interface Props {
  connections: Connection[];
  onClose: () => void;
  onConnectionsExported: (count: number) => void;
  onConnectionsImported: (created: Connection[]) => void;
}

const sectionBtn: React.CSSProperties = {
  flex: 1,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #e8e5df",
  background: "#fff",
  color: "#4b473f",
  fontSize: 13,
  cursor: "pointer",
};

export function SettingsPanel({ connections, onClose, onConnectionsExported, onConnectionsImported }: Props) {
  const { t, lang, setLang } = useLang();
  const [view, setView] = useState<"main" | "export" | "import">("main");
  const [userName, setUserNameState] = useState(getUserName);
  const [retention, setRetention] = useState("");
  const [retentionStatus, setRetentionStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.getSettings().then((s) => setRetention(String(s.journalRetentionDays))).catch(() => {});
  }, []);

  async function saveRetention() {
    try {
      const saved = await api.saveSettings({ journalRetentionDays: Number(retention) });
      setRetention(String(saved.journalRetentionDays));
      setRetentionStatus({ ok: true, text: t("settings.saved") });
    } catch (err) {
      setRetentionStatus({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  }

  const title = view === "export" ? t("connTransfer.exportTitle") : view === "import" ? t("connTransfer.importTitle") : t("settings.title");

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(35,31,24,0.14)", display: "grid", placeItems: "center", zIndex: 60, animation: "om-fade 0.12s ease" }}>
      <div onClick={(e) => e.stopPropagation()} className="om-sb" style={{ width: view === "main" ? 420 : 480, maxWidth: "calc(100vw - 32px)", maxHeight: "86vh", overflowY: "auto", background: "#fff", border: "1px solid #e5e2db", borderRadius: 13, boxShadow: "var(--shadow-pop)", animation: "om-pop 0.14s ease", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid #f2f0ea" }}>
          <div style={{ fontWeight: 600 }}>{title}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ width: 26, height: 26, background: "transparent", border: "none", borderRadius: 6, color: "#8b877e", cursor: "pointer" }}>
            ✕
          </button>
        </div>

        {view === "export" && (
          <div style={{ padding: 18 }}>
            <ExportConnections connections={connections} onBack={() => setView("main")} onDone={onConnectionsExported} />
          </div>
        )}
        {view === "import" && (
          <div style={{ padding: 18 }}>
            <ImportConnections existing={connections} onBack={() => setView("main")} onDone={onConnectionsImported} />
          </div>
        )}
        {view === "main" && (
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

          <div>
            <div style={{ fontSize: 12, color: "#8b877e", marginBottom: 4 }}>{t("settings.userName")}</div>
            <div style={{ fontSize: 12, color: "#a8a39a", marginBottom: 8 }}>{t("settings.userNameHint")}</div>
            <input
              value={userName}
              onChange={(e) => {
                setUserNameState(e.target.value);
                setUserName(e.target.value);
              }}
              maxLength={100}
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #e8e5df", borderRadius: 8, fontSize: 13, outline: "none" }}
            />
          </div>

          <div>
            <div style={{ fontSize: 12, color: "#8b877e", marginBottom: 8 }}>{t("settings.retention")}</div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveRetention();
              }}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <input
                type="number"
                min={1}
                max={3650}
                value={retention}
                onChange={(e) => {
                  setRetention(e.target.value);
                  setRetentionStatus(null);
                }}
                style={{ width: 90, padding: "8px 10px", border: "1px solid #e8e5df", borderRadius: 8, fontSize: 13, outline: "none" }}
              />
              <span style={{ fontSize: 13, color: "#6f6b62" }}>{t("settings.retentionDays")}</span>
              <button type="submit" style={{ ...sectionBtn, flex: "none" }}>
                {t("common.save")}
              </button>
              {retentionStatus && <span style={{ fontSize: 12, color: retentionStatus.ok ? "#3f9a5c" : "var(--env-prod-fg)" }}>{retentionStatus.text}</span>}
            </form>
          </div>

          <div>
            <div style={{ fontSize: 12, color: "#8b877e", marginBottom: 4 }}>{t("settings.connections")}</div>
            <div style={{ fontSize: 12, color: "#a8a39a", marginBottom: 8 }}>{t("settings.connectionsHint")}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setView("export")} style={sectionBtn}>
                {t("connTransfer.export")}
              </button>
              <button onClick={() => setView("import")} style={sectionBtn}>
                {t("connTransfer.import")}
              </button>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
