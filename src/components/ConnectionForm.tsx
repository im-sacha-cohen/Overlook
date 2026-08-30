"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { ENGINE_DEFAULT_PORT, ENGINE_LABELS, ENV_LABELS, type Connection, type ConnectionInput, type EnvType, type Engine } from "@/lib/types";
import { ProdGuardDialog } from "./ProdGuardDialog";

interface Props {
  initial?: Connection;
  onSave: (input: ConnectionInput) => Promise<void>;
  onClose: () => void;
  onDatabaseDropped?: () => void;
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

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#8b877e",
  marginBottom: 4,
  display: "block",
};

export function ConnectionForm({ initial, onSave, onClose, onDatabaseDropped }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [envType, setEnvType] = useState<EnvType>(initial?.envType ?? "local");
  const [engine, setEngine] = useState<Engine>(initial?.engine ?? "postgres");
  const [host, setHost] = useState(initial?.host ?? "localhost");
  const [port, setPort] = useState<string>(String(initial?.port ?? ENGINE_DEFAULT_PORT.postgres ?? ""));
  const [database, setDatabase] = useState(initial?.database ?? "");
  const [user, setUser] = useState(initial?.user ?? "");
  const [password, setPassword] = useState("");
  const [ssl, setSsl] = useState(initial?.ssl ?? false);
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
      ssl: isSqlite ? undefined : ssl,
    };
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      if (initial && !password) {
        await api.testConnection({ id: initial.id });
      } else {
        await api.testConnection(buildInput());
      }
      setTestResult({ ok: true, message: "Connexion réussie" });
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
      await api.createDatabase({
        engine,
        host: isSqlite ? undefined : host,
        port: isSqlite ? undefined : Number(port) || undefined,
        user: isSqlite ? undefined : user,
        password: isSqlite ? undefined : password || undefined,
        ssl: isSqlite ? undefined : ssl,
        database,
      });
      setCreateDbResult({ ok: true, message: "Base créée" });
    } catch (err) {
      setCreateDbResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setCreatingDb(false);
    }
  }

  async function handleSave() {
    setError(null);
    if (!name.trim()) return setError("Donne un nom à la connexion");
    if (!database.trim()) return setError(isSqlite ? "Chemin du fichier requis" : "Nom de la base requis");
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
          <div style={{ fontWeight: 600 }}>{initial ? "Modifier la connexion" : "Nouvelle connexion"}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ width: 26, height: 26, background: "transparent", border: "none", borderRadius: 6, color: "#8b877e", cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={labelStyle}>Nom</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. orders_db" />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Environnement</label>
              <select style={inputStyle} value={envType} onChange={(e) => setEnvType(e.target.value as EnvType)}>
                {(Object.keys(ENV_LABELS) as EnvType[]).map((v) => (
                  <option key={v} value={v}>
                    {ENV_LABELS[v]}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Moteur</label>
              <select
                style={inputStyle}
                value={engine}
                onChange={(e) => {
                  const eng = e.target.value as Engine;
                  setEngine(eng);
                  const port = ENGINE_DEFAULT_PORT[eng];
                  if (port) setPort(String(port));
                }}
                disabled={!!initial}
              >
                {(Object.keys(ENGINE_LABELS) as Engine[]).map((v) => (
                  <option key={v} value={v}>
                    {ENGINE_LABELS[v]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {envType === "prod" && (
            <div style={{ padding: "8px 10px", background: "var(--env-prod-bg)", border: "1px solid var(--env-prod-border)", borderRadius: 8, fontSize: 12.5, color: "var(--env-prod-fg)" }}>
              Connexion de production : les suppressions et modifications de schéma demanderont une confirmation explicite.
            </div>
          )}

          {isSqlite ? (
            <div>
              <label style={labelStyle}>Chemin du fichier</label>
              <input style={inputStyle} value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="./data/example.sqlite" />
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 3 }}>
                  <label style={labelStyle}>Hôte</label>
                  <input style={inputStyle} value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Port</label>
                  <input style={inputStyle} value={port} onChange={(e) => setPort(e.target.value)} />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Base de données</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={{ ...inputStyle, flex: 1 }} value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="ex. postgres" />
                  <button
                    onClick={handleCreateDatabase}
                    disabled={creatingDb || !database.trim()}
                    style={{ flex: "none", padding: "0 10px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 8, cursor: "pointer", color: "#4b473f", fontSize: 12.5, whiteSpace: "nowrap" }}
                  >
                    {creatingDb ? "Création…" : "Créer la base"}
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
                  <label style={labelStyle}>Utilisateur</label>
                  <input style={inputStyle} value={user} onChange={(e) => setUser(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Mot de passe {initial ? "(laisser vide pour ne pas changer)" : ""}</label>
                  <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={ssl} onChange={(e) => setSsl(e.target.checked)} />
                Utiliser SSL
              </label>
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
              {testing ? "Test en cours…" : "Tester la connexion"}
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
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>

          {initial && (
            <div style={{ marginTop: 8, paddingTop: 14, borderTop: "1px solid #f2f0ea" }}>
              <div style={{ fontSize: 11.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--env-prod-fg)", fontWeight: 600, marginBottom: 8 }}>
                Zone dangereuse
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, fontSize: 12.5, color: "#8b877e" }}>
                  Supprime définitivement la base « {initial.database} » sur le serveur (pas seulement cette connexion).
                </div>
                <button
                  onClick={() => setDropDbOpen(true)}
                  style={{ flex: "none", padding: "7px 12px", background: "#fff", border: "1px solid var(--env-prod-border)", borderRadius: 8, color: "var(--env-prod-fg)", cursor: "pointer", fontSize: 12.5, whiteSpace: "nowrap" }}
                >
                  Supprimer la base…
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {initial && dropDbOpen && (
        <ProdGuardDialog
          connectionName={initial.database}
          actionLabel={`Supprimer définitivement la base « ${initial.database} » sur le serveur. Toutes les tables et données seront perdues. Cette action ne peut pas être annulée.`}
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
