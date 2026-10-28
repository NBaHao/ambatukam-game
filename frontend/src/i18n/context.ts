import { createContext, use } from "react";
import type { FnKey, Lang, Strings, TextKey } from "./strings";

export interface Translate {
  (key: TextKey): string;
  <K extends FnKey>(key: K, ...args: Parameters<Strings[K]>): string;
}

export interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Translate;
  strings: Strings;
}

export const I18nContext = createContext<I18n | null>(null);

export function useI18n(): I18n {
  const ctx = use(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
