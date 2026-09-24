"use client";

import { useMemo, useState } from "react";
import { ENGINE_LABELS, type Connection } from "@/lib/types";
import { api } from "@/lib/client/api";
import { BundleError, MIN_PASSPHRASE_LENGTH, connectionFingerprint, parseBundle, type ConnectionBundle } from "@/lib/connectionBundle";
import { useLang } from "@/lib/i18n/LanguageProvider";
import { EnvPill } from "./EnvPill";

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #e8e5df",
  borderRadius: 8,
  padding: "8px 10px",
  outline: "none",
  fontSize: 13.5,
  background: "#fff",
};

const labelStyle: React.CSSProperties = { fontSize: 12, color: "#8b877e", marginBottom: 4 };

const primaryBtn: React.CSSProperties = {
  padding: "7px 13px",
  background: "var(--accent)",
  border: "1px solid var(--accent-hover)",
  borderRadius: 8,
  color: "#fff",
  fontWeight: 500,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  padding: "7px 12px",
  background: "#fff",
  border: "1px solid #e8e5df",
  borderRadius: 8,
  cursor: "pointer",
  color: "#4b473f",
};

function describe(c: { engine: Connection["engine"]; host?: string; port?: number; database: string; user?: string }): string {
  if (c.engine === "sqlite") return `${ENGINE_LABELS.sqlite} · ${c.database}`;
  const host = c.host ? `${c.user ? `${c.user}@` : ""}${c.host}${c.port ? `:${c.port}` : ""}` : "";
  return `${ENGINE_LABELS[c.engine]} · ${host ? `${host}/` : ""}${c.database}`;
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div style={{ padding: "8px 10px", borderRadius: 8, fontSize: 12.5, background: "var(--env-prod-bg)", color: "var(--env-prod-fg)", border: "1px solid var(--env-prod-border)" }}>
      {message}
    </div>
  );
}

function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warn" }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        padding: "1px 6px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        background: tone === "warn" ? "var(--env-staging-bg)" : "#f4f2ed",
        color: tone === "warn" ? "var(--env-staging-fg)" : "#8b877e",
      }}
    >
      {children}
    </span>
  );
}

function SelectionHeader({ selected, total, onToggleAll }: { selected: number; total: number; onToggleAll: () => void }) {
  const { t } = useLang();
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
      <div style={{ fontSize: 12, color: "#8b877e" }}>{t("connTransfer.selected", { selected, total })}</div>
      <div style={{ flex: 1 }} />
      <button onClick={onToggleAll} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 12 }}>
        {selected === total ? t("connTransfer.deselectAll") : t("connTransfer.selectAll")}
      </button>
    </div>
  );
}

const listBox: React.CSSProperties = { maxHeight: 220, overflowY: "auto", border: "1px solid #f0eee9", borderRadius: 8, padding: 4 };
const rowStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", gap: 9, padding: "7px 6px", fontSize: 13, cursor: "pointer", borderRadius: 6 };

function toggleIn<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

// ---------- export ----------

