import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Overlook — the database editor that can't lie to you about prod";

const bg = "#fbfbfa";
const fg = "#26241f";
const border = "#e3e1d9";
const blue = "#3275b4";
const muted = "#5c594e";

function LogoMark() {
  const cell = (filled: boolean) => (
    <div
      style={{
        width: 20,
        height: 20,
        borderRadius: 4,
        display: "flex",
        background: filled ? blue : "transparent",
        border: filled ? "none" : `4px solid ${blue}`,
      }}
    />
  );
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        borderRadius: 14,
        border: `5px solid ${blue}`,
      }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        {cell(false)}
        {cell(false)}
        {cell(true)}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {cell(false)}
        {cell(false)}
        {cell(false)}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {cell(false)}
        {cell(false)}
        {cell(false)}
      </div>
    </div>
  );
}

function EnvChip({
  label,
  fillColor,
  textColor,
  emphasize,
}: {
  label: string;
  fillColor: string;
  textColor: string;
  emphasize?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: emphasize ? "12px 28px" : "10px 24px",
        borderRadius: 999,
        background: fillColor,
        color: textColor,
        fontSize: 24,
        fontWeight: 600,
      }}
    >
      {label}
    </div>
  );
}

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: bg,
          border: `2px solid ${border}`,
          padding: 80,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <LogoMark />
          <span style={{ fontSize: 32, fontWeight: 600, color: fg }}>overlook</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 66, fontWeight: 600, color: fg, lineHeight: 1.15 }}>
            <span>The database editor that</span>
            <div style={{ display: "flex" }}>
              <span>can&apos;t lie to you about</span>
              <span style={{ marginLeft: 20, color: "#b4322f" }}>prod</span>
            </div>
          </div>
          <span style={{ fontSize: 26, color: muted }}>
            Free, open-source, self-hosted — Postgres / MySQL / SQLite
          </span>
        </div>

        <div style={{ display: "flex", gap: 16 }}>
          <EnvChip label="Local" fillColor="#e7f0ea" textColor="#2f6b45" />
          <EnvChip label="Dev" fillColor="#e6edf5" textColor="#2c5a8c" />
          <EnvChip label="Staging" fillColor="#f5eee0" textColor="#8a5f14" />
          <EnvChip label="Prod" fillColor="#b4322f" textColor="#ffffff" emphasize />
        </div>
      </div>
    ),
    size
  );
}
