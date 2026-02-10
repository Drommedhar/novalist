import { LanguageKey, AutoReplacementPair, NovalistSettings } from '../types';
import { t } from '../i18n';

export function getLanguageLabels(): Record<LanguageKey, string> {
  return {
    'de-guillemet': t('lang.de-guillemet'),
    'de-low': t('lang.de-low'),
    en: t('lang.en'),
    fr: t('lang.fr'),
    es: t('lang.es'),
    it: t('lang.it'),
    pt: t('lang.pt'),
    ru: t('lang.ru'),
    pl: t('lang.pl'),
    cs: t('lang.cs'),
    sk: t('lang.sk'),
    custom: t('lang.custom'),
  };
}

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
  enableSidebarView: true,
  enableCustomExplorer: true,
  characterFolder: 'Characters',
  locationFolder: 'Locations',
  imageFolder: 'Images',
  chapterFolder: 'Chapters',
  relationshipPairs: {},
  startupWizardShown: false,
  roleColors: {},
  genderColors: {},
  explorerGroupCollapsed: {},
  wordCountGoals: {
    dailyGoal: 1000,
    projectGoal: 50000,
    dailyHistory: []
  },
  enableBookParagraphSpacing: false,
  enableToolbar: true,
  enableAnnotations: true,
  commentThreads: [],
  plotBoard: { columns: [], cells: {} }
};
