"use client";

import { useState } from "react";
import type { LogicalType } from "@/lib/types";

interface Props {
  connectionName: string;
  onCreate: (name: string, columns: { name: string; type: LogicalType }[]) => Promise<void>;
  onClose: () => void;
}

const TYPE_OPTIONS: [LogicalType, string][] = [
  ["text", "Texte"],
  ["number", "Nombre"],
  ["select", "Sélection"],
  ["date", "Date"],
  ["checkbox", "Case"],
  ["json", "JSON"],
];

interface ColDraft {
  name: string;
  type: LogicalType;
}

export function CreateTableModal({ connectionName, onCreate, onClose }: Props) {
  const [name, setName] = useState("");
  const [columns, setColumns] = useState<ColDraft[]>([{ name: "name", type: "text" }]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateColumn(i: number, patch: Partial<ColDraft>) {
    setColumns((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  function addColumn() {
    setColumns((prev) => [...prev, { name: "", type: "text" }]);
  }

  function removeColumn(i: number) {
    setColumns((prev) => prev.filter((_, j) => j !== i));
  }

  async function handleCreate() {
    setError(null);
    if (!name.trim()) return setError("Donne un nom à la table");
    const cleaned = columns.filter((c) => c.name.trim());
    setCreating(true);
    try {
      await onCreate(name.trim(), cleaned);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(35,31,24,0.14)", display: "grid", placeItems: "center", zIndex: 60, animation: "om-fade 0.12s ease" }}>
      <div onClick={(e) => e.stopPropagation()} className="om-sb" style={{ width: 480, maxHeight: "84vh", overflowY: "auto", background: "#fff", border: "1px solid #e5e2db", borderRadius: 13, boxShadow: "var(--shadow-pop)", animation: "om-pop 0.14s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid #f2f0ea" }}>
          <div style={{ fontWeight: 600 }}>Nouvelle table</div>
          <div style={{ fontSize: 12.5, color: "#a8a39a" }}>{connectionName}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ width: 26, height: 26, background: "transparent", border: "none", borderRadius: 6, color: "#8b877e", cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: "#8b877e", marginBottom: 4, display: "block" }}>Nom de la table</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex. projects"
              style={{ width: "100%", border: "1px solid #e8e5df", borderRadius: 8, padding: "8px 10px", outline: "none", fontSize: 13.5 }}
            />
          </div>

          <div style={{ fontSize: 12.5, color: "#8b877e" }}>
            Une colonne <code style={{ fontFamily: "var(--font-mono)" }}>id</code> (clé primaire auto-incrémentée) est ajoutée automatiquement.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {columns.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 6 }}>
                <input
                  value={c.name}
                  onChange={(e) => updateColumn(i, { name: e.target.value })}
                  placeholder="nom de colonne"
                  style={{ flex: 1, minWidth: 0, border: "1px solid #e8e5df", borderRadius: 8, padding: "6px 9px", outline: "none", fontSize: 13 }}
                />
                <select
                  value={c.type}
                  onChange={(e) => updateColumn(i, { type: e.target.value as LogicalType })}
                  style={{ border: "1px solid #e8e5df", borderRadius: 8, padding: "6px 8px", background: "#fff", fontSize: 12.5, cursor: "pointer" }}
                >
                  {TYPE_OPTIONS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => removeColumn(i)}
                  style={{ flex: "none", width: 28, background: "#fff", border: "1px solid #eceae4", borderRadius: 6, color: "#8b877e", cursor: "pointer" }}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={addColumn}
              style={{ alignSelf: "flex-start", padding: "5px 10px", background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 12.5, fontWeight: 500 }}
            >
              + Ajouter une colonne
            </button>
          </div>

          {error && (
            <div style={{ padding: "8px 10px", borderRadius: 8, fontSize: 12.5, background: "var(--env-prod-bg)", color: "var(--env-prod-fg)", border: "1px solid var(--env-prod-border)" }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ padding: "7px 12px", background: "#fff", border: "1px solid #e8e5df", borderRadius: 8, cursor: "pointer", color: "#4b473f" }}>
              Annuler
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              style={{ padding: "7px 13px", background: "var(--accent)", border: "1px solid var(--accent-hover)", borderRadius: 8, color: "#fff", fontWeight: 500, cursor: "pointer" }}
            >
              {creating ? "Création…" : "Créer la table"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
