import { LanguageKey, AutoReplacementPair, NovalistSettings, CharacterTemplate, LocationTemplate, ItemTemplate, LoreTemplate, NovalistProject, ProjectData, CustomPropertyDefinition } from '../types';
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

// ── Default entity templates ──────────────────────────────────────────

export const DEFAULT_CHARACTER_TEMPLATE: CharacterTemplate = {
  id: 'default',
  name: 'Default',
  builtIn: true,
  fields: [
    { key: 'Gender', defaultValue: '' },
    { key: 'Age', defaultValue: '' },
    { key: 'Role', defaultValue: '' },
    { key: 'EyeColor', defaultValue: '' },
    { key: 'HairColor', defaultValue: '' },
    { key: 'HairLength', defaultValue: '' },
    { key: 'Height', defaultValue: '' },
    { key: 'Build', defaultValue: '' },
    { key: 'SkinTone', defaultValue: '' },
    { key: 'DistinguishingFeatures', defaultValue: '' },
  ],
  customPropertyDefs: [],
  sections: [],
  includeRelationships: true,
  includeImages: true,
  includeChapterOverrides: true,
};

export const DEFAULT_LOCATION_TEMPLATE: LocationTemplate = {
  id: 'default',
  name: 'Default',
  builtIn: true,
  fields: [
    { key: 'Type', defaultValue: '' },
    { key: 'Description', defaultValue: '' },
  ],
  customPropertyDefs: [],
  sections: [],
  includeImages: true,
};

export const DEFAULT_ITEM_TEMPLATE: ItemTemplate = {
  id: 'default',
  name: 'Default',
  builtIn: true,
  fields: [
    { key: 'Type', defaultValue: '' },
    { key: 'Description', defaultValue: '' },
    { key: 'Origin', defaultValue: '' },
  ],
  customPropertyDefs: [],
  sections: [],
  includeImages: true,
};

export const DEFAULT_LORE_TEMPLATE: LoreTemplate = {
  id: 'default',
  name: 'Default',
  builtIn: true,
  fields: [
    { key: 'Category', defaultValue: '' },
    { key: 'Description', defaultValue: '' },
  ],
  customPropertyDefs: [],
  sections: [],
  includeImages: true,
};

function clonePropertyDef(d: CustomPropertyDefinition): CustomPropertyDefinition {
  return { ...d, enumOptions: d.enumOptions ? [...d.enumOptions] : undefined };
}

export function cloneCharacterTemplate(tpl: CharacterTemplate): CharacterTemplate {
  return {
    ...tpl,
    fields: tpl.fields.map(f => ({ ...f })),
    customPropertyDefs: (tpl.customPropertyDefs ?? []).map(clonePropertyDef),
    sections: tpl.sections.map(s => ({ ...s })),
  };
}

export function cloneLocationTemplate(tpl: LocationTemplate): LocationTemplate {
  return {
    ...tpl,
    fields: tpl.fields.map(f => ({ ...f })),
    customPropertyDefs: (tpl.customPropertyDefs ?? []).map(clonePropertyDef),
    sections: tpl.sections.map(s => ({ ...s })),
  };
}

export function cloneItemTemplate(tpl: ItemTemplate): ItemTemplate {
  return {
    ...tpl,
    fields: tpl.fields.map(f => ({ ...f })),
    customPropertyDefs: (tpl.customPropertyDefs ?? []).map(clonePropertyDef),
    sections: tpl.sections.map(s => ({ ...s })),
  };
}

export function cloneLoreTemplate(tpl: LoreTemplate): LoreTemplate {
  return {
    ...tpl,
    fields: tpl.fields.map(f => ({ ...f })),
    customPropertyDefs: (tpl.customPropertyDefs ?? []).map(clonePropertyDef),
    sections: tpl.sections.map(s => ({ ...s })),
  };
}

/**
 * Migrate a template that still uses the legacy `customProperties` map
 * to the new `customPropertyDefs` array.
 */
