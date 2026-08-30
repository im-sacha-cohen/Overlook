"use client";

import { useState } from "react";
import type { QueryResult } from "@/lib/types";
import { useLang } from "@/lib/i18n/LanguageProvider";

interface Props {
  onRun: (sql: string, allowWrite: boolean) => Promise<QueryResult>;
}

export function QueryConsole({ onRun }: Props) {
  const { t } = useLang();
  const [sql, setSql] = useState("SELECT * FROM ");
  const [allowWrite, setAllowWrite] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      const res = await onRun(sql, allowWrite);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        spellCheck={false}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleRun();
        }}
        style={{
          height: 140,
          resize: "vertical",
          border: "1px solid #e8e5df",
          borderRadius: 10,
          padding: "12px 14px",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          lineHeight: 1.7,
          outline: "none",
          background: "#fff",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#6f6b62" }}>
          <input type="checkbox" checked={allowWrite} onChange={(e) => setAllowWrite(e.target.checked)} />
          {t("queryConsole.allowWrite")}
        </label>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11.5, color: "#a8a39a", fontFamily: "var(--font-mono)" }}>{t("queryConsole.cmdEnterToRun")}</div>
        <button
          onClick={handleRun}
          disabled={running}
          style={{ padding: "7px 14px", background: "var(--accent)", border: "1px solid var(--accent-hover)", borderRadius: 8, color: "#fff", fontWeight: 500, cursor: "pointer" }}
        >
          {running ? t("queryConsole.running") : t("queryConsole.run")}
        </button>
      </div>
      {error && (
        <div style={{ padding: "10px 12px", background: "var(--env-prod-bg)", border: "1px solid var(--env-prod-border)", borderRadius: 9, fontSize: 12.5, color: "var(--env-prod-fg)" }}>
          {error}
        </div>
      )}
      {result && (
        <div className="om-sb" style={{ flex: 1, minHeight: 0, overflow: "auto", border: "1px solid #eceae4", borderRadius: 10 }}>
          {result.columns.length === 0 ? (
            <div style={{ padding: 14, fontSize: 13, color: "#6f6b62" }}>{t("queryConsole.rowsAffected", { count: result.rowCount })}</div>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
              <thead>
                <tr style={{ position: "sticky", top: 0, background: "#f7f6f2" }}>
                  {result.columns.map((c) => (
                    <th key={c} style={{ textAlign: "left", padding: "7px 10px", fontFamily: "var(--font-mono)", fontWeight: 500, color: "#6f6b62", borderBottom: "1px solid #eceae4" }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f4f2ed" }}>
                    {result.columns.map((c) => (
                      <td key={c} style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>
                        {r[c] === null || r[c] === undefined ? <span style={{ color: "#c2bdb3" }}>null</span> : String(r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
