import { t } from '../i18n';

// ─── Multi-project & World Bible ────────────────────────────────────
export interface NovalistProject {
  id: string;
  name: string;
  path: string;
}

/** Per-project data stored alongside global settings. */
export interface ProjectData {
  commentThreads: CommentThread[];
  plotBoard: PlotBoardData;
  wordCountGoals: WordCountGoals;
  explorerGroupCollapsed: Record<string, boolean>;
  relationshipPairs: Record<string, string[]>;
}

export interface NovalistSettings {
  /** Optional subfolder inside the vault where all Novalist folders live. */
  novalistRoot: string;
  projectPath: string;
  /** All registered projects inside this vault. */
  projects: NovalistProject[];
  /** ID of the currently active project. */
  activeProjectId: string;
  /** Optional shared "World Bible" folder for characters & locations used across projects. */
  worldBiblePath: string;
  autoReplacements: AutoReplacementPair[];
  language: LanguageKey;
  customLanguageLabel: string;
  customLanguageDefaults: AutoReplacementPair[];
  enableSidebarView: boolean;
  enableCustomExplorer: boolean;
  characterFolder: string;
  locationFolder: string;
  imageFolder: string;
  chapterFolder: string;
  relationshipPairs: Record<string, string[]>;
  startupWizardShown: boolean;
  roleColors: Record<string, string>;
  genderColors: Record<string, string>;
  explorerGroupCollapsed: Record<string, boolean>;
  // Word Count Goals
  wordCountGoals: WordCountGoals;
  // Book formatting
  enableBookParagraphSpacing: boolean;
  // Toolbar
  enableToolbar: boolean;
  // Annotations / Comments
  enableAnnotations: boolean;
  commentThreads: CommentThread[];
  // Plot Board
  plotBoard: PlotBoardData;
  // Entity Templates
  characterTemplates: CharacterTemplate[];
  locationTemplates: LocationTemplate[];
  activeCharacterTemplateId: string;
  activeLocationTemplateId: string;
  /** Per-project data, keyed by project ID. */
  projectData: Record<string, ProjectData>;
}

// ─── Comment / Annotation System ────────────────────────────────────
export interface CommentMessage {
  id: string;
  content: string;
  createdAt: string;
}

export interface CommentThread {
  id: string;
  filePath: string;
  anchorText: string;
  from: number;
  to: number;
  messages: CommentMessage[];
  resolved: boolean;
  color: string;
  createdAt: string;
}

export interface AutoReplacementPair {
  start: string;
  end: string;
  startReplace: string;
  endReplace: string;
}

export type LanguageKey =
  | 'de-guillemet'
  | 'de-low'
  | 'en'
  | 'fr'
  | 'es'
  | 'it'
  | 'pt'
  | 'ru'
  | 'pl'
  | 'cs'
  | 'sk'
  | 'custom';

export type FrontmatterValue = string | string[];

export type CodeMirrorLine = {
  text: string;
  from: number;
};

export type CodeMirrorDoc = {
  lineAt: (pos: number) => CodeMirrorLine;
};

export type CodeMirrorLike = {
  dom: HTMLElement;
  posAtCoords: (coords: { x: number; y: number }) => number | null;
  state: { doc: CodeMirrorDoc };
};

import { Editor, TFile } from 'obsidian';
export type EditorWithCodeMirror = Editor & { cm?: CodeMirrorLike };

export interface CharacterChapterInfo {
  chapter: string;
  info: string;
  overrides: Record<string, string>;
  customProperties?: Record<string, string>;
}

export interface CharacterData {
  name: string;
  surname: string;
  role: string;
  gender: string;
  age: string;
  relationship: string;
  templateId?: string;
  customProperties?: Record<string, string>;
  chapterInfos: CharacterChapterInfo[];
}

export interface LocationData {
  name: string;
  description: string;
}

export interface ChapterListData {
  name: string;
  order: number;
  file: TFile;
  scenes?: string[];
}

export interface CharacterListData {
  name: string;
  file: TFile;
  role: string;
  gender: string;
}

export interface LocationListData {
  name: string;
  file: TFile;
}

// Character Sheet Data Structure
// ─── Chapter Status ─────────────────────────────────────────────────
export type ChapterStatus = 'outline' | 'first-draft' | 'revised' | 'edited' | 'final';

