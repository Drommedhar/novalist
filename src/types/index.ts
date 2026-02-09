export interface NovalistSettings {
  projectPath: string;
  autoReplacements: AutoReplacementPair[];
  language: LanguageKey;
  customLanguageLabel: string;
  customLanguageDefaults: AutoReplacementPair[];
  enableHoverPreview: boolean;
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

export interface CharacterChapterOverride {
  chapter: string;
  name?: string;
  surname?: string;
  gender?: string;
  age?: string;
  role?: string;
  faceShot?: string; // deprecated
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

export interface WordCountGoals {
  dailyGoal: number;
  projectGoal: number;
  deadline?: string; // YYYY-MM-DD
  dailyHistory: DailyWritingGoal[];
}