export function ExportConnections({ connections, onBack, onDone }: { connections: Connection[]; onBack: () => void; onDone: (count: number) => void }) {
  const { t } = useLang();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(connections.map((c) => c.id)));
  const [includePasswords, setIncludePasswords] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setError(null);
    if (selected.size === 0) return setError(t("connTransfer.needSelection"));
    if (includePasswords) {
      if (passphrase.length < MIN_PASSPHRASE_LENGTH) return setError(t("connTransfer.passphraseTooShort", { min: MIN_PASSPHRASE_LENGTH }));
      if (passphrase !== confirm) return setError(t("connTransfer.passphraseMismatch"));
    }
    setBusy(true);
    try {
      const { blob, filename } = await api.exportConnections({
        ids: connections.filter((c) => selected.has(c.id)).map((c) => c.id),
        includePasswords,
        passphrase: includePasswords ? passphrase : undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      onDone(selected.size);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (connections.length === 0) {
    return <div style={{ fontSize: 13, color: "#a8a39a" }}>{t("connTransfer.noConnections")}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <SelectionHeader
          selected={selected.size}
          total={connections.length}
          onToggleAll={() => setSelected((prev) => (prev.size === connections.length ? new Set() : new Set(connections.map((c) => c.id))))}
        />
        <div className="om-sb" style={listBox}>
          {connections.map((c) => (
            <label key={c.id} style={rowStyle}>
              <input type="checkbox" checked={selected.has(c.id)} onChange={() => setSelected((prev) => toggleIn(prev, c.id))} style={{ marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  <EnvPill env={c.envType} small />
                </div>
                <div style={{ fontSize: 11.5, color: "#a8a39a", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{describe(c)}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={includePasswords} onChange={(e) => setIncludePasswords(e.target.checked)} />
          {t("connTransfer.includePasswords")}
        </label>
        {!includePasswords ? (
          <div style={{ fontSize: 12, color: "#a8a39a", marginTop: 6 }}>{t("connTransfer.passwordsOffHint")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10, padding: 12, borderRadius: 8, background: "#faf9f6", border: "1px solid #f0eee9" }}>
            <div style={{ fontSize: 12.5, color: "#6f6b62", lineHeight: 1.5 }}>{t("connTransfer.passphraseIntro")}</div>
            <div>
              <div style={labelStyle}>{t("connTransfer.passphrase")}</div>
              <input
                type="password"
                autoComplete="new-password"
                placeholder={t("connTransfer.passphrasePlaceholder", { min: MIN_PASSPHRASE_LENGTH })}
                style={inputStyle}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </div>
            <div>
              <div style={labelStyle}>{t("connTransfer.passphraseConfirm")}</div>
              <input type="password" autoComplete="new-password" style={inputStyle} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <div style={{ fontSize: 12, color: "#a8a39a", lineHeight: 1.5 }}>{t("connTransfer.passphraseHint")}</div>
          </div>
        )}
      </div>

      {error && <ErrorBox message={error} />}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onBack} style={secondaryBtn}>
          {t("connTransfer.back")}
        </button>
        <button onClick={handleExport} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
          {busy ? t("common.confirmRunning") : t("connTransfer.exportSubmit", { count: selected.size })}
        </button>
      </div>
    </div>
  );
}

// ---------- import ----------

export function ImportConnections({ existing, onBack, onDone }: { existing: Connection[]; onBack: () => void; onDone: (created: Connection[], replacedAll: boolean) => void }) {
  const { t, lang } = useLang();
  const [file, setFile] = useState<{ name: string; bundle: ConnectionBundle } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [passphrase, setPassphrase] = useState("");
  const [replaceAll, setReplaceAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const existingFingerprints = useMemo(() => new Set(existing.map(connectionFingerprint)), [existing]);
  const bundle = file?.bundle ?? null;

  // Nothing is left to duplicate once the list is wiped: take the whole file by default.
  function toggleReplaceAll(on: boolean) {
    setReplaceAll(on);
    if (on && bundle) setSelected(new Set(bundle.connections.map((_, i) => i)));
  }
  const needsPassphrase = !!bundle?.encryption && [...selected].some((i) => bundle.connections[i]?.password);

  async function handleFile(f: File | undefined) {
    setError(null);
    setFile(null);
    setReplaceAll(false);
    if (!f) return;
    try {
      const parsed = parseBundle(JSON.parse(await f.text()));
      setFile({ name: f.name, bundle: parsed });
      // Pre-select everything that isn't already configured here.
      setSelected(new Set(parsed.connections.map((c, i) => (existingFingerprints.has(connectionFingerprint(c)) ? -1 : i)).filter((i) => i >= 0)));
    } catch (err) {
      setError(err instanceof BundleError && err.code === "unsupportedVersion" ? t("connTransfer.unsupportedVersion") : t("connTransfer.invalidFile"));
    }
  }

  async function handleImport() {
    if (!bundle) return;
    setError(null);
    if (selected.size === 0) return setError(t("connTransfer.needSelection"));
    if (needsPassphrase && passphrase.length < MIN_PASSPHRASE_LENGTH) return setError(t("connTransfer.passphraseTooShort", { min: MIN_PASSPHRASE_LENGTH }));
    if (replaceAll && !window.confirm(t("connTransfer.replaceAllConfirm", { count: existing.length, imported: selected.size }))) return;
    setBusy(true);
    try {
      const { connections } = await api.importConnections({
        bundle,
        indices: [...selected].sort((a, b) => a - b),
        passphrase: needsPassphrase ? passphrase : undefined,
        replaceAll,
      });
      onDone(connections, replaceAll);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const exportedOn = bundle?.exportedAt ? new Date(bundle.exportedAt) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <label style={{ ...secondaryBtn, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 12px", borderStyle: "dashed", fontSize: 13 }}>
        <input type="file" accept="application/json,.json" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files?.[0])} />
        {file
          ? t("connTransfer.fileLoaded", {
              name: file.name,
              count: file.bundle.connections.length,
              date: exportedOn && !Number.isNaN(exportedOn.getTime()) ? exportedOn.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US") : "?",
            })
          : t("connTransfer.chooseFile")}
      </label>

      {bundle && (
        <div>
          <SelectionHeader
            selected={selected.size}
            total={bundle.connections.length}
            onToggleAll={() => setSelected((prev) => (prev.size === bundle.connections.length ? new Set() : new Set(bundle.connections.map((_, i) => i))))}
          />
          <div className="om-sb" style={listBox}>
            {bundle.connections.map((c, i) => {
              const duplicate = !replaceAll && existingFingerprints.has(connectionFingerprint(c));
              return (
                <label key={i} style={{ ...rowStyle, opacity: duplicate && !selected.has(i) ? 0.6 : 1 }}>
                  <input type="checkbox" checked={selected.has(i)} onChange={() => setSelected((prev) => toggleIn(prev, i))} style={{ marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 500 }}>{c.name}</span>
                      <EnvPill env={c.envType} small />
                      {c.folder && <Tag>{t("connTransfer.inFolder", { folder: c.folder })}</Tag>}
                      {c.password && <Tag>{t("connTransfer.hasPassword")}</Tag>}
                      {duplicate && <Tag tone="warn">{t("connTransfer.duplicate")}</Tag>}
                    </div>
                    <div style={{ fontSize: 11.5, color: "#a8a39a", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{describe(c)}</div>
                    {c.engine === "sqlite" && <div style={{ fontSize: 11.5, color: "#a8a39a", marginTop: 2 }}>{t("connTransfer.sqliteHint")}</div>}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {bundle && existing.length > 0 && (
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={replaceAll} onChange={(e) => toggleReplaceAll(e.target.checked)} />
            {t("connTransfer.replaceAll")}
          </label>
          {replaceAll ? (
            <div style={{ marginTop: 8 }}>
              <ErrorBox message={t("connTransfer.replaceAllWarning", { count: existing.length })} />
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#a8a39a", marginTop: 6 }}>{t("connTransfer.replaceAllOffHint")}</div>
          )}
        </div>
      )}

      {needsPassphrase && (
        <div>
          <div style={labelStyle}>{t("connTransfer.passphraseImport")}</div>
          <input type="password" autoComplete="off" style={inputStyle} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          <div style={{ fontSize: 12, color: "#a8a39a", marginTop: 6 }}>{t("connTransfer.importPassphraseHint")}</div>
        </div>
      )}

      {error && <ErrorBox message={error} />}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onBack} style={secondaryBtn}>
          {t("connTransfer.back")}
        </button>
        {bundle && (
          <button
            onClick={handleImport}
            disabled={busy}
            style={{ ...primaryBtn, ...(replaceAll ? { background: "var(--env-prod-fg)", borderColor: "var(--env-prod-fg)" } : {}), opacity: busy ? 0.6 : 1 }}
          >
            {busy ? t("common.confirmRunning") : t(replaceAll ? "connTransfer.replaceAllSubmit" : "connTransfer.importSubmit", { count: selected.size })}
          </button>
        )}
      </div>
    </div>
  );
}

// Standalone dialog for the welcome screen, where Settings isn't reachable yet.
export function ConnectionImportModal({ existing, onClose, onDone }: { existing: Connection[]; onClose: () => void; onDone: (created: Connection[], replacedAll: boolean) => void }) {
  const { t } = useLang();
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(35,31,24,0.14)", display: "grid", placeItems: "center", zIndex: 60, animation: "om-fade 0.12s ease" }}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="om-sb"
        style={{ width: 480, maxWidth: "calc(100vw - 32px)", maxHeight: "86vh", overflowY: "auto", background: "#fff", border: "1px solid #e5e2db", borderRadius: 13, boxShadow: "var(--shadow-pop)", animation: "om-pop 0.14s ease", textAlign: "left" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid #f2f0ea" }}>
          <div style={{ fontWeight: 600 }}>{t("connTransfer.importTitle")}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ width: 26, height: 26, background: "transparent", border: "none", borderRadius: 6, color: "#8b877e", cursor: "pointer" }}>
            ✕
          </button>
        </div>
        <div style={{ padding: 18 }}>
          <ImportConnections existing={existing} onBack={onClose} onDone={onDone} />
        </div>
      </div>
    </div>
  );
}