export const CHAPTER_STATUSES: { value: ChapterStatus; label: string; icon: string; color: string }[] = [
  { value: 'outline',     get label() { return t('status.outline'); },     icon: '○', color: 'var(--text-faint)' },
  { value: 'first-draft', get label() { return t('status.firstDraft'); },  icon: '◔', color: 'var(--text-warning, #e0a040)' },
  { value: 'revised',     get label() { return t('status.revised'); },     icon: '◑', color: 'var(--text-accent)' },
  { value: 'edited',      get label() { return t('status.edited'); },      icon: '◕', color: 'var(--interactive-accent)' },
  { value: 'final',       get label() { return t('status.final'); },       icon: '●', color: 'var(--text-success, #40c060)' },
];

export interface CharacterRelationship {
  role: string;
  character: string; // wikilink format [[Name]]
}

export interface CharacterSheetSection {
  title: string;
  content: string;
}

export interface CharacterImage {
  name: string;
  path: string; // wikilink format [[path/to/image.png]]
}

export interface SceneData {
  name: string;
  chapterId: string;
  chapterName: string;
  file: TFile;
}

export interface CharacterChapterOverride {
  chapter: string;
  act?: string;
  scene?: string;
  name?: string;
  surname?: string;
  gender?: string;
  age?: string;
  role?: string;
  faceShot?: string; // deprecated
  // Physical attributes
  eyeColor?: string;
  hairColor?: string;
  hairLength?: string;
  height?: string;
  build?: string;
  skinTone?: string;
  distinguishingFeatures?: string;
  images?: CharacterImage[];
  relationships?: CharacterRelationship[];
  customProperties?: Record<string, string>;
}

export interface CharacterSheetData {
  name: string;
  surname: string;
  gender: string;
  age: string;
  role: string;
  faceShot: string; // wikilink to image (deprecated, kept for compatibility)
  // Physical attributes
  eyeColor: string;
  hairColor: string;
  hairLength: string;
  height: string;
  build: string;
  skinTone: string;
  distinguishingFeatures: string;
  images: CharacterImage[]; // Multiple named images
  relationships: CharacterRelationship[];
  customProperties: Record<string, string>;
  sections: CharacterSheetSection[];
  chapterOverrides: CharacterChapterOverride[];
  templateId?: string;
}

// Location Sheet Data Structure
export interface LocationRelationship {
  role: string;
  target: string; // wikilink [[Name]]
}

export interface LocationSheetData {
  name: string;
  type: string;
  description: string;
  images: CharacterImage[];
  relationships: LocationRelationship[]; // Kept for compatibility or future use, though UI removed
  customProperties: Record<string, string>;
  sections: CharacterSheetSection[]; // Reuse section structure
  templateId?: string;
}

// ─── Entity Templates ────────────────────────────────────────────────

/** Supported data types for custom properties. */
export type CustomPropertyType = 'string' | 'int' | 'bool' | 'date' | 'enum' | 'timespan';

/** Time interval unit for timespan custom properties. */
export type IntervalUnit = 'years' | 'months' | 'days';

export const INTERVAL_UNITS: IntervalUnit[] = ['years', 'months', 'days'];

/** Schema definition for one custom property on a template. */
export interface CustomPropertyDefinition {
  /** Property key written to the sheet (used as the label). */
  key: string;
  /** Data type that controls how the value is rendered and validated. */
  type: CustomPropertyType;
  /** Default value (always stored as a string). */
  defaultValue: string;
  /** Options for 'enum' type properties (plain string list). */
  enumOptions?: string[];
  /** Interval unit for 'timespan' type properties. */
  intervalUnit?: IntervalUnit;
}

export interface TemplateField {
  /** Field key written to the sheet (e.g. 'Gender', 'EyeColor'). */
  key: string;
  /** Default value that gets populated when file is created. */
  defaultValue: string;
}

export interface TemplateSection {
  /** Section title (e.g. 'Backstory', 'Personality'). */
  title: string;
  /** Default content for the section when the file is created. */
  defaultContent: string;
}

