import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { storage } from "../lib/storage";
import { I18nContext, type Translate } from "./context";
import { LANGS, STRINGS, type Lang } from "./strings";

function initialLang(): Lang {
  // ?lang=vi|en chỉ dùng khi dev để nhảy thẳng vào một ngôn ngữ
  const forced = import.meta.env.DEV ? new URLSearchParams(location.search).get("lang") : null;
  const saved = forced ?? storage.getLang();
  if (saved && (LANGS as string[]).includes(saved)) return saved as Lang;
  return navigator.language.startsWith("vi") ? "vi" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    storage.setLang(next);
    setLangState(next);
  }, []);

  const value = useMemo(() => {
    const strings = STRINGS[lang];
    const t = ((key: keyof typeof strings, ...args: unknown[]) => {
      const v = strings[key];
      return typeof v === "function" ? (v as (...a: unknown[]) => string)(...args) : v;
    }) as Translate;
    return { lang, setLang, t, strings };
  }, [lang, setLang]);

  return <I18nContext value={value}>{children}</I18nContext>;
}
