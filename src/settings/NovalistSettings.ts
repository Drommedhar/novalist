import { LanguageKey, AutoReplacementPair, NovalistSettings } from '../types';

export const LANGUAGE_LABELS: Record<LanguageKey, string> = {
  'de-guillemet': 'German (guillemets)',
  'de-low': 'German (low-high)',
  en: 'English (curly quotes)',
  fr: 'French (guillemets with spaces)',
  es: 'Spanish (guillemets)',
  it: 'Italian (guillemets)',
  pt: 'Portuguese (guillemets)',
  ru: 'Russian (guillemets)',
  pl: 'Polish (low-high)',
  cs: 'Czech (low-high)',
  sk: 'Slovak (low-high)',
  custom: 'Custom'
};

export const COMMON_REPLACEMENTS: AutoReplacementPair[] = [
  { start: '--', end: '--', startReplace: '—', endReplace: '—' },
  { start: '...', end: '...', startReplace: '…', endReplace: '…' }
];

export const LANGUAGE_DEFAULTS: Record<Exclude<LanguageKey, 'custom'>, AutoReplacementPair[]> = {
  'de-guillemet': [
    { start: "'", end: "'", startReplace: '»', endReplace: '«' },
    ...COMMON_REPLACEMENTS
  ],
  'de-low': [
    { start: "'", end: "'", startReplace: '„', endReplace: '“' },
    ...COMMON_REPLACEMENTS
  ],
  en: [
    { start: "'", end: "'", startReplace: '“', endReplace: '”' },
    ...COMMON_REPLACEMENTS
  ],
  fr: [
    { start: "'", end: "'", startReplace: '«\u00a0', endReplace: '\u00a0»' },
    ...COMMON_REPLACEMENTS
  ],
  es: [
    { start: "'", end: "'", startReplace: '«', endReplace: '»' },
    ...COMMON_REPLACEMENTS
  ],
  it: [
    { start: "'", end: "'", startReplace: '«', endReplace: '»' },
    ...COMMON_REPLACEMENTS
  ],
  pt: [
    { start: "'", end: "'", startReplace: '«', endReplace: '»' },
    ...COMMON_REPLACEMENTS
  ],
  ru: [
    { start: "'", end: "'", startReplace: '«', endReplace: '»' },
    ...COMMON_REPLACEMENTS
  ],
  pl: [
    { start: "'", end: "'", startReplace: '„', endReplace: '”' },
    ...COMMON_REPLACEMENTS
  ],
  cs: [
    { start: "'", end: "'", startReplace: '„', endReplace: '“' },
    ...COMMON_REPLACEMENTS
  ],
  sk: [
    { start: "'", end: "'", startReplace: '„', endReplace: '“' },
    ...COMMON_REPLACEMENTS
  ]
};

export const cloneAutoReplacements = (pairs: AutoReplacementPair[]): AutoReplacementPair[] =>
  pairs.map((pair) => ({ ...pair }));

export const DEFAULT_SETTINGS: NovalistSettings = {
  projectPath: 'NovelProject',
  autoReplacements: cloneAutoReplacements(LANGUAGE_DEFAULTS['de-low']),
  language: 'de-low',
  customLanguageLabel: 'Custom',
  customLanguageDefaults: [],
  enableHoverPreview: true,
  enableSidebarView: true,
  enableCustomExplorer: false,
  characterFolder: 'Characters',
  locationFolder: 'Locations',
  imageFolder: 'Images',
  chapterFolder: 'Chapters',
  relationshipPairs: {},
  startupWizardShown: false
};
