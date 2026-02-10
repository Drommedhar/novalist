import { getLanguage } from 'obsidian';

import en from './en';
import de from './de';

/**
 * Union of every translation key defined in the English (reference) locale.
 */
export type TranslationKey = keyof typeof en;

/** A locale translation record – every key from `en` must exist. */
type Translations = Record<TranslationKey, string>;

const locales: Record<string, Translations> = {
  en: en as Translations,
  de: de as Translations,
};

/** Resolved language code (set once via {@link initLocale}). */
let currentLang = 'en';

/**
 * Initialise the i18n locale.
 *
 * Call this once during plugin `onload()`.
 * It reads Obsidian's UI language via the official `getLanguage()` API
 * and picks the best available translation, falling back to English.
 */
export function initLocale(): void {
  try {
    const obsidianLang = getLanguage();
    const lang = obsidianLang.split('-')[0].toLowerCase();
    currentLang = lang in locales ? lang : 'en';
  } catch {
    currentLang = 'en';
  }
}

/**
 * Translate a key with optional interpolation placeholders.
 *
 * Placeholders use the `{name}` syntax and are replaced by the matching
 * property in the `params` object.
 *
 * @example
 * ```ts
 * t('notice.characterCreated', { name: 'Alice' });
 * // → "Character Alice created."
 * ```
 */
export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const table = locales[currentLang] ?? locales['en'];
  let value: string = table[key] ?? locales['en'][key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return value;
}
