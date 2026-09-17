"use client";

import { useRef, useState } from "react";
import { useLang } from "@/lib/i18n/LanguageProvider";

interface Props {
  label: string;
  /** A value is already saved on the server. */
  stored: boolean;
  /** undefined: keep what's saved. "": remove it. Otherwise the new content. */
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}

/** A PEM file (certificate or key) picked from disk or pasted, never shown back once saved. */
export function SecretFileField({ label, stored, value, onChange }: Props) {
  const { t } = useLang();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasting, setPasting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const status =
    value !== undefined && value !== ""
      ? t("secretFile.new", { name: fileName ?? t("secretFile.pasted") })
      : value === "" && stored
        ? t("secretFile.willRemove")
        : stored
          ? t("secretFile.saved")
          : t("secretFile.none");

  const btn: React.CSSProperties = { padding: "3px 8px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 6, fontSize: 12, color: "#4b473f", cursor: "pointer" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "#8b877e", minWidth: 110 }}>{label}</span>
        <span style={{ fontSize: 12, color: value ? "var(--env-local-fg)" : "#a8a39a", flex: 1 }}>{status}</span>
        <button type="button" style={btn} onClick={() => fileRef.current?.click()}>
          {t("secretFile.chooseFile")}
        </button>
        <button type="button" style={btn} onClick={() => setPasting((p) => !p)}>
          {t("secretFile.paste")}
        </button>
        {(stored || value) && value !== "" && (
          <button
            type="button"
            style={btn}
            onClick={() => {
              setFileName(null);
              setPasting(false);
              onChange(stored ? "" : undefined);
            }}
          >
            {t("secretFile.remove")}
          </button>
        )}
        {value === "" && stored && (
          <button type="button" style={btn} onClick={() => onChange(undefined)}>
            {t("common.cancel")}
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".pem,.crt,.cer,.key,text/plain"
        style={{ display: "none" }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setFileName(file.name);
          onChange(await file.text());
        }}
      />
      {pasting && (
        <textarea
          autoFocus
          spellCheck={false}
          placeholder="-----BEGIN …-----"
          onChange={(e) => {
            setFileName(null);
            onChange(e.target.value || undefined);
          }}
          style={{ marginTop: 6, width: "100%", boxSizing: "border-box", height: 90, border: "1px solid #e8e5df", borderRadius: 8, padding: "6px 8px", fontFamily: "var(--font-mono)", fontSize: 11.5, outline: "none" }}
        />
      )}
    </div>
  );
}
