import { ENV_COLORS } from "@/lib/client/env";
import { ENV_LABELS, type EnvType } from "@/lib/types";

export function EnvPill({ env, small }: { env: EnvType; small?: boolean }) {
  const c = ENV_COLORS[env];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: small ? "1px 7px" : "2px 9px",
        borderRadius: 999,
        fontSize: small ? 10.5 : 11.5,
        fontFamily: "var(--font-mono)",
        fontWeight: 600,
        letterSpacing: "0.02em",
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.border}`,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: c.strong,
          flex: "none",
        }}
      />
      {ENV_LABELS[env]}
    </span>
  );
}
