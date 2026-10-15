import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as shell from './messages/shell';
import * as common from './messages/common';
import * as dashboard from './messages/dashboard';
import * as cutover from './messages/cutover';

// R1.1 / R1.2 (MP-06 §1): Arabic-first, fully bilingual interface. Every user-visible string of a translated screen
// comes from the dictionaries in ./messages (one file per area); the language also sets the document language and
// direction. Each file's Arabic dictionary is typed against its English keys, so a missing or extra key fails the
// build; tests/ui/i18n.ui.mjs also checks key parity and that no key is defined in two files.
export type Lang = 'ar' | 'en';
const STORAGE_KEY = 'mishel.lang';

const en = { ...shell.en, ...common.en, ...dashboard.en, ...cutover.en };
export type MessageKey = keyof typeof en;
const ar: Record<MessageKey, string> = { ...shell.ar, ...common.ar, ...dashboard.ar, ...cutover.ar };
export type MessageVars = Record<string, string | number>;

export const dictionaries: Record<Lang, Record<MessageKey, string>> = { en, ar };

function initialLang(): Lang {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'ar' || saved === 'en') return saved;
  } catch { /* storage unavailable: fall back to the default */ }
  return 'ar';
}

// {name} in a message is replaced by vars.name; a placeholder without a value is left visible rather than dropped.
export function format(lang: Lang, key: MessageKey, vars?: MessageVars): string {
  const text = dictionaries[lang][key];
  return vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : text;
}

type I18n = { lang: Lang; dir: 'rtl' | 'ltr'; t: (key: MessageKey, vars?: MessageVars) => string; setLang: (lang: Lang) => void };
const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const dir: 'rtl' | 'ltr' = lang === 'ar' ? 'rtl' : 'ltr';
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);
  const setLang = useCallback((next: Lang) => {
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* not persisted; still switches */ }
    setLangState(next);
  }, []);
  const t = useCallback((key: MessageKey, vars?: MessageVars) => format(lang, key, vars), [lang]);
  const value = useMemo(() => ({ lang, dir, t, setLang }), [lang, dir, t, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}

export function LanguageSwitch({ className }: { className?: string }) {
  const { lang, t, setLang } = useI18n();
  return (
    <button type="button" className={className ?? 'language-switch'} aria-label={t('shell.languageLabel')}
      lang={lang === 'ar' ? 'en' : 'ar'} onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
      {t('shell.switchLanguage')}
    </button>
  );
}
