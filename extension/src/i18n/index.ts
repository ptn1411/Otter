/**
 * Otter i18n — single source of truth is extension/_locales/<lang>/messages.json
 * (Chrome format). Run `bun scripts/generate-i18n.ts` after editing _locales;
 * do not edit messages.ts by hand.
 *
 * Runtime language resolution (chrome.i18n standard, with Otter's user choice):
 *  - If the user explicitly chose a language in Options, t() uses that language's
 *    generated dictionary (chrome.i18n.getMessage cannot be switched at runtime,
 *    so a pure getMessage implementation would lose the user's choice).
 *  - Otherwise t() uses chrome.i18n.getMessage() when available (browser UI
 *    locale), falling back to navigator.language, then to en.
 *  - A missing key falls back to en, then warns once and returns the key.
 */
import { messages, type TranslationKey } from "./messages";

export type Language = "vi" | "en";
export type { TranslationKey };

let currentLanguage: Language = "vi";
let explicitChoice = false;
const warnedKeys = new Set<string>();
const listeners: Array<(lang: Language) => void> = [];

export function getLanguage(): Language {
  return currentLanguage;
}

export function isExplicitLanguageChoice(): boolean {
  return explicitChoice;
}

export function setLanguage(lang: Language) {
  if (currentLanguage === lang && explicitChoice) return;
  currentLanguage = lang;
  explicitChoice = true;
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.set({ language: lang });
  }
  notifyListeners(lang);
}

export function onLanguageChange(callback: (lang: Language) => void) {
  listeners.push(callback);
}

function notifyListeners(lang: Language) {
  for (const cb of listeners) {
    try {
      cb(lang);
    } catch {}
  }
}

function languageFromLocale(locale: string | undefined): Language {
  return locale?.toLowerCase().startsWith("vi") ? "vi" : "en";
}

function chromeUiLanguage(): string | undefined {
  try {
    if (typeof chrome !== "undefined" && (chrome as any).i18n?.getUILanguage) {
      return (chrome as any).i18n.getUILanguage();
    }
  } catch {}
  return undefined;
}

function chromeMessage(key: TranslationKey): string | null {
  try {
    if (typeof chrome !== "undefined" && (chrome as any).i18n?.getMessage) {
      const msg = (chrome as any).i18n.getMessage(key);
      if (typeof msg === "string" && msg) return msg;
    }
  } catch {}
  return null;
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  let text: string | undefined;
  if (!explicitChoice) {
    text = chromeMessage(key) ?? undefined;
  }
  if (text === undefined) {
    text = messages[currentLanguage]?.[key] ?? messages.en[key];
  }
  if (text === undefined) {
    if (!warnedKeys.has(key)) {
      warnedKeys.add(key);
      console.warn(`[Otter i18n] Missing translation key: ${key}`);
    }
    text = key;
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return text;
}

/** Locale string for Intl.* formatting (vi-VN / en-US). */
export function getIntlLocale(lang: Language = currentLanguage): string {
  return lang === "vi" ? "vi-VN" : "en-US";
}

export function formatDate(date: Date | number, options?: Intl.DateTimeFormatOptions, lang: Language = currentLanguage): string {
  return new Intl.DateTimeFormat(getIntlLocale(lang), options).format(date);
}

export function formatNumber(n: number, options?: Intl.NumberFormatOptions, lang: Language = currentLanguage): string {
  return new Intl.NumberFormat(getIntlLocale(lang), options).format(n);
}

/** Currency is always VND (user decision 2026-11-01); only number formatting follows locale. */
export function formatCurrency(n: number, currency = "VND", lang: Language = currentLanguage): string {
  return new Intl.NumberFormat(getIntlLocale(lang), { style: "currency", currency }).format(n);
}

/** Plural selection via Intl.PluralRules. vi only has "other"; en has "one"/"other". */
export function plural(count: number, forms: { one?: string; other: string }, lang: Language = currentLanguage): string {
  const rule = new Intl.PluralRules(getIntlLocale(lang)).select(count);
  if (rule === "one" && forms.one !== undefined) return forms.one;
  return forms.other;
}

export async function initI18n(): Promise<Language> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get("language");
      if (stored?.language === "vi" || stored?.language === "en") {
        currentLanguage = stored.language;
        explicitChoice = true;
      } else {
        explicitChoice = false;
        currentLanguage = languageFromLocale(chromeUiLanguage() ?? (typeof navigator !== "undefined" ? navigator.language : undefined));
      }
    }
  } catch {}

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.language) {
          const newLang = changes.language.newValue;
          if (newLang === "vi" || newLang === "en") {
            currentLanguage = newLang;
            explicitChoice = true;
            notifyListeners(newLang);
          }
        }
      });
    }
  } catch {}

  return currentLanguage;
}
