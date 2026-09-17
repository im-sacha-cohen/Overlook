"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLang } from "@/lib/i18n/LanguageProvider";

export interface ComboOption {
  value: string;
  label?: string;
  hint?: string;
}

interface Props {
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  // Free text: whatever is typed becomes the value, options are only suggestions.
  allowCustom?: boolean;
  /** false when the options are already narrowed by the caller (e.g. a server search). */
  filterOptions?: boolean;
  placeholder?: string;
  width?: number;
  autoFocus?: boolean;
  style?: React.CSSProperties;
  ariaLabel?: string;
}

// A select you can type into: the input filters the list, arrows move, Enter picks.
export function Combobox({ value, options, onChange, allowCustom, filterOptions = true, placeholder, width = 120, autoFocus, style, ariaLabel }: Props) {
  const { t } = useLang();
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const current = options.find((o) => o.value === value);
  const shown = allowCustom ? value : (current?.label ?? value);
  const q = query.trim().toLowerCase();
  const matches = q && filterOptions ? options.filter((o) => (o.label ?? o.value).toLowerCase().includes(q)) : options;

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
      setOpen(true);
    }
  }, [autoFocus]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function openList() {
    setQuery(allowCustom ? value : "");
    const idx = options.findIndex((o) => o.value === value);
    setActive(Math.max(0, allowCustom ? 0 : idx));
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setQuery("");
  }

  function pick(o: ComboOption) {
    onChange(o.value);
    close();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      openList();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && matches[active]) pick(matches[active]);
      else close();
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    } else if (e.key === "Tab") {
      close();
    }
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", flex: "none", width, ...style }}>
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        value={open ? query : shown}
        placeholder={open && !allowCustom ? (current?.label ?? value) || placeholder : placeholder}
        onFocus={() => !open && openList()}
        onMouseDown={() => {
          if (document.activeElement === inputRef.current && !open) openList();
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          if (!open) setOpen(true);
          if (allowCustom) onChange(e.target.value);
        }}
        onKeyDown={onKeyDown}
        style={{
          width: "100%",
          height: 22,
          padding: "0 20px 0 7px",
          background: "#fff",
          border: `1px solid ${open ? "var(--accent-border)" : "transparent"}`,
          borderRadius: 5,
          fontSize: 12.5,
          color: "#26241f",
          outline: "none",
          cursor: open ? "text" : "pointer",
          textOverflow: "ellipsis",
          boxShadow: open ? "0 0 0 3px var(--accent-bg)" : "none",
        }}
      />
      <span
        aria-hidden
        onMouseDown={(e) => {
          e.preventDefault();
          if (open) close();
          else {
            inputRef.current?.focus();
            openList();
          }
        }}
        style={{ position: "absolute", right: 5, top: "50%", transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)`, transition: "transform 0.12s ease", fontSize: 9, color: "#a8a39a", cursor: "pointer", lineHeight: 1 }}
      >
        ▼
      </span>
      {open && (allowCustom ? matches.length > 0 : true) && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="om-sb"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 50,
            minWidth: Math.max(width, 180),
            maxHeight: 240,
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
          {matches.length === 0 && <li style={{ padding: "7px 9px", fontSize: 12.5, color: "#a8a39a" }}>{t("combobox.noMatch")}</li>}
          {matches.map((o, i) => {
            const selected = o.value === value;
            return (
              <li
                key={o.value}
                data-idx={i}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 9px",
                  borderRadius: 6,
                  fontSize: 12.5,
                  cursor: "pointer",
                  background: i === active ? "#f4f2ed" : "transparent",
                  color: "#26241f",
                  fontWeight: selected ? 600 : 400,
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ width: 10, color: "var(--accent)", fontSize: 11 }}>{selected ? "✓" : ""}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{o.label ?? o.value}</span>
                {o.hint && <span style={{ marginLeft: "auto", paddingLeft: 12, color: "#a8a39a", fontSize: 11, fontFamily: "var(--font-mono)" }}>{o.hint}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