export function migrateTemplateDefs<T extends CharacterTemplate | LocationTemplate>(tpl: T): T {
  if (tpl.customPropertyDefs && tpl.customPropertyDefs.length > 0) {
    // Migrate legacy enum options from {label, value} objects to plain strings
    for (const def of tpl.customPropertyDefs) {
      if (def.enumOptions) {
        def.enumOptions = def.enumOptions.map(opt =>
          typeof opt === 'string' ? opt : (opt as Record<string, string>).label ?? (opt as Record<string, string>).value ?? ''
        );
      }
    }
    return tpl;
  }
  // Access legacy field via bracket notation to avoid deprecated-access lint error.
  // This migration function is the one place that intentionally reads the old field.
  const legacy = (tpl as Record<string, unknown>)['customProperties'] as Record<string, string> | undefined;
  if (!legacy || Object.keys(legacy).length === 0) {
    tpl.customPropertyDefs = tpl.customPropertyDefs ?? [];
    return tpl;
  }
  tpl.customPropertyDefs = Object.entries(legacy).map(([key, value]) => ({
    key,
    type: 'string' as const,
    defaultValue: value,
  }));
  delete (tpl as Record<string, unknown>)['customProperties'];
  return tpl;
}

export const DEFAULT_PROJECT_ID = 'project-default';

export function createDefaultProject(): NovalistProject {
  return {
    id: DEFAULT_PROJECT_ID,
    name: 'NovelProject',
    path: 'NovelProject',
  };
}

export function createDefaultProjectData(): ProjectData {
  return {
    commentThreads: [],
    plotBoard: { columns: [], cells: {}, labels: [], cardColors: {}, cardLabels: {}, viewMode: 'board', collapsedActs: [] },
    wordCountGoals: {
      dailyGoal: 1000,
      projectGoal: 50000,
      dailyHistory: []
    },
    explorerGroupCollapsed: {},
    relationshipPairs: {},
    recentEdits: [],
  };
}

export const DEFAULT_SETTINGS: NovalistSettings = {
  novalistRoot: '',
  projectPath: 'NovelProject',
  projects: [createDefaultProject()],
  activeProjectId: DEFAULT_PROJECT_ID,
  worldBiblePath: 'WorldBible',
  autoReplacements: cloneAutoReplacements(LANGUAGE_DEFAULTS['de-low']),
  language: 'de-low',
  customLanguageLabel: 'Custom',
  customLanguageDefaults: [],
  enableSidebarView: true,
  enableCustomExplorer: true,
  characterFolder: 'Characters',
  locationFolder: 'Locations',
  itemFolder: 'Items',
  loreFolder: 'Lore',
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
  enableExplorerAutoReveal: true,
  enableAnnotations: true,
  commentThreads: [],
  plotBoard: { columns: [], cells: {}, labels: [], cardColors: {}, cardLabels: {}, viewMode: 'board', collapsedActs: [] },
  characterTemplates: [cloneCharacterTemplate(DEFAULT_CHARACTER_TEMPLATE)],
  locationTemplates: [cloneLocationTemplate(DEFAULT_LOCATION_TEMPLATE)],
  itemTemplates: [cloneItemTemplate(DEFAULT_ITEM_TEMPLATE)],
  loreTemplates: [cloneLoreTemplate(DEFAULT_LORE_TEMPLATE)],
  activeCharacterTemplateId: 'default',
  activeLocationTemplateId: 'default',
  activeItemTemplateId: 'default',
  activeLoreTemplateId: 'default',
  projectData: {},
  ollama: {
    enabled: false,
    provider: 'ollama',
    analysisMode: 'paragraph',
    baseUrl: 'http://127.0.0.1:11434',
    model: '',
    autoManageModel: true,
    checkReferences: true,
    checkInconsistencies: true,
    checkSuggestions: true,
    copilotPath: 'copilot',
    copilotModel: '',
  },
  recentEdits: [],
};
