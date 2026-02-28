import { t } from '../i18n';

// ─── Multi-project & World Bible ────────────────────────────────────
export interface NovalistProject {
  id: string;
  name: string;
  path: string;
}

// ─── Mention Cache ──────────────────────────────────────────────────

/** The set of entity names detected in a chunk of text. */
export interface MentionResult {
  characters: string[];
  locations: string[];
  items: string[];
  lore: string[];
}

/** Serialisable AI finding stored in the mention cache. */
export interface CachedAiFinding {
  type: 'reference' | 'inconsistency' | 'suggestion';
  title: string;
  description: string;
  excerpt?: string;
  entityName?: string;
  entityType?: string;
}

/** Result of a whole-story AI analysis, persisted in ProjectData. */
export interface WholeStoryAnalysisResult {
  /** ISO timestamp when the analysis was run. */
  timestamp: string;
  findings: CachedAiFinding[];
  thinking: string;
  rawResponse: string;
}

/** Cached mention-scan results for a single chapter file. */
export interface MentionCacheEntry {
  /** SHA-256 hex digest of the file content at scan time. */
  hash: string;
  /** Chapter-level (whole-file) mention results. */
  chapter: MentionResult;
  /** Per-scene mention results, keyed by scene (H2) heading name. */
  scenes: Record<string, MentionResult>;
  /** AI findings produced during the last analysis of this chapter. */
  aiFindings?: CachedAiFinding[];
}

// ─── Chapter Notes ──────────────────────────────────────────────────

/** Notes stored for a single chapter (keyed by chapter GUID). */
export interface ChapterNoteData {
  /** Markdown note for the chapter heading itself. */
  chapterNote: string;
  /** Per-scene notes, keyed by scene (H2) heading name. */
  sceneNotes: Record<string, string>;
}

/** Map of chapter GUID → notes data, stored in ProjectData. */
export type ChapterNotes = Record<string, ChapterNoteData>;

