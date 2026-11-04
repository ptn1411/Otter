/**
 * Shared [data-i18n] applier for extension pages (Options, side panel HTML, ...).
 * Uses t() so it follows the same language resolution as content scripts.
 * Text is set via textContent (never innerHTML from a message) to avoid
 * injecting message content as HTML.
 */
import { t, getLanguage, type TranslationKey } from "./index";

export function applyDataI18n(root: Document | Element = document): void {
  const elements = (root as any).querySelectorAll?.("[data-i18n], [data-i18n-placeholder]") || [];
  for (const el of Array.from(elements) as HTMLElement[]) {
    const key = el.getAttribute("data-i18n");
    if (key) {
      el.textContent = t(key as TranslationKey);
    }
    const placeholderKey = el.getAttribute("data-i18n-placeholder");
    if (placeholderKey && (el as HTMLInputElement).placeholder !== undefined) {
      (el as HTMLInputElement).placeholder = t(placeholderKey as TranslationKey);
    }
  }
  if ((root as Document).documentElement) {
    (root as Document).documentElement.lang = getLanguage();
  }
}