export interface CharacterTemplate {
  id: string;
  name: string;
  /** Built-in templates cannot be deleted. */
  builtIn: boolean;
  /** Fields included in the CharacterSheet block (besides Name/Surname which are always present). */
  fields: TemplateField[];
  /** Typed custom-property definitions (replaces the legacy `customProperties` map). */
  customPropertyDefs: CustomPropertyDefinition[];
  /**
   * @deprecated Kept only for backward-compatible migration.
   * New code should use `customPropertyDefs` instead.
   */
  customProperties?: Record<string, string>;
  /** Free-form sections to include. */
  sections: TemplateSection[];
  includeRelationships: boolean;
  includeImages: boolean;
  includeChapterOverrides: boolean;
  /** Whether the Age field is a plain number or a date (birthdate) with timespan. */
  ageMode?: 'number' | 'date';
  /** Interval unit when ageMode is 'date'. */
  ageIntervalUnit?: IntervalUnit;
}

export interface LocationTemplate {
  id: string;
  name: string;
  builtIn: boolean;
  /** Fields included in the LocationSheet block (besides Name which is always present). */
  fields: TemplateField[];
  /** Typed custom-property definitions (replaces the legacy `customProperties` map). */
  customPropertyDefs: CustomPropertyDefinition[];
  /**
   * @deprecated Kept only for backward-compatible migration.
   * New code should use `customPropertyDefs` instead.
   */
  customProperties?: Record<string, string>;
  sections: TemplateSection[];
  includeImages: boolean;
}

/** All known fields for character sheets (used in template editor). */
export const CHARACTER_TEMPLATE_KNOWN_FIELDS: string[] = [
  'Gender', 'Age', 'Role',
  'EyeColor', 'HairColor', 'HairLength',
  'Height', 'Build', 'SkinTone', 'DistinguishingFeatures',
];

/** All known fields for location sheets (used in template editor). */
export const LOCATION_TEMPLATE_KNOWN_FIELDS: string[] = [
  'Type', 'Description',
];

/** All available custom-property data types. */
export const CUSTOM_PROPERTY_TYPES: CustomPropertyType[] = [
  'string', 'int', 'bool', 'date', 'enum', 'timespan',
];

// Word Count & Statistics
export interface ChapterWordCount {
  file: TFile;
  name: string;
  wordCount: number;
  charCount: number;
  charCountNoSpaces: number;
  readability?: ReadabilityScore;
}

export interface ReadabilityScore {
  /** Score value (typically 0-100, higher = easier to read) */
  score: number;
  /** Interpretation level */
  level: 'very_easy' | 'easy' | 'moderate' | 'difficult' | 'very_difficult';
  /** Human-readable description */
  description: string;
  /** Average words per sentence */
  wordsPerSentence: number;
  /** Average characters per word */
  charsPerWord: number;
  /** Total sentences counted */
  sentenceCount: number;
  /** Method used for calculation */
  method: string;
}

export interface ProjectStatistics {
  totalWords: number;
  totalChapters: number;
  totalCharacters: number;
  totalLocations: number;
  estimatedReadingTime: number; // in minutes
  averageChapterLength: number;
  longestChapter: ChapterWordCount | null;
  shortestChapter: ChapterWordCount | null;
  chapterStats: ChapterWordCount[];
}

export interface DailyWritingGoal {
  date: string; // YYYY-MM-DD
  targetWords: number;
  actualWords: number;
}

// ─── Plot Board ─────────────────────────────────────────────────────
export interface PlotBoardColumn {
  id: string;
  name: string;
}

export interface PlotBoardLabel {
  id: string;
  name: string;
  color: string;
}

export type PlotBoardViewMode = 'board' | 'table';

export interface PlotBoardData {
  columns: PlotBoardColumn[];
  /** chapterId → columnId → cell text */
  cells: Record<string, Record<string, string>>;
  /** Available labels for color-coding cards */
  labels: PlotBoardLabel[];
  /** chapterId → hex color */
  cardColors: Record<string, string>;
  /** chapterId → array of label ids */
  cardLabels: Record<string, string[]>;
  /** Current view ('board' = kanban, 'table' = spreadsheet) */
  viewMode: PlotBoardViewMode;
  /** Which act lanes are collapsed in board view */
  collapsedActs: string[];
}

export interface WordCountGoals {
  dailyGoal: number;
  projectGoal: number;
  deadline?: string; // YYYY-MM-DD
  dailyHistory: DailyWritingGoal[];
  /** Persisted baseline for daily tracking (survives restarts). */
  dailyBaselineWords?: number;
  dailyBaselineDate?: string;
}
