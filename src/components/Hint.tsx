"use client";

import { useEffect, useRef, useState } from "react";

// Modifier glyphs are tiny or missing in the mono font: drawn instead.
const KEY_ICONS: Record<string, React.ReactNode> = {
  "⇧": <path d="M8 2.5 3 8h3v5.5h4V8h3z" />,
  "⌫": <path d="M6 3.5h7.5v9H6L2 8zM8 6l3.5 4M11.5 6 8 10" />,
};

// A key cap, e.g. <Kbd>F</Kbd>.
export function Kbd({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  const icon = typeof children === "string" ? KEY_ICONS[children] : undefined;
  return (
    <kbd
      style={{
        display: "inline-grid",
        placeItems: "center",
        minWidth: 18,
        height: 18,
        padding: "0 4px",
        borderRadius: 4,
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        lineHeight: 1,
        background: dark ? "rgba(255,255,255,0.14)" : "#f4f2ed",
        border: `1px solid ${dark ? "rgba(255,255,255,0.18)" : "#e2ded4"}`,
        color: dark ? "#fff" : "#8b877e",
      }}
    >
      {icon ? (
        <svg aria-label={String(children)} width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
          {icon}
        </svg>
      ) : (
        children
      )}
    </kbd>
  );
}

/**
 * Quick tooltip with the action's shortcut, shown after a short hover: the keys stay
 * out of the toolbar until someone points at a button.
 */
export function Hint({ label, keys, children }: { label: string; keys?: string[]; children: React.ReactNode }) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [at, setAt] = useState<{ top: number; left?: number; right?: number } | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function show() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      // Anchored on the side with room, so it never runs off the window.
      setAt(r.left > window.innerWidth / 2 ? { top: r.bottom + 6, right: window.innerWidth - r.right } : { top: r.bottom + 6, left: r.left });
    }, 350);
  }

  function hide() {
    if (timer.current) clearTimeout(timer.current);
    setAt(null);
  }

  return (
    <span ref={wrapRef} onMouseEnter={show} onMouseLeave={hide} onMouseDown={hide} onFocus={show} onBlur={hide} style={{ display: "inline-flex", flex: "none" }}>
      {children}
      {at && (
        <span
          role="tooltip"
          style={{
            position: "fixed",
            top: at.top,
            left: at.left,
            right: at.right,
            zIndex: 90,
            display: "flex",
            alignItems: "center",
            gap: 8,
            maxWidth: 440,
            whiteSpace: "nowrap",
            padding: "5px 8px",
            borderRadius: 7,
            background: "#26241f",
            color: "#f4f2ed",
            fontSize: 12,
            lineHeight: 1.35,
            boxShadow: "0 8px 24px rgba(35, 31, 24, 0.18)",
            pointerEvents: "none",
            animation: "om-fade 0.1s ease",
          }}
        >
          <span>{label}</span>
          {keys && keys.length > 0 && (
            <span style={{ display: "inline-flex", gap: 3, flex: "none" }}>
              {keys.map((k) => (
                <Kbd key={k} dark>
                  {k}
                </Kbd>
              ))}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
