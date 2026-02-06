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
  chapterDescFolder: string;
  chapterFolder: string;
  relationshipPairs: Record<string, string[]>;
  startupWizardShown: boolean;
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
}

export interface CharacterData {
  name: string;
  surname: string;
  role: string;
  gender: string;
  age: string;
  relationship: string;
  chapterInfos: CharacterChapterInfo[];
}

export interface LocationData {
  name: string;
  description: string;
}

export interface ChapterListData {
  name: string;
  file: TFile;
  descFile: TFile;
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
