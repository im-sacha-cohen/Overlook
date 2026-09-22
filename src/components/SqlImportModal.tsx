"use client";

import { useRef, useState } from "react";
import { useLang } from "@/lib/i18n/LanguageProvider";

/** What gets sent: a chosen file goes as is, straight from disk, never read into the page. */
export interface SqlImportSource {
  body: Blob;
  fileName?: string;
}

interface Props {
  connectionName: string;
  onImport: (source: SqlImportSource) => void;
  onClose: () => void;
}

const PREVIEW_BYTES = 2048;

function formatSize(bytes: number, locale: string): string {
  const units = locale === "fr-FR" ? ["o", "Ko", "Mo", "Go"] : ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`;
}

export function SqlImportModal({ connectionName, onImport, onClose }: Props) {
  const { t, lang } = useLang();
  const locale = lang === "fr" ? "fr-FR" : "en-US";
  const [sql, setSql] = useState("");
  // A file is only previewed: putting a dump of hundreds of MB in the textarea freezes the tab.
  const [file, setFile] = useState<{ file: File; preview: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(chosen: File) {
    setError(null);
    const preview = await chosen.slice(0, PREVIEW_BYTES).text();
    setFile({ file: chosen, preview: chosen.size > PREVIEW_BYTES ? `${preview}…` : preview });
  }

  function handleImport() {
    setError(null);
    if (file) {
      onImport({ body: file.file, fileName: file.file.name });
      return;
    }
    if (!sql.trim()) {
      setError(t("sqlImport.needSql"));
      return;
    }
    onImport({ body: new Blob([sql]) });
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
          {file ? (
            <div style={{ border: "1px solid #e8e5df", borderRadius: 9, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#faf9f6", borderBottom: "1px solid #f2f0ea", fontSize: 12.5 }}>
                <span style={{ fontWeight: 500, color: "#26241f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.file.name}</span>
                <span style={{ color: "#a8a39a", flexShrink: 0 }}>{formatSize(file.file.size, locale)}</span>
                <div style={{ flex: 1 }} />
                <button onClick={() => setFile(null)} style={{ background: "transparent", border: "none", color: "#8b877e", cursor: "pointer", fontSize: 12, flexShrink: 0 }}>
                  {t("sqlImport.removeFile")}
                </button>
              </div>
              <pre style={{ margin: 0, height: 200, overflow: "auto", padding: "10px 12px", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.6, color: "#6b675f", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {file.preview}
              </pre>
            </div>
          ) : (
            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              spellCheck={false}
              placeholder={t("sqlImport.placeholder")}
              style={{ height: 240, resize: "vertical", border: "1px solid #e8e5df", borderRadius: 9, padding: "10px 12px", fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.7, outline: "none" }}
            />
          )}
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
