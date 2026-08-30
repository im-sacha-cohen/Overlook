"use client";

import { useRef, useState } from "react";
import { useLang } from "@/lib/i18n/LanguageProvider";

interface Props {
  connectionName: string;
  onImport: (sql: string) => void;
  onClose: () => void;
}

export function SqlImportModal({ connectionName, onImport, onClose }: Props) {
  const { t } = useLang();
  const [sql, setSql] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    const text = await file.text();
    setSql(text);
  }

  function handleImport() {
    setError(null);
    if (!sql.trim()) {
      setError(t("sqlImport.needSql"));
      return;
    }
    onImport(sql);
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(35,31,24,0.14)", display: "grid", placeItems: "center", zIndex: 45, animation: "om-fade 0.12s ease" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 640, background: "#fff", border: "1px solid #e5e2db", borderRadius: 13, boxShadow: "var(--shadow-pop)", overflow: "hidden", animation: "om-pop 0.14s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid #f2f0ea" }}>
          <div style={{ fontWeight: 600 }}>{t("sqlImport.title")}</div>
          <div style={{ fontSize: 12.5, color: "#a8a39a" }}>{t("sqlImport.toConnection", { name: connectionName })}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ width: 26, height: 26, background: "transparent", border: "none", borderRadius: 6, color: "#8b877e", cursor: "pointer" }}>
            ✕
          </button>
        </div>
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12.5, color: "#8b877e" }}>
            {t("sqlImport.hint")}
          </div>
          <div>
            <button
              onClick={() => fileRef.current?.click()}
              style={{ padding: "6px 11px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 8, cursor: "pointer", color: "#4b473f", fontSize: 12.5 }}
            >
              {t("sqlImport.chooseFile")}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".sql,text/plain"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
          </div>
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            spellCheck={false}
            placeholder={t("sqlImport.placeholder")}
            style={{ height: 240, resize: "vertical", border: "1px solid #e8e5df", borderRadius: 9, padding: "10px 12px", fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.7, outline: "none" }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {error && <div style={{ fontSize: 12.5, color: "var(--env-prod-fg)" }}>{error}</div>}
            <div style={{ flex: 1 }} />
            <button onClick={onClose} style={{ padding: "7px 12px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 8, cursor: "pointer", color: "#4b473f" }}>
              {t("common.cancel")}
            </button>
            <button
              onClick={handleImport}
              style={{ padding: "7px 13px", background: "var(--accent)", border: "1px solid var(--accent-hover)", borderRadius: 8, color: "#fff", fontWeight: 500, cursor: "pointer" }}
            >
              {t("sqlImport.import")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
