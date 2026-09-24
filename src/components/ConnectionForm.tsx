"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { ENGINE_DEFAULT_PORT, ENGINE_LABELS, ENV_LABELS, SSL_MODES, type Connection, type ConnectionInput, type EnvType, type Engine, type SslMode } from "@/lib/types";
import { SecretFileField } from "./SecretFileField";
import { ProdGuardDialog } from "./ProdGuardDialog";
import { useLang } from "@/lib/i18n/LanguageProvider";
import { Select } from "./Select";

interface Props {
  initial?: Connection;
  onSave: (input: ConnectionInput) => Promise<void>;
  onClose: () => void;
  onDatabaseDropped?: () => void;
  dockerDetected?: boolean;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #e8e5df",
  borderRadius: 8,
  padding: "8px 10px",
  outline: "none",
  fontSize: 13.5,
  background: "#fff",
};

// Same height and text size as the text fields next to them.
const selectStyle: React.CSSProperties = { width: "100%", height: 36, fontSize: 13.5 };

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#8b877e",
  marginBottom: 4,
  display: "block",
};

export function ConnectionForm({ initial, onSave, onClose, onDatabaseDropped, dockerDetected }: Props) {
  const { t } = useLang();
  const [name, setName] = useState(initial?.name ?? "");
  const [envType, setEnvType] = useState<EnvType>(initial?.envType ?? "local");
  const [engine, setEngine] = useState<Engine>(initial?.engine ?? "postgres");
  const [host, setHost] = useState(initial?.host ?? (dockerDetected ? "host.docker.internal" : "localhost"));
  const [port, setPort] = useState<string>(String(initial?.port ?? ENGINE_DEFAULT_PORT.postgres ?? ""));
  const [database, setDatabase] = useState(initial?.database ?? "");
  const [user, setUser] = useState(initial?.user ?? "");
  const [password, setPassword] = useState("");
  const [sslMode, setSslMode] = useState<SslMode>(initial?.sslMode ?? (initial?.ssl ? "require" : "disable"));
  const [sslCa, setSslCa] = useState<string | undefined>(undefined);
  const [sslCert, setSslCert] = useState<string | undefined>(undefined);
  const [sslKey, setSslKey] = useState<string | undefined>(undefined);
  const [sshEnabled, setSshEnabled] = useState(!!initial?.ssh);
  const [sshHost, setSshHost] = useState(initial?.ssh?.host ?? "");
  const [sshPort, setSshPort] = useState(String(initial?.ssh?.port ?? 22));
  const [sshUser, setSshUser] = useState(initial?.ssh?.user ?? "");
  const [sshAuth, setSshAuth] = useState<"password" | "key">(initial?.ssh?.auth ?? "key");
  const [sshPassword, setSshPassword] = useState("");
  const [sshPrivateKey, setSshPrivateKey] = useState<string | undefined>(undefined);
  const [sshPassphrase, setSshPassphrase] = useState("");
  const stored = new Set(initial?.storedSecrets ?? []);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingDb, setCreatingDb] = useState(false);
  const [createDbResult, setCreateDbResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [dropDbOpen, setDropDbOpen] = useState(false);

  const isSqlite = engine === "sqlite";

  function buildInput(): ConnectionInput {
    return {
      name,
      envType,
      engine,
      host: isSqlite ? undefined : host,
      port: isSqlite ? undefined : Number(port) || undefined,
      database,
      user: isSqlite ? undefined : user,
      password: isSqlite ? undefined : password || undefined,
      ...(isSqlite
        ? {}
        : {
            sslMode,
            sslCa,
            sslCert,
            sslKey,
            ssh: sshEnabled ? { host: sshHost.trim(), port: Number(sshPort) || 22, user: sshUser.trim(), auth: sshAuth } : null,
            // Typed fields replace the saved secret; the other auth method's secret is dropped.
            sshPassword: sshEnabled && sshAuth === "password" ? sshPassword || undefined : stored.has("sshPassword") ? "" : undefined,
            sshPrivateKey: sshEnabled && sshAuth === "key" ? sshPrivateKey : stored.has("sshPrivateKey") ? "" : undefined,
            sshPassphrase: sshEnabled && sshAuth === "key" ? sshPassphrase || undefined : stored.has("sshPassphrase") ? "" : undefined,
          }),
    };
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      // Editing: the server fills in what wasn't retyped from the saved connection.
      await api.testConnection(initial ? { id: initial.id, ...buildInput() } : buildInput());
      setTestResult({ ok: true, message: t("connectionForm.testSuccess") });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  async function handleCreateDatabase() {
    setCreatingDb(true);
    setCreateDbResult(null);
    try {
      await api.createDatabase(initial ? { id: initial.id, ...buildInput() } : buildInput());
      setCreateDbResult({ ok: true, message: t("connectionForm.dbCreated") });
    } catch (err) {
      setCreateDbResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setCreatingDb(false);
    }
  }

  async function handleSave() {
    setError(null);
    if (!name.trim()) return setError(t("connectionForm.nameRequired"));
    if (!database.trim()) return setError(isSqlite ? t("connectionForm.filePathRequired") : t("connectionForm.dbNameRequired"));
    setSaving(true);
    try {
      await onSave(buildInput());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(35,31,24,0.14)",
        display: "grid",
        placeItems: "center",
        zIndex: 60,
        animation: "om-fade 0.12s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="om-sb"
        style={{
          width: 460,
          maxHeight: "84vh",
          overflowY: "auto",
          background: "#fff",
          border: "1px solid #e5e2db",
          borderRadius: 13,
          boxShadow: "var(--shadow-pop)",
          animation: "om-pop 0.14s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid #f2f0ea" }}>
          <div style={{ fontWeight: 600 }}>{initial ? t("connectionForm.editTitle") : t("connectionForm.newTitle")}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ width: 26, height: 26, background: "transparent", border: "none", borderRadius: 6, color: "#8b877e", cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={labelStyle}>{t("connectionForm.name")}</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("connectionForm.namePlaceholder")} />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t("connectionForm.environment")}</label>
              <Select style={selectStyle} value={envType} onChange={setEnvType} options={(Object.keys(ENV_LABELS) as EnvType[]).map((v) => ({ value: v, label: ENV_LABELS[v] }))} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t("connectionForm.engine")}</label>
              <Select
                style={selectStyle}
                value={engine}
                onChange={(eng) => {
                  setEngine(eng);
                  const port = ENGINE_DEFAULT_PORT[eng];
                  if (port) setPort(String(port));
                }}
                disabled={!!initial}
                options={(Object.keys(ENGINE_LABELS) as Engine[]).map((v) => ({ value: v, label: ENGINE_LABELS[v] }))}
              />
            </div>
          </div>

          {envType === "prod" && (
            <div style={{ padding: "8px 10px", background: "var(--env-prod-bg)", border: "1px solid var(--env-prod-border)", borderRadius: 8, fontSize: 12.5, color: "var(--env-prod-fg)" }}>
              {t("connectionForm.prodWarning")}
            </div>
          )}

          {isSqlite ? (
            <div>
              <label style={labelStyle}>{t("connectionForm.filePath")}</label>
              <input style={inputStyle} value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="./data/example.sqlite" />
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 3 }}>
                  <label style={labelStyle}>{t("connectionForm.host")}</label>
                  <input style={inputStyle} value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" />
                  {dockerDetected && (() => {
                    const alreadyApplied = host === "host.docker.internal";
                    return (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ fontSize: 11.5, color: "#8b877e", marginBottom: 4 }}>
                          {t("connectionForm.dockerHostHint")}
                        </div>
                        <button
                          type="button"
                          onClick={() => setHost("host.docker.internal")}
                          disabled={alreadyApplied}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "3px 9px",
                            background: alreadyApplied ? "#eef7f0" : "#eef4ff",
                            border: `1px solid ${alreadyApplied ? "#cfe8d8" : "#cddcf7"}`,
                            borderRadius: 999,
                            color: alreadyApplied ? "#2f7a4d" : "#3a5fc4",
                            cursor: alreadyApplied ? "default" : "pointer",
                            fontSize: 11.5,
                            fontWeight: 500,
                          }}
                        >
                          <span aria-hidden>🐳</span>
                          {alreadyApplied ? t("connectionForm.dockerHostHintApplied") : t("connectionForm.dockerHostHintAction")}
                        </button>
                      </div>
                    );
                  })()}
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>{t("connectionForm.port")}</label>
                  <input style={inputStyle} value={port} onChange={(e) => setPort(e.target.value)} />
                </div>
              </div>
              <div>
                <label style={labelStyle}>{t("connectionForm.database")}</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={{ ...inputStyle, flex: 1 }} value={database} onChange={(e) => setDatabase(e.target.value)} placeholder={t("connectionForm.databasePlaceholder")} />
                  <button
                    onClick={handleCreateDatabase}
                    disabled={creatingDb || !database.trim()}
                    style={{ flex: "none", padding: "0 10px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 8, cursor: "pointer", color: "#4b473f", fontSize: 12.5, whiteSpace: "nowrap" }}
                  >
                    {creatingDb ? t("connectionForm.creatingDb") : t("connectionForm.createDb")}
                  </button>
                </div>
                {createDbResult && (
                  <div style={{ marginTop: 6, fontSize: 12, color: createDbResult.ok ? "var(--env-local-fg)" : "var(--env-prod-fg)" }}>
                    {createDbResult.message}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>{t("connectionForm.user")}</label>
                  <input style={inputStyle} value={user} onChange={(e) => setUser(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>{t("connectionForm.password")} {initial ? t("connectionForm.passwordKeepHint") : ""}</label>
                  <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              </div>
              <div style={{ padding: 12, borderRadius: 9, border: "1px solid #f0eee9", background: "#fcfbf9", display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <label style={labelStyle}>{t("connectionForm.sslMode")}</label>
                  <Select style={selectStyle} value={sslMode} onChange={setSslMode} options={SSL_MODES.map((m) => ({ value: m, label: t(`connectionForm.sslMode.${m}`) }))} />
                </div>
                {sslMode !== "disable" && (
                  <>
                    <SecretFileField label={t("connectionForm.sslCa")} stored={stored.has("sslCa")} value={sslCa} onChange={setSslCa} />
                    <SecretFileField label={t("connectionForm.sslCert")} stored={stored.has("sslCert")} value={sslCert} onChange={setSslCert} />
                    <SecretFileField label={t("connectionForm.sslKey")} stored={stored.has("sslKey")} value={sslKey} onChange={setSslKey} />
                    <div style={{ fontSize: 11.5, color: "#a8a39a" }}>{t("connectionForm.sslFilesHint")}</div>
                  </>
                )}
              </div>

              <div style={{ padding: 12, borderRadius: 9, border: "1px solid #f0eee9", background: "#fcfbf9", display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500 }}>
                  <input type="checkbox" checked={sshEnabled} onChange={(e) => setSshEnabled(e.target.checked)} />
                  {t("connectionForm.sshTunnel")}
                </label>
                {sshEnabled && (
                  <>
                    <div style={{ fontSize: 11.5, color: "#a8a39a" }}>{t("connectionForm.sshHint")}</div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <div style={{ flex: 3 }}>
                        <label style={labelStyle}>{t("connectionForm.sshHost")}</label>
                        <input style={inputStyle} value={sshHost} onChange={(e) => setSshHost(e.target.value)} placeholder="bastion.example.com" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={labelStyle}>{t("connectionForm.port")}</label>
                        <input style={inputStyle} value={sshPort} onChange={(e) => setSshPort(e.target.value)} />
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <label style={labelStyle}>{t("connectionForm.user")}</label>
                        <input style={inputStyle} value={sshUser} onChange={(e) => setSshUser(e.target.value)} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={labelStyle}>{t("connectionForm.sshAuth")}</label>
                        <Select<"password" | "key">
                          style={selectStyle}
                          value={sshAuth}
                          onChange={setSshAuth}
                          options={[
                            { value: "key", label: t("connectionForm.sshAuthKey") },
                            { value: "password", label: t("connectionForm.password") },
                          ]}
                        />
                      </div>
                    </div>
                    {sshAuth === "password" ? (
                      <div>
                        <label style={labelStyle}>
                          {t("connectionForm.password")} {stored.has("sshPassword") ? t("connectionForm.passwordKeepHint") : ""}
                        </label>
                        <input style={inputStyle} type="password" value={sshPassword} onChange={(e) => setSshPassword(e.target.value)} />
                      </div>
                    ) : (
                      <>
                        <SecretFileField label={t("connectionForm.sshPrivateKey")} stored={stored.has("sshPrivateKey")} value={sshPrivateKey} onChange={setSshPrivateKey} />
                        <div>
                          <label style={labelStyle}>
                            {t("connectionForm.sshPassphrase")} {stored.has("sshPassphrase") ? t("connectionForm.passwordKeepHint") : ""}
                          </label>
                          <input style={inputStyle} type="password" value={sshPassphrase} onChange={(e) => setSshPassphrase(e.target.value)} />
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {testResult && (
            <div
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                fontSize: 12.5,
                background: testResult.ok ? "var(--env-local-bg)" : "var(--env-prod-bg)",
                color: testResult.ok ? "var(--env-local-fg)" : "var(--env-prod-fg)",
                border: `1px solid ${testResult.ok ? "var(--env-local-border)" : "var(--env-prod-border)"}`,
              }}
            >
              {testResult.message}
            </div>
          )}
          {error && (
            <div style={{ padding: "8px 10px", borderRadius: 8, fontSize: 12.5, background: "var(--env-prod-bg)", color: "var(--env-prod-fg)", border: "1px solid var(--env-prod-border)" }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
            <button
              onClick={handleTest}
              disabled={testing}
              style={{ padding: "7px 12px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 8, cursor: "pointer", color: "#4b473f" }}
            >
              {testing ? t("connectionForm.testing") : t("connectionForm.testConnection")}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: "7px 13px",
                background: "var(--accent)",
                border: "1px solid var(--accent-hover)",
                borderRadius: 8,
                color: "#fff",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {saving ? t("connectionForm.saving") : t("connectionForm.save")}
            </button>
          </div>

          {initial && (
            <div style={{ marginTop: 8, paddingTop: 14, borderTop: "1px solid #f2f0ea" }}>
              <div style={{ fontSize: 11.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--env-prod-fg)", fontWeight: 600, marginBottom: 8 }}>
                {t("connectionForm.dangerZone")}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, fontSize: 12.5, color: "#8b877e" }}>
                  {t("connectionForm.dropDbHint", { name: initial.database })}
                </div>
                <button
                  onClick={() => setDropDbOpen(true)}
                  style={{ flex: "none", padding: "7px 12px", background: "#fff", border: "1px solid var(--env-prod-border)", borderRadius: 8, color: "var(--env-prod-fg)", cursor: "pointer", fontSize: 12.5, whiteSpace: "nowrap" }}
                >
                  {t("connectionForm.dropDb")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {initial && dropDbOpen && (
        <ProdGuardDialog
          connectionName={initial.database}
          actionLabel={t("connectionForm.dropDbConfirmAction", { name: initial.database })}
          onConfirm={async () => {
            await api.dropDatabase(initial.id, initial.database);
            setDropDbOpen(false);
            onDatabaseDropped?.();
          }}
          onCancel={() => setDropDbOpen(false)}
        />
      )}
    </div>
  );
}
