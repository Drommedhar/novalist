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

/** Map of language codes to their full English names for LLM prompt instructions. */
const languageNames: Record<string, string> = {
  de: 'German',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  nl: 'Dutch',
  pl: 'Polish',
  pt: 'Portuguese',
  ru: 'Russian',
  zh: 'Chinese',
};

/**
 * Return the full English name of the current UI language
 * (e.g. "German", "English"). Used to instruct the LLM
 * to respond in the same language as the Obsidian UI.
 */
export function getLanguageName(): string {
  return languageNames[currentLang] ?? 'English';
}

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

/**
 * Return the set of family relationship terms (lower-case) for the current
 * locale. Always includes English terms as a base; the current locale's own
 * terms are added on top, allowing per-language extension.
 */
export function getFamilyTerms(): ReadonlySet<string> {
  const split = (s: string): string[] => s.split(',').map(w => w.trim()).filter(w => w.length > 0);
  const terms = split(locales['en']['familyTerms']);
  if (currentLang !== 'en') {
    const local = locales[currentLang]?.['familyTerms'];
    if (local) split(local).forEach(w => terms.push(w));
  }
  return new Set(terms);
}
