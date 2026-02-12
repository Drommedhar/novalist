import { t } from '../i18n';

export interface NovalistSettings {
  projectPath: string;
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
}

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

export interface PlotBoardData {
  columns: PlotBoardColumn[];
  /** chapterId → columnId → cell text */
  cells: Record<string, Record<string, string>>;
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
