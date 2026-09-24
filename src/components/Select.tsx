"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface SelectOption<V extends string = string> {
  value: V;
  label: ReactNode;
  /** Shown on the right of the option, e.g. an engine or a type. */
  hint?: ReactNode;
  /** A heading the option is grouped under; options of one group follow each other. */
  group?: string;
  disabled?: boolean;
}

interface Props<V extends string> {
  value: V;
  options: SelectOption<V>[];
  onChange: (value: V) => void;
  disabled?: boolean;
  /** Shown when no option matches the value (or its label is empty). */
  placeholder?: string;
  /** "sm" for toolbars and table rows, "md" for forms. */
  size?: "sm" | "md";
  /** Overrides for the button, e.g. its width. */
  style?: CSSProperties;
  ariaLabel?: string;
  /** Extra content after the label inside the button (e.g. an env pill). */
  suffix?: ReactNode;
}

const LIST_MAX_HEIGHT = 280;

// The app's select: a button opening a list, the same in every browser. The list is
// drawn in a portal so a dialog's overflow can't cut it, and flips up near the bottom.
export function Select<V extends string>({ value, options, onChange, disabled, placeholder, size = "md", style, ariaLabel, suffix }: Props<V>) {
  const listId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const typed = useRef({ text: "", at: 0 });

  const current = options.find((o) => o.value === value);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);

  function place() {
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const up = below < Math.min(LIST_MAX_HEIGHT, options.length * 32 + 10) && r.top > below;
    setAnchor(up ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4 } : { left: r.left, width: r.width, top: r.bottom + 4 });
  }

  function openList() {
    if (disabled) return;
    const idx = options.findIndex((o) => o.value === value && !o.disabled);
    setActive(idx >= 0 ? idx : (enabled[0] ?? 0));
    place();
    setOpen(true);
  }

  function close(refocus = true) {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }

  function pick(i: number) {
    const o = options[i];
    if (!o || o.disabled) return;
    close();
    if (o.value !== value) onChange(o.value);
  }

  useLayoutEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!buttonRef.current?.contains(target) && !listRef.current?.contains(target)) close(false);
    };
    // The list stays under its button while the page or a panel scrolls.
    const onMove = (e: Event) => {
      if (e.target instanceof Node && listRef.current?.contains(e.target)) return;
      place();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  });

  function step(from: number, delta: number): number {
    const pos = enabled.indexOf(from);
    if (pos < 0) return enabled[0] ?? from;
    return enabled[Math.min(enabled.length - 1, Math.max(0, pos + delta))];
  }

  // Letters jump to the next option starting with what was typed, as a native select does.
  function typeAhead(key: string) {
    const now = Date.now();
    typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + key.toLowerCase(), at: now };
    const text = typed.current.text;
    const labelOf = (o: SelectOption<V>) => (typeof o.label === "string" ? o.label : o.value).toLowerCase();
    const start = open ? active : options.findIndex((o) => o.value === value);
    const order = [...enabled.filter((i) => i > start || (text.length > 1 && i === start)), ...enabled.filter((i) => i < start || (text.length === 1 && i === start))];
    const found = order.find((i) => labelOf(options[i]).startsWith(text));
    if (found === undefined) return;
    if (open) setActive(found);
    else if (options[found].value !== value) onChange(options[found].value);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openList();
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        typeAhead(e.key);
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => step(a, e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? (enabled[0] ?? 0) : (enabled.at(-1) ?? 0));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      // Closing the list must not close the dialog it sits in.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      close(false);
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      typeAhead(e.key);
    }
  }

  const sm = size === "sm";
  const hasLabel = current && current.label !== "" && current.label !== null && current.label !== undefined;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
          height: sm ? 26 : 34,
          padding: sm ? "0 7px 0 8px" : "0 10px 0 11px",
          background: disabled ? "#faf9f6" : "#fff",
          border: `1px solid ${open ? "var(--accent-border)" : "#e8e5df"}`,
          boxShadow: open ? "0 0 0 3px var(--accent-bg)" : "none",
          borderRadius: sm ? 6 : 8,
          fontSize: sm ? 12.5 : 13,
          color: disabled ? "#a8a39a" : "#26241f",
          cursor: disabled ? "default" : "pointer",
          textAlign: "left",
          outline: "none",
          transition: "border-color 0.12s ease, box-shadow 0.12s ease",
          ...style,
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: hasLabel ? undefined : "#b4afa5" }}>
          {hasLabel ? current.label : (placeholder ?? "—")}
        </span>
        {suffix}
        <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" style={{ flex: "none", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.12s ease" }}>
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="#a8a39a" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open &&
        anchor &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className="om-sb"
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: "fixed",
              left: anchor.left,
              top: anchor.top,
              bottom: anchor.bottom,
              zIndex: 90,
              minWidth: Math.max(anchor.width, 140),
              maxWidth: Math.max(anchor.width, 420),
              maxHeight: LIST_MAX_HEIGHT,
              overflowY: "auto",
              margin: 0,
              padding: 4,
              listStyle: "none",
              background: "#fff",
              border: "1px solid #e8e5df",
              borderRadius: 9,
              boxShadow: "0 12px 32px rgba(35, 31, 24, 0.14)",
              animation: "om-pop 0.12s ease",
            }}
          >
            {options.map((o, i) => {
              const selected = o.value === value;
              const heading = o.group && o.group !== options[i - 1]?.group ? o.group : null;
              return (
                <li key={`${o.group ?? ""}\u0000${o.value}`} role="presentation">
                  {heading && (
                    <div style={{ padding: i === 0 ? "4px 9px 3px" : "9px 9px 3px", fontSize: 10.5, fontWeight: 600, color: "#a8a39a", textTransform: "uppercase", letterSpacing: "0.04em" }}>{heading}</div>
                  )}
                  <div
                    id={`${listId}-${i}`}
                    data-idx={i}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={o.disabled || undefined}
                    onMouseEnter={() => !o.disabled && setActive(i)}
                    onClick={() => pick(i)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 9px",
                      borderRadius: 6,
                      fontSize: sm ? 12.5 : 13,
                      cursor: o.disabled ? "default" : "pointer",
                      background: i === active && !o.disabled ? "#f4f2ed" : "transparent",
                      color: o.disabled ? "#b4afa5" : "#26241f",
                      fontWeight: selected ? 600 : 400,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ width: 10, flex: "none", color: "var(--accent)", fontSize: 11 }}>{selected ? "✓" : ""}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", color: o.label === "" ? "#b4afa5" : undefined }}>{o.label === "" ? (placeholder ?? "—") : o.label}</span>
                    {o.hint && <span style={{ flex: "none", paddingLeft: 12, color: "#a8a39a", fontSize: 11 }}>{o.hint}</span>}
                  </div>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </>
  );
}
