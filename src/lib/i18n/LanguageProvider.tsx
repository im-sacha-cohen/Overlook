"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { dictionaries, type Lang } from "./translations";

const STORAGE_KEY = "overlook:lang";

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const LangContext = createContext<LangContextValue | null>(null);

function loadLang(): Lang {
  if (typeof window === "undefined") return "fr";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "fr" || stored === "en") return stored;
  } catch {
    // ignore
  }
  return "fr";
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Always start at "fr" so the client's first render matches the server-rendered
  // HTML (which has no access to localStorage); the real preference is applied
  // right after mount, in a plain effect, to avoid a hydration mismatch.
  const [lang, setLangState] = useState<Lang>("fr");

  useEffect(() => {
    const stored = loadLang();
    setLangState((current) => (stored !== current ? stored : current));
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // best-effort only
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const template = dictionaries[lang][key] ?? dictionaries.fr[key] ?? key;
      if (!vars) return template;
      return Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{{${k}}}`, String(v)), template);
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used within a LanguageProvider");
  return ctx;
}