/** Per-project data stored alongside global settings. */
export interface ProjectData {
  commentThreads: CommentThread[];
  plotBoard: PlotBoardData;
  wordCountGoals: WordCountGoals;
  explorerGroupCollapsed: Record<string, boolean>;
  relationshipPairs: Record<string, string[]>;
  recentEdits: RecentEditEntry[];
  timeline: TimelineData;
  /** Cached entity-mention scan results keyed by chapter file path (relative to vault root). */
  mentionCache: Record<string, MentionCacheEntry>;
  /** Result of the last whole-story AI analysis (cross-chapter review). */
  wholeStoryAnalysis?: WholeStoryAnalysisResult;
  /** Cache format version - incremented when scanning logic changes to invalidate old caches. */
  mentionCacheVersion?: number;
  /** Chapter and scene notes/outlines, keyed by chapter GUID. */
  chapterNotes: ChapterNotes;
  /** Cached auto-detected scene metadata, keyed by chapter file path. */
  sceneMetadataCache: Record<string, SceneMetadataCache>;
  /** Manual overrides for scene metadata fields, keyed by "chapterId:sceneName". */
  sceneMetadataOverrides: Record<string, Partial<SceneMetadataOverrides>>;
  /** Last plot validation result for this project. */
  validationResult?: ValidationResult;
  /** Findings the user has explicitly dismissed, persisted across sessions. */
  dismissedFindings: DismissedFinding[];
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
  itemFolder: string;
  loreFolder: string;
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
  // Explorer auto-reveal
  enableExplorerAutoReveal: boolean;
  // Annotations / Comments
  enableAnnotations: boolean;
  commentThreads: CommentThread[];
  // Plot Board
  plotBoard: PlotBoardData;
  // Timeline
  timeline: TimelineData;
  // Entity Templates
  characterTemplates: CharacterTemplate[];
  locationTemplates: LocationTemplate[];
  itemTemplates: ItemTemplate[];
  loreTemplates: LoreTemplate[];
  activeCharacterTemplateId: string;
  activeLocationTemplateId: string;
  activeItemTemplateId: string;
  activeLoreTemplateId: string;
  /** Per-project data, keyed by project ID. */
  projectData: Record<string, ProjectData>;
  /** Ollama / AI assistant configuration. */
  ollama: OllamaSettings;
  /** Recently edited files for Dashboard quick access. */
  recentEdits: RecentEditEntry[];
  // Chapter notes panel
  chapterNotes: ChapterNotes;
  enableChapterNotes: boolean;
  /** Persisted Focus Peek card dimensions. */
  focusPeekSize: { width: number; height: number } | null;
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

// ─── Item / Artifact Sheet Data ──────────────────────────────────────

export interface ItemSheetData {
  name: string;
  type: string;
  description: string;
  origin: string;
  images: CharacterImage[];
  customProperties: Record<string, string>;
  sections: CharacterSheetSection[];
  templateId?: string;
}

export interface ItemListData {
  name: string;
  file: TFile;
  type: string;
}

// ─── Lore / Encyclopedia Sheet Data ──────────────────────────────────

export type LoreCategory = 'Organization' | 'Culture' | 'History' | 'Other';

export const LORE_CATEGORIES: LoreCategory[] = ['Organization', 'Culture', 'History', 'Other'];

export interface LoreSheetData {
  name: string;
  category: string;
  description: string;
  images: CharacterImage[];
  customProperties: Record<string, string>;
  sections: CharacterSheetSection[];
  templateId?: string;
}

export interface LoreListData {
  name: string;
  file: TFile;
  category: string;
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

export interface ItemTemplate {
  id: string;
  name: string;
  builtIn: boolean;
  /** Fields included in the ItemSheet block (besides Name which is always present). */
  fields: TemplateField[];
  customPropertyDefs: CustomPropertyDefinition[];
  sections: TemplateSection[];
  includeImages: boolean;
}

export interface LoreTemplate {
  id: string;
  name: string;
  builtIn: boolean;
  /** Fields included in the LoreSheet block (besides Name which is always present). */
  fields: TemplateField[];
  customPropertyDefs: CustomPropertyDefinition[];
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

/** All known fields for item sheets (used in template editor). */
export const ITEM_TEMPLATE_KNOWN_FIELDS: string[] = [
  'Type', 'Description', 'Origin',
];

/** All known fields for lore sheets (used in template editor). */
export const LORE_TEMPLATE_KNOWN_FIELDS: string[] = [
  'Category', 'Description',
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

// ─── Recent Edit Tracking ────────────────────────────────────────────
export interface RecentEditEntry {
  /** File path relative to vault root */
  filePath: string;
  /** Display name (chapter title or filename) */
  displayName: string;
  /** Last known cursor line (0-based, matching Obsidian EditorPosition) */
  line: number;
  /** Last known cursor column/character (0-based) */
  ch: number;
  /** Timestamp of last edit (ISO string) */
  timestamp: string;
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

// ─── Ollama / AI Assistant ──────────────────────────────────────────
export type AiProvider = 'ollama' | 'copilot';
export type AiAnalysisMode = 'paragraph' | 'chapter';

export interface OllamaSettings {
  /** Whether the AI assistant feature is enabled. */
  enabled: boolean;
  /** Which LLM provider to use. */
  provider: AiProvider;
  /** Whether to analyse per paragraph or send the whole chapter at once. */
  analysisMode: AiAnalysisMode;
  /** Base URL of the Ollama API server. */
  baseUrl: string;
  /** Model name to use (e.g. "llama3.2:latest"). */
  model: string;
  /** Auto-load model when needed and unload on plugin close. */
  autoManageModel: boolean;
  /** Enable reference detection in AI analysis. */
  checkReferences: boolean;
  /** Enable inconsistency checking in AI analysis. */
  checkInconsistencies: boolean;
  /** Enable entity suggestion detection in AI analysis. */
  checkSuggestions: boolean;
  /** Path to the Copilot CLI executable (used when provider is 'copilot'). */
  copilotPath: string;
  /** Copilot model to use (e.g. "gpt-4o"). Empty means Copilot's default. */
  copilotModel: string;
  /** Temperature for Ollama generation (0 = deterministic, higher = more creative). */
  temperature: number;
  /** Maximum number of tokens the model may generate per request. */
  maxTokens: number;
  /** When true, skip regex-based entity scanning and rely solely on AI for reference detection. */
  disableRegexReferences: boolean;
  /** Custom system prompt override. If empty, the default prompt is used. */
  systemPrompt: string;
  /** Top P sampling (0-1). Lower values make output more focused. */
  topP: number;
  /** Min P sampling (0-1). Tokens with probability below this are filtered out. */
  minP: number;
  /** Frequency penalty (0-2). Higher values reduce repetition. */
  frequencyPenalty: number;
  /** Repeat last N tokens to check for repetition. */
  repeatLastN: number;
}

// ─── Timeline ───────────────────────────────────────────────────────

export type TimelineViewMode = 'horizontal' | 'vertical';
export type TimelineZoomLevel = 'year' | 'month' | 'day';
export type TimelineEventSource = 'chapter' | 'scene' | 'act' | 'manual';

export interface TimelineCategory {
  id: string;
  name: string;
  color: string;
}

export interface TimelineManualEvent {
  id: string;
  /** Display title for the event */
  title: string;
  /** Date string — YYYY-MM-DD or free-form */
  date: string;
  /** Optional description */
  description: string;
  /** Category ID for color-coding */
  categoryId: string;
  /** Optional link to a chapter file path */
  linkedChapterPath: string;
  /** Optional link to a scene name within the linked chapter */
  linkedSceneName: string;
  /** Manual sort order within same date */
  order: number;
  /** Character references for this event */
  characters: string[];
  /** Location references for this event */
  locations: string[];
}

export interface TimelineData {
  /** Manual events not derived from chapters */
  manualEvents: TimelineManualEvent[];
  /** User-defined categories for color-coding */
  categories: TimelineCategory[];
  /** Current display mode preference */
  viewMode: TimelineViewMode;
  /** Current zoom level preference */
  zoomLevel: TimelineZoomLevel;
}

/** Unified event used for rendering — built at render time from all sources */
export interface TimelineEvent {
  id: string;
  title: string;
  date: string;
  /** Parsed sortable date — null if date cannot be parsed */
  sortDate: Date | null;
  description: string;
  source: TimelineEventSource;
  categoryId: string;
  categoryColor: string;
  /** Chapter file path if linked */
  chapterPath: string;
  /** Scene name within chapter if applicable */
  sceneName: string;
  /** Act name if applicable */
  actName: string;
  /** Chapter order for items with same date */
  chapterOrder: number;
  /** Characters detected in the source chapter */
  characters: string[];
  /** Locations detected in the source chapter */
  locations: string[];
}

// ─── Scene Metadata ─────────────────────────────────────────────────

/** Emotional tone detected or assigned to a scene. */
export type SceneEmotion =
  | 'neutral' | 'tense' | 'joyful' | 'melancholic' | 'angry'
  | 'fearful' | 'romantic' | 'mysterious' | 'humorous' | 'hopeful'
  | 'desperate' | 'peaceful' | 'chaotic' | 'sorrowful' | 'triumphant';

/** How a metadata field value was determined. */
export type MetadataSource = 'auto' | 'manual' | 'ai';

/** A metadata value with provenance tracking. */
export interface TrackedValue<T> {
  value: T;
  source: MetadataSource;
}

/** Rich metadata for a single scene (H2 section within a chapter). */
export interface SceneMetadata {
  /** Scene heading text (H2). */
  name: string;
  /** Chapter file this scene belongs to (relative vault path). */
  chapterPath: string;
  /** Chapter GUID for stable references. */
  chapterId: string;

  /** Point-of-view character — auto-detected from first/dominant character. */
  pov: TrackedValue<string>;
  /** Characters present in this scene (from scanMentions). */
  characters: TrackedValue<string[]>;
  /** Locations mentioned in this scene. */
  locations: TrackedValue<string[]>;
  /** Items mentioned in this scene. */
  items: TrackedValue<string[]>;
  /** Lore entries referenced in this scene. */
  lore: TrackedValue<string[]>;

  /** Primary emotional tone. */
  emotion: TrackedValue<SceneEmotion>;
  /** Narrative intensity (−10 to +10). */
  intensity: TrackedValue<number>;
  /** One-line conflict/tension summary. */
  conflict: TrackedValue<string>;
  /** Plotline / subplot tags. */
  tags: TrackedValue<string[]>;

  /** Word count of the scene section. */
  wordCount: number;
  /** Dialogue-to-prose ratio (0–1). */
  dialogueRatio: number;
  /** Average sentence length in words. */
  avgSentenceLength: number;
  /** Exclamation/question density (per 100 words). */
  punctuationIntensity: number;
}

/**
 * Persisted scene metadata cache for a chapter.
 * Stored in ProjectData.sceneMetadataCache alongside mentionCache.
 */
export interface SceneMetadataCache {
  /** SHA-256 hex digest of chapter content at analysis time. */
  hash: string;
  /** Per-scene metadata, keyed by scene heading name. */
  scenes: Record<string, SceneMetadata>;
  /** Chapter-level aggregate metadata. */
  chapterAggregate: ChapterAggregateMetadata;
}

/** Aggregate metadata computed across all scenes in a chapter. */
export interface ChapterAggregateMetadata {
  /** All unique characters across all scenes. */
  allCharacters: string[];
  /** All unique locations. */
  allLocations: string[];
  /** Dominant POV character (most scenes). */
  dominantPov: string;
  /** Average intensity across scenes. */
  avgIntensity: number;
  /** Dominant emotion (most common across scenes). */
  dominantEmotion: SceneEmotion;
  /** Total word count. */
  totalWordCount: number;
  /** Ordered intensity values for each scene (for sparkline). */
  intensityArc: number[];
}

/** Fields the user can manually override per scene. */
export interface SceneMetadataOverrides {
  pov: string;
  emotion: SceneEmotion;
  intensity: number;
  conflict: string;
  tags: string[];
}

// ─── Plot Validator ──────────────────────────────────────────────────

/** Severity of a validation finding. */
export type ValidatorSeverity = 'error' | 'warning' | 'info';

/** Category a validation rule belongs to. */
export type ValidatorCategory =
  | 'timeline'
  | 'characters'
  | 'plotlines'
  | 'structure'
  | 'continuity'
  | 'pacing';

/** A single validation finding produced by the rule engine. */
export interface ValidatorFinding {
  /** Unique rule identifier (e.g. 'timeline.dateOrder', 'character.orphan'). */
  ruleId: string;
  /** Which category this rule belongs to. */
  category: ValidatorCategory;
  /** Severity level. */
  severity: ValidatorSeverity;
  /** Short human-readable title. */
  title: string;
  /** Detailed description with context. */
  description: string;
  /** Chapter file path relevant to this finding (for click-to-navigate). */
  filePath?: string;
  /** Scene name within the chapter, if applicable. */
  sceneName?: string;
  /** Entity names involved (characters, locations etc.). */
  entities?: string[];
  /** Stable fingerprint for dismissal matching. */
  fingerprint: string;
  /** Whether this finding was produced by a rule engine or AI analysis. */
  source?: 'rule' | 'ai';
}

/** Result of a full validation run persisted in ProjectData. */
export interface ValidationResult {
  /** ISO timestamp of the validation run. */
  timestamp: string;
  /** All findings. */
  findings: ValidatorFinding[];
  /** Summary counts by severity. */
  summary: { errors: number; warnings: number; infos: number };
}

/** A finding that the user has explicitly dismissed. */
export interface DismissedFinding {
  /** Rule ID. */
  ruleId: string;
  /** Fingerprint matching ValidatorFinding.fingerprint. */
  fingerprint: string;
  /** ISO timestamp of dismissal. */
  timestamp: string;
}
