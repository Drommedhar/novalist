import {
  Plugin,
  TFile,
  MarkdownView,
  MarkdownRenderer,
  Component,
  Editor,
  Notice,
  EditorPosition,
  WorkspaceLeaf
} from 'obsidian';
import {
  NovalistSettings,
  EditorWithCodeMirror,
  AutoReplacementPair,
  LanguageKey,
  CharacterData,
  CharacterChapterInfo,
  LocationData,
  ChapterListData,
  CharacterListData,
  LocationListData
} from './types';
import { DEFAULT_SETTINGS, cloneAutoReplacements, LANGUAGE_DEFAULTS } from './settings/NovalistSettings';
import { NovalistSidebarView, NOVELIST_SIDEBAR_VIEW_TYPE } from './views/NovalistSidebarView';
import { NovalistExplorerView, NOVELIST_EXPLORER_VIEW_TYPE } from './views/NovalistExplorerView';
import { CharacterMapView, CHARACTER_MAP_VIEW_TYPE } from './views/CharacterMapView';
import { LocationSheetView, LOCATION_SHEET_VIEW_TYPE } from './views/LocationSheetView';
import { CharacterSheetView, CHARACTER_SHEET_VIEW_TYPE } from './views/CharacterSheetView';
import { ExportView, EXPORT_VIEW_TYPE } from './views/ExportView';
import { PlotBoardView, PLOT_BOARD_VIEW_TYPE } from './views/PlotBoardView';
import { NovalistToolbarManager } from './utils/toolbarUtils';

import { CharacterSuggester } from './suggesters/CharacterSuggester';
import { RelationshipKeySuggester } from './suggesters/RelationshipKeySuggester';
import { ImageSuggester } from './suggesters/ImageSuggester';
import { CharacterModal } from './modals/CharacterModal';
import { LocationModal } from './modals/LocationModal';
import { ChapterDescriptionModal } from './modals/ChapterDescriptionModal';
import { StartupWizardModal } from './modals/StartupWizardModal';
import { NovalistSettingTab } from './settings/NovalistSettingTab';
import { normalizeCharacterRole } from './utils/characterUtils';
import { parseCharacterSheet } from './utils/characterSheetUtils';
import { parseLocationSheet } from './utils/locationSheetUtils';
import {
  annotationExtension,
  setThreadsEffect,
  threadsField,
  nextAnnotationColor,
  type AnnotationCallbacks
} from './cm/annotationExtension';
import { statisticsPanelExtension, type StatisticsPanelConfig, type ChapterOverviewStat } from './cm/statisticsPanelExtension';
import { focusPeekExtension, type FocusPeekCallbacks, type EntityPeekData } from './cm/focusPeekExtension';
import { countWords, getTodayDate, getOrCreateDailyGoal } from './utils/statisticsUtils';
import { calculateReadability } from './utils/readabilityUtils';
import type { CommentThread, CommentMessage } from './types';

export default class NovalistPlugin extends Plugin {
  settings: NovalistSettings;
  private entityIndex: Map<string, { path: string; display: string }> = new Map();
  private entityRegex: RegExp | null = null;
  public knownRelationshipKeys: Set<string> = new Set();
  toolbarManager: NovalistToolbarManager;
  private annotationExtension: import('@codemirror/state').Extension | null = null;
  private cachedProjectOverview = { totalWords: 0, totalChapters: 0, totalCharacters: 0, totalLocations: 0, readingTime: 0, avgChapter: 0, chapters: [] as ChapterOverviewStat[] };
  private projectWordsCacheTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    
    // Apply book paragraph spacing if enabled
    this.updateBookParagraphSpacing();

    await this.refreshEntityIndex();
    this.app.workspace.onLayoutReady(() => {
      if (!this.settings.startupWizardShown || !this.app.vault.getAbstractFileByPath(this.settings.projectPath)) {
        new StartupWizardModal(this.app, this).open();
      }
    });
    
    // Register Editor Suggester
    this.registerEditorSuggest(new ImageSuggester(this));
    this.registerEditorSuggest(new CharacterSuggester(this));
    this.registerEditorSuggest(new RelationshipKeySuggester(this));

    // Register sidebar view
    this.registerView(
      NOVELIST_SIDEBAR_VIEW_TYPE,
      (leaf) => new NovalistSidebarView(leaf, this)
    );

    // Register custom explorer view
    this.registerView(
      NOVELIST_EXPLORER_VIEW_TYPE,
      (leaf) => new NovalistExplorerView(leaf, this)
    );

    // Register character map view
    this.registerView(
      CHARACTER_MAP_VIEW_TYPE,
      (leaf) => new CharacterMapView(leaf, this)
    );

    // Register character sheet view
    this.registerView(
      CHARACTER_SHEET_VIEW_TYPE,
      (leaf) => new CharacterSheetView(leaf, this)
    );

    // Register location sheet view
    this.registerView(
      LOCATION_SHEET_VIEW_TYPE,
      (leaf) => new LocationSheetView(leaf, this)
    );

    // Register export view
    this.registerView(
      EXPORT_VIEW_TYPE,
      (leaf) => new ExportView(leaf, this)
    );

    // Register plot board view
    this.registerView(
      PLOT_BOARD_VIEW_TYPE,
      (leaf) => new PlotBoardView(leaf, this)
    );

    // Register annotation CM6 extension
    this.setupAnnotationExtension();

    // Register statistics bottom panel CM6 extension
    this.setupStatisticsPanel();

    // Register focus peek CM6 extension (inline entity cards)
    this.setupFocusPeek();

    // Command to open current character file in sheet view
    this.addCommand({
      id: 'open-character-sheet',
      name: 'Open character sheet view',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = file instanceof TFile && this.isCharacterFile(file);
        if (checking) return canRun;
        if (canRun && file) {
          const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
          void this.openCharacterSheet(file, activeView?.leaf);
        }
      }
    });

    // Command to open current location file in sheet view
    this.addCommand({
      id: 'open-location-sheet',
      name: 'Open location sheet view',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = file instanceof TFile && this.isLocationFile(file);
        if (checking) return canRun;
        if (canRun && file) {
          const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
          void this.openLocationSheet(file, activeView?.leaf);
        }
      }
    });

    // Add ribbon icon
    this.addRibbonIcon('book-open', 'Novalist sidebar', () => {
      void this.activateView();
    });

    // Initialize toolbar manager and apply setting
    this.toolbarManager = new NovalistToolbarManager(this);
    this.toolbarManager.update();

    // Initialize project structure command
    this.addCommand({
      id: 'initialize-novel-project',
      name: 'Initialize novel project structure',
      callback: () => {
        new StartupWizardModal(this.app, this).open();
      }
    });

    // Open sidebar command
    this.addCommand({
      id: 'open-context-sidebar',
      name: 'Open context sidebar',
      callback: () => {
        void this.activateView();
      }
    });

    // Open custom explorer command
    this.addCommand({
      id: 'open-custom-explorer',
      name: 'Open custom explorer',
      callback: () => {
        void this.activateExplorerView(true);
      }
    });

    this.addCommand({
      id: 'open-character-map',
      name: 'Open character map',
      callback: () => {
        void this.activateCharacterMapView();
      }
    });

    // Open export view
    this.addCommand({
      id: 'open-export',
      name: 'Export novel',
      callback: () => {
        void this.activateExportView();
      }
    });

    // Open plot board
    this.addCommand({
      id: 'open-plot-board',
      name: 'Open plot board',
      callback: () => {
        void this.activatePlotBoardView();
      }
    });



    // Add new character command
    this.addCommand({
      id: 'add-character',
      name: 'Add new character',
      callback: () => {
        this.openCharacterModal();
      }
    });

    // Add new location command
    this.addCommand({
      id: 'add-location',
      name: 'Add new location',
      callback: () => {
        this.openLocationModal();
      }
    });

    // Add new chapter command
    this.addCommand({
      id: 'add-chapter-description',
      name: 'Add new chapter',
      callback: () => {
        this.openChapterDescriptionModal();
      }
    });

    // Register settings tab
    this.addSettingTab(new NovalistSettingTab(this.app, this));

    // Handle auto-replacement on keyup
    this.registerEvent(
      this.app.workspace.on('editor-change', () => {
        this.handleBoldFieldFormatting();
        this.handleAutoReplacement();
      })
    );

    // Register Markdown post-processor for linkification in preview
    this.registerMarkdownPostProcessor((el) => {
      this.linkifyElement(el);
    });

    // Layout changes
    this.registerEvent(this.app.workspace.on('layout-change', () => {
        if (this.settings.enableCustomExplorer) {
            void this.activateExplorerView();
        }
    }));

    // Auto-open character and location files in sheet view
    const processedFiles = new Set<string>();
    this.registerEvent(this.app.workspace.on('file-open', (file: TFile | null) => {
      if (!file) return;
      
      const isChar = this.isCharacterFile(file);
      const isLoc = this.isLocationFile(file);
      
      if (!isChar && !isLoc) return;
      
      // Skip if we already processed this file recently (avoid loops)
      if (processedFiles.has(file.path)) return;
      
      // Check if current active view is a markdown view
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!activeView) return;
      const activeLeaf = activeView.leaf;
      
      processedFiles.add(file.path);
      setTimeout(() => {
        if (isChar) {
            void this.openCharacterSheet(file, activeLeaf);
        } else {
            void this.openLocationSheet(file, activeLeaf);
        }
        // Remove from processed after a delay
        setTimeout(() => processedFiles.delete(file.path), 500);
      }, 50);
    }));

    // Index update triggers
    this.registerEvent(this.app.vault.on('create', () => { void this.refreshEntityIndex(); }));
    this.registerEvent(this.app.vault.on('delete', () => { void this.refreshEntityIndex(); }));
    this.registerEvent(this.app.vault.on('rename', () => { void this.refreshEntityIndex(); }));
    this.registerEvent(this.app.vault.on('modify', () => { void this.refreshEntityIndex(); }));

    // Refresh explorer on creation
    this.registerEvent(this.app.vault.on('create', (file) => {
      if (file instanceof TFile && this.isChapterFile(file)) {
         void this.refreshEntityIndex();
      }
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      if (file instanceof TFile && this.isChapterFile(file)) {
         void this.refreshEntityIndex();
      }
    }));

    // Move uploaded images to image folder if they are added within the project context
    this.registerEvent(this.app.vault.on('create', (file) => {
        if (!(file instanceof TFile)) return;
        
        const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];
        if (!IMAGE_EXTENSIONS.includes(file.extension.toLowerCase())) return;

        // Check if we are inside a project file
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;

        const projectPath = this.settings.projectPath;
        if (!activeFile.path.startsWith(projectPath)) return;

        // Determine destination
        const imageFolder = `${projectPath}/${this.settings.imageFolder}`;
        
        // Ensure folder exists (it should, but safety first)
        const abstractFolder = this.app.vault.getAbstractFileByPath(imageFolder);
        if (!abstractFolder) {
             void this.app.vault.createFolder(imageFolder);
        }

        // If file is already in there, we are good
        if (file.path.startsWith(imageFolder)) return;

        // Move logic
        // We need to construct new path
        let newPath = `${imageFolder}/${file.name}`;
        
        // Handle name collision
        let counter = 1;
        while (this.app.vault.getAbstractFileByPath(newPath)) {
            const namePart = file.basename;
            const extPart = file.extension;
            newPath = `${imageFolder}/${namePart} ${counter}.${extPart}`;
            counter++;
        }

        // Use fileManager to rename (updates links automatically)
        setTimeout(() => {
             void this.app.fileManager.renameFile(file, newPath);
        }, 100); // Slight delay to ensure Obsidian initial 'create' logic settles?
    }));
  }

  onunload(): void {
    // Clean up paragraph spacing class
    document.body.classList.remove('novalist-book-paragraph-spacing');
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData() as NovalistSettings | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  updateBookParagraphSpacing(): void {
    const body = document.body;
    if (this.settings.enableBookParagraphSpacing) {
      body.classList.add('novalist-book-paragraph-spacing');
    } else {
      body.classList.remove('novalist-book-paragraph-spacing');
    }
  }

  updateToolbar(): void {
    this.toolbarManager.update();
  }

  async addRelationshipToFile(file: TFile, relationshipKey: string, sourceName: string): Promise<void> {
    const content = await this.app.vault.read(file);
    const lines = content.split('\n');
    
    // Find "Relationships" section
    let relationshipIdx = lines.findIndex(l => l.trim() === '## Relationships');
    
    if (relationshipIdx === -1) {
       // Append section if missing
       lines.push('', '## Relationships', '');
       relationshipIdx = lines.length - 2;
    }

    // Find if the key already exists after the Relationships header
    let keyIdx = -1;
    for (let i = relationshipIdx + 1; i < lines.length; i++) {
        if (lines[i].startsWith('## ')) break; // New section
        const match = lines[i].match(new RegExp(`^\\s*[-*]\\s*\\*\\*${this.escapeRegex(relationshipKey)}\\*\\*[:]?\\s*(.*)$`));
        if (match) {
            keyIdx = i;
            break;
        }
    }

    const wikilink = `[[${sourceName}]]`;

    if (keyIdx !== -1) {
        // Key exists, check if link is already there
        const line = lines[keyIdx];
        if (!line.includes(wikilink)) {
            const separator = line.includes(']]') ? ', ' : '';
            lines[keyIdx] = line.trimEnd() + separator + wikilink;
        }
    } else {
        // Create new line for this key
        const newLine = `- **${relationshipKey}**: ${wikilink}`;
        lines.splice(relationshipIdx + 1, 0, newLine);
    }

    await this.app.vault.modify(file, lines.join('\n'));
    new Notice(`Updated relationships in ${file.basename}`);
  }

  async learnRelationshipPair(keyA: string, keyB: string): Promise<void> {
     if (!this.settings.relationshipPairs[keyA]) this.settings.relationshipPairs[keyA] = [];
     if (!this.settings.relationshipPairs[keyB]) this.settings.relationshipPairs[keyB] = [];

     const listA = this.settings.relationshipPairs[keyA];
     const listB = this.settings.relationshipPairs[keyB];

     let changed = false;
     if (!listA.includes(keyB)) {
         listA.push(keyB);
         changed = true;
     }
     if (!listB.includes(keyA)) {
         listB.push(keyA);
         changed = true;
     }

     if (changed) {
         await this.saveSettings();
     }
  }

  normalizeAutoReplacements(value: AutoReplacementPair[], language: LanguageKey, customDefaults: AutoReplacementPair[]): AutoReplacementPair[] {
    if (Array.isArray(value)) return this.normalizeAutoReplacementPairs(value);
    if (language === 'custom') return cloneAutoReplacements(customDefaults);
    return cloneAutoReplacements(LANGUAGE_DEFAULTS[language]);
  }

  normalizeAutoReplacementPairs(value: AutoReplacementPair[]): AutoReplacementPair[] {
    return value.map((entry) => ({
      start: this.getReplacementField(entry, 'start'),
      end: this.getReplacementField(entry, 'end'),
      startReplace: this.getReplacementField(entry, 'startReplace'),
      endReplace: this.getReplacementField(entry, 'endReplace')
    }));
  }

  getReplacementField(entry: AutoReplacementPair, key: keyof AutoReplacementPair): string {
    return typeof entry[key] === 'string' ? entry[key] : '';
  }

  isLanguageKey(value: string): value is LanguageKey {
    return typeof value === 'string' && value in LANGUAGE_DEFAULTS;
  }

  isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  async activateView(): Promise<void> {
    // Check if sidebar already exists
    const existing = this.app.workspace.getLeavesOfType(NOVELIST_SIDEBAR_VIEW_TYPE);
    if (existing.length > 0) {
      // Reveal existing sidebar
      void this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    // Create new sidebar
    const rightLeaf = this.app.workspace.getRightLeaf(false);
    if (rightLeaf) {
        await rightLeaf.setViewState({
            type: NOVELIST_SIDEBAR_VIEW_TYPE,
            active: true
        });
        void this.app.workspace.revealLeaf(rightLeaf);
    }
  }

  async activateExplorerView(replaceFileExplorer = false): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(NOVELIST_EXPLORER_VIEW_TYPE);
    if (existing.length > 0) {
        void this.app.workspace.revealLeaf(existing[0]);
        return;
    }

    const leaf = replaceFileExplorer 
        ? this.app.workspace.getLeavesOfType('file-explorer')[0] || this.app.workspace.getLeftLeaf(false)
        : this.app.workspace.getLeftLeaf(false);
    
    if (leaf) {
        await leaf.setViewState({
            type: NOVELIST_EXPLORER_VIEW_TYPE,
            active: true
        });

        void this.app.workspace.revealLeaf(leaf);
    }
  }

  async activateCharacterMapView(): Promise<void> {
    this.app.workspace.detachLeavesOfType(CHARACTER_MAP_VIEW_TYPE);

    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: CHARACTER_MAP_VIEW_TYPE,
      active: true
    });

    void this.app.workspace.revealLeaf(leaf);
  }

  async activateExportView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(EXPORT_VIEW_TYPE);
    if (existing.length > 0) {
      void this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: EXPORT_VIEW_TYPE,
      active: true
    });

    void this.app.workspace.revealLeaf(leaf);
  }

  async activatePlotBoardView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(PLOT_BOARD_VIEW_TYPE);
    if (existing.length > 0) {
      void this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: PLOT_BOARD_VIEW_TYPE,
      active: true
    });

    void this.app.workspace.revealLeaf(leaf);
  }

  // ==========================================
  // LOGIC & UTILITIES
  // ==========================================

  async initializeProjectStructure(): Promise<void> {
    const root = this.settings.projectPath;
    if (!root) {
      new Notice('Please set a project path in settings first.');
      return;
    }

    const folders = [
      root,
      `${root}/${this.settings.characterFolder}`,
      `${root}/${this.settings.locationFolder}`,
      `${root}/${this.settings.chapterFolder}`,
      `${root}/${this.settings.imageFolder}`,
      `${root}/Templates`
    ];

    for (const folder of folders) {
      if (!this.app.vault.getAbstractFileByPath(folder)) {
        await this.app.vault.createFolder(folder);
      }
    }

    await this.createTemplateFiles();
    new Notice('Novel project structure initialized.');
  }

  async createTemplateFiles(): Promise<void> {
    const root = this.settings.projectPath;
    const templatePath = `${root}/Templates`;

    const templates = [
      {
        name: 'Character Template.md',
        content: `# Name Surname

## General Information
- **Role**: Side
- **Gender**: 
- **Age**: 
- **Relationship**: 

## Appearance
(Describe how the character looks)

## Personality
(Describe traits and behavior)

## Relationships
(List connections to other characters)

## Images
- **Main**: `
      },
      {
        name: 'Location Template.md',
        content: `# Location Name

## General Information
- **Type**: 
- **Importance**: 

## Description
(General overview of the place)

## History
(Background and events)

## Images
- **Main**: `
      },
      {
        name: 'Chapter Template.md',
        content: `---
      guid: 
      order: 1
    ---

    # Chapter Name

    (Write your story here)
    `
      }
    ];

    for (const t of templates) {
      const path = `${templatePath}/${t.name}`;
      if (!this.app.vault.getAbstractFileByPath(path)) {
        await this.app.vault.create(path, t.content);
      }
    }
  }

  async createCharacter(name: string, surname: string): Promise<void> {
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.characterFolder}`;
    const fileName = `${name} ${surname}`.trim();
    const path = `${folder}/${fileName}.md`;

    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice('Character already exists.');
      return;
    }

    const content = [
      `# ${fileName}`,
      '',
      '## CharacterSheet',
      `Name: ${name}`,
      `Surname: ${surname}`,
      'Gender: ',
      'Age: ',
      'Role: ',
      'FaceShot: ',
      '',
      'Relationships:',
      '',
      'Images:',
      '',
      'CustomProperties:',
      '',
      'Sections:',
      '',
      'ChapterOverrides:'
    ].join('\n');

    await this.app.vault.create(path, content);
    new Notice(`Character ${fileName} created.`);
  }

  async createLocation(name: string, description: string): Promise<void> {
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.locationFolder}`;
    const path = `${folder}/${name}.md`;

    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice('Location already exists.');
      return;
    }

    const content = `# ${name}

## Description
${description}

## History

## Images
- **Main**: 
`;

    await this.app.vault.create(path, content);
    new Notice(`Location ${name} created.`);
  }

  async createChapter(name: string, order: string): Promise<void> {
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.chapterFolder}`;
    const path = `${folder}/${name}.md`;

    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice('Chapter already exists.');
      return;
    }

    const chapters = await this.getChapterDescriptions();
    const maxOrder = chapters.reduce((max, chapter) => Math.max(max, chapter.order || 0), 0);
    const requestedOrder = Number(order.trim());
    const orderValue = Number.isFinite(requestedOrder) && requestedOrder > 0
      ? requestedOrder
      : Math.max(1, maxOrder + 1);
    const guid = this.generateGuid();
    const content = `---
guid: ${guid}
order: ${orderValue}
---

# ${name}

(Write your story here)
`;

    await this.app.vault.create(path, content);
    new Notice(`Chapter ${name} created.`);
  }

  openCharacterModal(): void {
    new CharacterModal(this.app, this).open();
  }

  openLocationModal(): void {
    new LocationModal(this.app, this).open();
  }

  openChapterDescriptionModal(): void {
    new ChapterDescriptionModal(this.app, this).open();
  }

  async parseCharacterFile(file: TFile): Promise<CharacterData> {
    const content = await this.app.vault.read(file);
    const { frontmatter, body } = this.extractFrontmatterAndBody(content);
    
    // Try to get data from new CharacterSheet format first
    const sheetData = this.parseCharacterSheetForSidebar(content);
    
    // Parse Chapter notes from Character files
    const chapterInfos: CharacterChapterInfo[] = [];
    
    const lines = body.split('\n');
    let currentChapter: { chapter: string; start: number } | null = null;
    
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^## Chapter:\s*(.*)$/);
        if (m) {
            if (currentChapter) {
                const infoLines = lines.slice(currentChapter.start, i);
                const { overrides, info } = this.parseChapterOverrides(infoLines.join('\n'));
                chapterInfos.push({ chapter: currentChapter.chapter, info, overrides });
            }
            currentChapter = { chapter: m[1].trim(), start: i + 1 };
        } else if (lines[i].startsWith('## ') && currentChapter) {
            const infoLines = lines.slice(currentChapter.start, i);
            const { overrides, info } = this.parseChapterOverrides(infoLines.join('\n'));
            chapterInfos.push({ chapter: currentChapter.chapter, info, overrides });
            currentChapter = null;
        }
    }
    
    if (currentChapter) {
        const infoLines = lines.slice(currentChapter.start);
        const { overrides, info } = this.parseChapterOverrides(infoLines.join('\n'));
        chapterInfos.push({ chapter: currentChapter.chapter, info, overrides });
    }

    // Use CharacterSheet data if available, otherwise fall back to legacy parsing
    if (sheetData) {
      // Also get chapter overrides from CharacterSheet format
      const sheetChapterOverrides = this.parseCharacterSheetChapterOverrides(content);
      
      // Merge with legacy chapter infos (sheet overrides take precedence)
      const mergedChapterInfos = [...chapterInfos];
      for (const sheetOverride of sheetChapterOverrides) {
        const existingIdx = mergedChapterInfos.findIndex(ci => ci.chapter === sheetOverride.chapter);
        if (existingIdx >= 0) {
          mergedChapterInfos[existingIdx] = {
            ...mergedChapterInfos[existingIdx],
            overrides: { ...mergedChapterInfos[existingIdx].overrides, ...sheetOverride.overrides },
            customProperties: sheetOverride.customProperties
          };
        } else {
          mergedChapterInfos.push(sheetOverride);
        }
      }
      
      return {
        name: sheetData.name || file.basename.split(' ')[0],
        surname: sheetData.surname || file.basename.split(' ').slice(1).join(' '),
        role: sheetData.role,
        gender: sheetData.gender,
        age: sheetData.age,
        relationship: '', // No longer used in new format
        customProperties: sheetData.customProperties,
        chapterInfos: mergedChapterInfos
      };
    }

    return {
      name: file.basename.split(' ')[0],
      surname: file.basename.split(' ').slice(1).join(' '),
      role: this.detectCharacterRole(content, frontmatter),
      gender: frontmatter.gender || '',
      age: frontmatter.age || '',
      relationship: frontmatter.relationship || '',
      customProperties: {},
      chapterInfos
    };
  }

  parseCharacterSheetForSidebar(content: string): { name: string; surname: string; gender: string; age: string; role: string; customProperties: Record<string, string> } | null {
    const sheetLines = this.getSectionLines(content, 'CharacterSheet');
    if (sheetLines.length === 0) return null;
    
    const sheetContent = sheetLines.join('\n');
    
    const parseField = (fieldName: string): string => {
      const pattern = new RegExp(`^\\s*${fieldName}:\\s*(.*?)$`, 'm');
      const match = sheetContent.match(pattern);
      if (!match) return '';
      const value = match[1].trim();
      // Check for corrupted data
      // Images: is a section, not a field.
      const knownFields = ['Name:', 'Surname:', 'Gender:', 'Age:', 'Role:', 'FaceShot:', 'Relationships:', 'Images:', 'CustomProperties:', 'Sections:', 'ChapterOverrides:'];
      for (const field of knownFields) {
        if (value.includes(field)) return '';
      }
      return value;
    };

    const customProperties: Record<string, string> = {};
    const customPropsMatch = sheetContent.match(/\nCustomProperties:\n/);
    if (customPropsMatch && customPropsMatch.index !== undefined) {
      const startIdx = customPropsMatch.index + customPropsMatch[0].length;
      let endIdx = sheetContent.length;
      const nextSections = ['Sections:', 'ChapterOverrides:'];
      for (const nextSec of nextSections) {
        const nextMatch = sheetContent.indexOf('\n' + nextSec, startIdx);
        if (nextMatch !== -1 && nextMatch < endIdx) {
          endIdx = nextMatch;
        }
      }
      const propsContent = sheetContent.substring(startIdx, endIdx).trim();
      const lines = propsContent.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^[-*]\s*(.+?)\s*:\s*(.+)$/);
        if (match) {
          customProperties[match[1].trim()] = match[2].trim();
        }
      }
    }
    
    return {
      name: parseField('Name'),
      surname: parseField('Surname'),
      gender: parseField('Gender'),
      age: parseField('Age'),
      role: parseField('Role'),
      customProperties
    };
  }

  parseCharacterSheetChapterOverrides(content: string): Array<{ chapter: string; overrides: Record<string, string>; info: string; customProperties?: Record<string, string> }> {
    const sheetLines = this.getSectionLines(content, 'CharacterSheet');
    if (sheetLines.length === 0) return [];
    
    const sheetContent = sheetLines.join('\n');
    const chapterOverridesIdx = sheetContent.indexOf('\nChapterOverrides:');
    if (chapterOverridesIdx === -1) return [];
    
    const chapterText = sheetContent.substring(chapterOverridesIdx + '\nChapterOverrides:'.length);
    const results: Array<{ chapter: string; overrides: Record<string, string>; info: string; customProperties?: Record<string, string> }> = [];
    
    // Split by "Chapter: " to get individual chapter blocks
    const chapterBlocks = chapterText.split(/\nChapter:\s*/).filter(Boolean);
    
    for (const block of chapterBlocks) {
      const lines = block.split('\n');
      const chapter = lines[0].trim();
      const overrides: Record<string, string> = {};
      const customProperties: Record<string, string> = {};
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Check for simple property lines: - Property: value
        const simpleMatch = line.match(/^[-*]\s*(.+?)\s*:\s*(.*)$/);
        if (simpleMatch) {
          const key = simpleMatch[1].trim().toLowerCase();
          const value = simpleMatch[2].trim();
          
          // Skip nested list items (they have more indentation or are section headers)
          if (key === 'images' || key === 'relationships') {
            // These are sections with nested items, skip for now
            for (let j = i + 1; j < lines.length; j++) {
              if (j >= lines.length) break;
              const nextLine = lines[j];
              // Check for indentation
              if (!nextLine.match(/^\s+[-*]/)) {
                i = j - 1;
                break;
              }
              i = j;
            }
            continue;
          }
          
          if (key === 'customproperties') {
             // Parse custom properties
             for (let j = i + 1; j < lines.length; j++) {
                 if (j >= lines.length) break;
                 const nextLine = lines[j];
                 // Check for "  - Key: Value"
                 const cpMatch = nextLine.match(/^\s+[-*]\s*(.+?)\s*:\s*(.+)$/);
                 if (cpMatch) {
                     customProperties[cpMatch[1].trim()] = cpMatch[2].trim();
                     i = j;
                 } else if (!nextLine.match(/^\s+/)) {
                     // End of indented block
                     i = j - 1;
                     break;
                 } else {
                     // Empty line or something else, consume
                     i = j;
                 }
             }
             continue;
          }
          
          overrides[key] = value;
        }
      }
      

      if (chapter) {
        results.push({ chapter, overrides, info: '', customProperties });
      }
    }
    
    return results;
  }

  parseCharacterSheetChapterImages(
    content: string,
    chapterId: string,
    chapterName?: string
  ): Array<{ name: string; path: string }> | null {
    const sheetLines = this.getSectionLines(content, 'CharacterSheet');
    if (sheetLines.length === 0) return null;
    
    const sheetContent = sheetLines.join('\n');
    const chapterOverridesIdx = sheetContent.indexOf('\nChapterOverrides:');
    if (chapterOverridesIdx === -1) return null;
    
    const chapterText = sheetContent.substring(chapterOverridesIdx + '\nChapterOverrides:'.length);
    
    // Find the specific chapter block
    const chapterPattern = new RegExp(`\\nChapter:\\s*${this.escapeRegex(chapterId)}\\n`, 'i');
    let chapterMatch = chapterText.match(chapterPattern);
    if ((!chapterMatch || chapterMatch.index === undefined) && chapterName) {
      const fallbackPattern = new RegExp(`\\nChapter:\\s*${this.escapeRegex(chapterName)}\\n`, 'i');
      chapterMatch = chapterText.match(fallbackPattern);
    }
    if (!chapterMatch || chapterMatch.index === undefined) return null;
    
    const startIdx = chapterMatch.index + chapterMatch[0].length;
    let endIdx = chapterText.length;
    const nextChapterMatch = chapterText.substring(startIdx).match(/\nChapter:\s*/);
    if (nextChapterMatch && nextChapterMatch.index !== undefined) {
      endIdx = startIdx + nextChapterMatch.index;
    }
    
    const chapterBlock = chapterText.substring(startIdx, endIdx);
    
    // Find Images section within this chapter block
    const imagesMatch = chapterBlock.match(/\n\s*[-*]\s*Images:\s*\n/);
    if (!imagesMatch || imagesMatch.index === undefined) return null;
    
    const imagesStartIdx = imagesMatch.index + imagesMatch[0].length;
    const imagesLines = chapterBlock.substring(imagesStartIdx).split('\n');
    const images: Array<{ name: string; path: string }> = [];
    
    for (const line of imagesLines) {
      // Stop when we hit a non-indented line (end of images section)
      if (!line.match(/^\s+[-*]/)) break;
      
      const imgMatch = line.match(/^\s+[-*]\s*(.+?)\s*:\s*(.+)$/);
      if (imgMatch) {
        images.push({
          name: imgMatch[1].trim(),
          path: imgMatch[2].trim()
        });
      }
    }
    
    return images.length > 0 ? images : null;
  }

  async parseLocationFile(file: TFile): Promise<LocationData> {
    const content = await this.app.vault.read(file);
    const body = this.stripFrontmatter(content);
    const descSection = this.getSectionLines(body, 'Description').join('\n');

    return {
      name: file.basename,
      description: descSection
    };
  }

  parseImagesSection(content: string): Array<{ name: string; path: string }> {
    const lines = this.getSectionLines(content, 'Images');
    const images: Array<{ name: string; path: string }> = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      // Support **Key** (optional colon) OR Key: (mandatory colon)
      const match = line.match(/^[-*]\s*(?:(?:\*\*(.+?)\*\*[:]?)|([^:]+[:]))\s*(.*)$/);
      if (match) {
        let name = match[1] || match[2];
        if (name.endsWith(':')) name = name.substring(0, name.length - 1);
        images.push({ name: name.trim(), path: match[3].trim() });
      }
    }

    return images;
  }

  parseCharacterSheetImages(content: string): Array<{ name: string; path: string }> {
    const sheetLines = this.getSectionLines(content, 'CharacterSheet');
    if (sheetLines.length === 0) return [];
    
    const sheetContent = sheetLines.join('\n');
    const imagesSectionMatch = sheetContent.match(/\nImages:\n/);
    if (!imagesSectionMatch || imagesSectionMatch.index === undefined) return [];
    
    const startIdx = imagesSectionMatch.index + imagesSectionMatch[0].length;
    let endIdx = sheetContent.length;
    const nextSections = ['CustomProperties:', 'Sections:', 'ChapterOverrides:'];
    for (const nextSec of nextSections) {
      const nextMatch = sheetContent.indexOf('\n' + nextSec, startIdx);
      if (nextMatch !== -1 && nextMatch < endIdx) {
        endIdx = nextMatch;
      }
    }
    
    const imagesContent = sheetContent.substring(startIdx, endIdx).trim();
    const images: Array<{ name: string; path: string }> = [];
    const lines = imagesContent.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^[-*]\s*(.+?)\s*:\s*(.+)$/);
      if (match) {
        images.push({ name: match[1].trim(), path: match[2].trim() });
      }
    }
    
    return images;
  }

  parseCharacterText(content: string): Record<string, string> {
    const lines = content.split('\n');
    const data: Record<string, string> = {};

    for (const line of lines) {
      const match = line.match(/^[-*]\s*\*\*(.+?)\*\*[:]?\s*(.*)$/);
      if (match) {
        data[match[1].toLowerCase()] = match[2].trim();
      }
    }

    return data;
  }

  getSectionLines(content: string, heading: string): string[] {
    const lines = content.split('\n');
    const startIdx = lines.findIndex((l) => l.trim().startsWith(`## ${heading}`));
    if (startIdx === -1) return [];

    const sectionLines: string[] = [];
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i].trim().startsWith('## ')) break;
      sectionLines.push(lines[i]);
    }

    return sectionLines;
  }

  parseChapterOverrides(content: string): { overrides: Record<string, string>; info: string } {
    const lines = content.split('\n');
    const overrides: Record<string, string> = {};
    const infoLines: string[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      // Support **Key** (optional colon) OR Key: (mandatory colon)
      const match = line.match(/^[-*]?\s*(?:(?:\*\*(.+?)\*\*[:]?)|([^:]+[:]))\s*(.*)$/);
      if (match) {
        let key = match[1] || match[2];
        if (key.endsWith(':')) key = key.substring(0, key.length - 1);
        overrides[key.trim().toLowerCase().replace(/\s+/g, '_')] = match[3].trim();
      } else {
        infoLines.push(line);
      }
    }

    return { overrides, info: infoLines.join('\n').trim() };
  }

  resolveImagePath(imagePath: string, sourcePath: string): TFile | null {
    if (!imagePath) return null;
    
    let cleanPath = imagePath.trim();

    // Handle WikiLinks: ![[path]] or [[path]]
    if (cleanPath.startsWith('![[') || cleanPath.startsWith('[[')) {
      cleanPath = cleanPath.replace(/^!?\[{2}/, '').replace(/\]{2}$/, '');
      // Handle alias: path|alias
      if (cleanPath.includes('|')) {
        cleanPath = cleanPath.split('|')[0];
      }
    } 
    // Handle Markdown links: ![alt](path)
    else {
        const mdMatch = cleanPath.match(/^!\[.*?\]\((.*?)\)/);
        if (mdMatch) {
            cleanPath = mdMatch[1];
        }
    }

    const file = this.app.metadataCache.getFirstLinkpathDest(cleanPath, sourcePath);
    return file instanceof TFile ? file : null;
  }

  async syncAllCharactersChapterInfos(): Promise<void> {
    const chars = await this.getCharacterList();
    for (const char of chars) {
      await this.ensureCharacterChapterInfos(char.file);
    }
  }

  async syncCharacterChapterInfos(file: TFile): Promise<void> {
    await this.ensureCharacterChapterInfos(file);
  }

  async migrateCharacterRoles(): Promise<void> {
    const chars = await this.getCharacterList();
    for (const char of chars) {
        const content = await this.app.vault.read(char.file);
        const { frontmatter, body } = this.extractFrontmatterAndBody(content);
        if (frontmatter.role) {
            const nextBody = this.ensureCharacterRoleLine(body);
            if (nextBody !== body) {
                await this.app.vault.modify(char.file, this.extractFrontmatter(content) + nextBody);
            }
        }
    }
  }

  ensureCharacterRoleLine(content: string): string {
    const lines = content.split('\n');
    const genInfoIdx = lines.findIndex(l => l.trim() === '## General Information');
    if (genInfoIdx === -1) return content;
    
    // Check if role line exists
    let roleIdx = -1;
    for (let i = genInfoIdx + 1; i < lines.length; i++) {
        if (lines[i].startsWith('## ')) break;
        if (lines[i].match(/^[-*]\s*\*\*(?:Character\s+)?Role(?:\s*:)?\*\*/i)) {
            roleIdx = i;
            break;
        }
    }

    if (roleIdx === -1) {
        lines.splice(genInfoIdx + 1, 0, '- **Role**: Side');
        return lines.join('\n');
    }
    return content;
  }

  async ensureCharacterChapterInfos(charFile: TFile): Promise<void> {
    const descs = await this.getChapterDescriptions();
    const content = await this.app.vault.read(charFile);
    let body = this.stripFrontmatter(content);
    let changed = false;

    for (const desc of descs) {
      const chapterKey = desc.id;
      const chapterSectionHeader = `## Chapter: ${chapterKey}`;
      
      if (!body.includes(chapterSectionHeader)) {
        const newSection = [
          '',
          chapterSectionHeader,
          '- **Age**: ',
          '- **Relationship**: ',
          '- **Further info**: ',
          ''
        ].join('\n');
        
        body += newSection;
        changed = true;
      }
    }

    if (changed) {
      const frontmatter = this.extractFrontmatter(content);
      await this.app.vault.modify(charFile, frontmatter + body);
    }
  }

  async getChapterDescriptions(): Promise<Array<{ id: string; name: string; order: number; file: TFile }>> {
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.chapterFolder}/`;
    const files = this.app.vault.getFiles().filter((f) => f.path.startsWith(folder) && f.extension === 'md');

    const chapters: Array<{ id: string; name: string; order: number; file: TFile }> = [];
    for (const file of files) {
      const content = await this.app.vault.read(file);
      const { frontmatter, body } = this.extractFrontmatterAndBody(content);
      const guid = typeof frontmatter.guid === 'string' && frontmatter.guid.trim()
        ? frontmatter.guid.trim()
        : file.basename;
      const title = this.extractTitle(body) || file.basename;
      chapters.push({
        id: guid,
        name: title,
        order: Number(frontmatter.order) || 999,
        file
      });
    }

    return chapters.sort((a, b) => {
      const orderDiff = a.order - b.order;
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name);
    });
  }

  getChapterList(): ChapterListData[] {
    const chapters = this.getChapterDescriptionsSync();
    return chapters.map((chapter) => ({
      name: chapter.name,
      order: chapter.order,
      file: chapter.file
    }));
  }

  getChapterDescriptionsSync(): Array<{ id: string; name: string; order: number; file: TFile }> {
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.chapterFolder}/`;
    const files = this.app.vault.getFiles().filter((f) => f.path.startsWith(folder) && f.extension === 'md');

    const chapters: Array<{ id: string; name: string; order: number; file: TFile }> = [];
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter || {};
      const heading = cache?.headings?.find(h => h.level === 1)?.heading;
      chapters.push({
        id: typeof frontmatter.guid === 'string' && frontmatter.guid.trim() ? frontmatter.guid.trim() : file.basename,
        name: heading || file.basename,
        order: Number(frontmatter.order) || 999,
        file
      });
    }

    return chapters.sort((a, b) => {
      const orderDiff = a.order - b.order;
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name);
    });
  }

  async updateChapterOrder(chapterFiles: TFile[]): Promise<void> {
    for (let i = 0; i < chapterFiles.length; i++) {
      const file = chapterFiles[i];
      const content = await this.app.vault.read(file);
      const { frontmatter, body } = this.extractFrontmatterAndBody(content);
      
      frontmatter.order = (i + 1).toString();
      
      const nextFrontmatter = this.serializeFrontmatter(frontmatter);
      await this.app.vault.modify(file, nextFrontmatter + body);
    }
  }

  detectCharacterRole(content: string, frontmatter: Record<string, string>): string {
      let role = frontmatter.role;
      if (!role) {
         const sheetLines = this.getSectionLines(content, 'CharacterSheet');
         if (sheetLines.length > 0) {
           const sheetContent = sheetLines.join('\n');
           const match = sheetContent.match(/^\s*Role:\s*(.*?)$/m);
           if (match) role = match[1].trim();
         }
      }
      if (!role) return '';
      return normalizeCharacterRole(role);
  }

  async getCharacterList(): Promise<CharacterListData[]> {
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.characterFolder}/`;
    const files = this.app.vault.getFiles().filter((f) => f.path.startsWith(folder) && f.extension === 'md');

    const chars: CharacterListData[] = [];
    for (const file of files) {
      const content = await this.app.vault.read(file);
      const { frontmatter } = this.extractFrontmatterAndBody(content);

      const sheetData = this.parseCharacterSheetForSidebar(content);
      const role = sheetData?.role || this.detectCharacterRole(content, frontmatter);
      const gender = sheetData?.gender || frontmatter.gender || '';

      chars.push({
        name: file.basename,
        file,
        role,
        gender
      });
    }

    return chars.sort((a, b) => a.name.localeCompare(b.name));
  }

  async updateCharacterRole(file: TFile, roleLabel: string): Promise<void> {
    const content = await this.app.vault.read(file);
    let { frontmatter, body } = this.extractFrontmatterAndBody(content);
    const hasFrontmatter = Object.keys(frontmatter).length > 0;
    const trimmedRole = roleLabel.trim();
    
    // Update frontmatter only if it existed or if we want to enforce it (but we don't anymore)
    if (frontmatter.role) {
        frontmatter.role = trimmedRole;
    }

    const lines = body.split('\n');
    const sheetHeaderIdx = lines.findIndex((l) => l.trim() === '## CharacterSheet');

    if (sheetHeaderIdx !== -1) {
      let sheetEndIdx = lines.length;
      for (let i = sheetHeaderIdx + 1; i < lines.length; i++) {
        if (lines[i].trim().startsWith('## ')) {
          sheetEndIdx = i;
          break;
        }
      }

      let roleLineIdx = -1;
      for (let i = sheetHeaderIdx + 1; i < sheetEndIdx; i++) {
        if (/^\s*Role\s*:/i.test(lines[i])) {
          roleLineIdx = i;
          break;
        }
      }

      const roleLine = trimmedRole ? `Role: ${trimmedRole}` : 'Role:';

      if (roleLineIdx !== -1) {
        lines[roleLineIdx] = roleLine;
      } else {
        let insertIdx = sheetHeaderIdx + 1;
        for (let i = sheetHeaderIdx + 1; i < sheetEndIdx; i++) {
          const trimmed = lines[i].trim().toLowerCase();
          if (
            trimmed.startsWith('name:') ||
            trimmed.startsWith('surname:') ||
            trimmed.startsWith('gender:') ||
            trimmed.startsWith('age:')
          ) {
            insertIdx = i + 1;
          }
        }
        lines.splice(insertIdx, 0, roleLine);
      }
    } else {
      // Update legacy "General Information" section in body
      const roleIdx = lines.findIndex(l => l.match(/^[-*]\s*\*\*(?:Character\s+)?Role(?:\s*:)?\*\*/i));
      if (roleIdx !== -1) {
        lines[roleIdx] = `- **Role**: ${trimmedRole}`;
      }
    }

    let newContent = lines.join('\n');

    if (hasFrontmatter) {
        const nextFrontmatter = this.serializeFrontmatter(frontmatter);
        newContent = nextFrontmatter + newContent;
    }

    await this.app.vault.modify(file, newContent);
    
    new Notice(`Updated ${file.basename} role to ${trimmedRole || 'Unassigned'}`);
  }

  serializeFrontmatter(fm: Record<string, string | number>): string {
      const entries = Object.entries(fm).map(([k, v]) => `${k}: ${v}`);
      return `---\n${entries.join('\n')}\n---\n`;
  }

  generateGuid(): string {
    const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (cryptoObj && 'randomUUID' in cryptoObj) {
      return cryptoObj.randomUUID();
    }

    const bytes = new Uint8Array(16);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }

  ensureChapterGuid(
    frontmatter: Record<string, string>,
    _body: string,
    _file: TFile
  ): { guid: string; updated: boolean } {
    const existing = frontmatter.guid;
    if (typeof existing === 'string' && existing.trim()) {
      return { guid: existing.trim(), updated: false };
    }

    const guid = this.generateGuid();
    frontmatter.guid = guid;
    return { guid, updated: true };
  }

  getLocationList(): LocationListData[] {
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.locationFolder}/`;
    const files = this.app.vault.getFiles().filter((f) => f.path.startsWith(folder) && f.extension === 'md');

    return files.map((file) => ({
      name: file.basename,
      file
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  getChapterNameForFileSync(file: TFile): string {
    const cache = this.app.metadataCache.getFileCache(file);
    const heading = cache?.headings?.find(h => h.level === 1)?.heading;
    return heading || file.basename;
  }

  getChapterNameForFile(file: TFile): string {
    return this.getChapterNameForFileSync(file);
  }

  getChapterIdForFileSync(file: TFile): string {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
    const guid = typeof frontmatter?.guid === 'string' ? frontmatter.guid.trim() : '';
    return guid ? guid : file.basename;
  }

  getChapterIdForFile(file: TFile): string {
    return this.getChapterIdForFileSync(file);
  }

  async parseChapterFile(file: TFile): Promise<{ characters: string[]; locations: string[] }> {
    const content = await this.app.vault.read(file);
    const body = this.stripFrontmatter(content);
    
    const mentions = this.scanMentions(body);

    return {
      characters: mentions.characters,
      locations: mentions.locations
    };
  }

  scanMentions(content: string): { characters: string[]; locations: string[] } {
    const characters: Set<string> = new Set();
    const locations: Set<string> = new Set();
    // contentLower removed as we use regex 'i' flag

    for (const [name, info] of this.entityIndex.entries()) {
      const nameParts = name.split(' ');
      // Check full name or first name
      const variations = [name];
      if (nameParts.length > 1) {
          variations.push(nameParts[0]);
      }
      
      let found = false;
      for (const v of variations) {
          if (v.length < 2) continue;
          // Simple case-insensitive check
          // Note: This matches "Amy" in "Tammy" potentially. 
          // For better accuracy we would use regex boundaries, but for now strict includes on lowercase is a good step up.
          // Using boundaries:
          const regex = new RegExp(`\\b${this.escapeRegex(v)}\\b`, 'i');
          if (regex.test(content)) {
              found = true;
              break;
          }
      }

      if (found) {
        if (info.path.includes(this.settings.characterFolder)) characters.add(name);
        if (info.path.includes(this.settings.locationFolder)) locations.add(name);
      }
    }

    return { characters: Array.from(characters), locations: Array.from(locations) };
  }

  parseFrontmatter(content: string): Record<string, string> {
    const normalized = content.replace(/\r\n/g, '\n');
    const match = normalized.match(/^---\n([\s\S]+?)\n---/);
    if (!match) return {};

    const fm: Record<string, string> = {};
    const lines = match[1].split('\n');
    for (const line of lines) {
      const parts = line.split(':');
      if (parts.length >= 2) {
        fm[parts[0].trim()] = parts.slice(1).join(':').trim();
      }
    }
    return fm;
  }

  getFrontmatterText(value: string | string[]): string {
    if (Array.isArray(value)) return value.join(', ');
    return String(value || '');
  }

  findCharacterFile(name: string): TFile | null {
    let cleanName = name.replace(/^\[{2}/, '').replace(/\]{2}$/, '');
    cleanName = cleanName.split('|')[0].trim();
    
    // First try the entity index to support subfolders or varied paths
    const info = this.entityIndex.get(cleanName);
    if (info && info.path.includes(this.settings.characterFolder)) {
        const file = this.app.vault.getAbstractFileByPath(info.path);
        if (file instanceof TFile) return file;
    }

    // Fallback for non-indexed files (e.g. newly created)
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.characterFolder}`;
    const path = `${folder}/${cleanName}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  findLocationFile(name: string): TFile | null {
    let cleanName = name.replace(/^\[{2}/, '').replace(/\]{2}$/, '').split('|')[0].trim();
    
    // First try the entity index
    const info = this.entityIndex.get(cleanName);
    if (info && info.path.includes(this.settings.locationFolder)) {
        const file = this.app.vault.getAbstractFileByPath(info.path);
        if (file instanceof TFile) return file;
    }

    // Fallback
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.locationFolder}`;
    const path = `${folder}/${cleanName}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  handleBoldFieldFormatting(): void {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) return;

    const editor = activeView.editor;
    const cursor = editor.getCursor();
    const lineText = editor.getLine(cursor.line);

    // Only proceed if cursor is reasonably placed and last char is :
    if (cursor.ch < 1 || lineText.charAt(cursor.ch - 1) !== ':') return;

    // Regex to match: whitespace(optional) + bullet + whitespace + Key + :
    // Captured groups: 1 = bullet+space prefix, 2 = key text
    // Excludes keys that already contain asterisks
    const regex = /^(\s*[-*+]\s+)([^*]+):$/;
    
    // We match against text up to cursor, which should be the whole line if user just typed : at end
    const textBeforeCursor = lineText.substring(0, cursor.ch);
    const match = textBeforeCursor.match(regex);
    
    if (match) {
        const prefix = match[1];
        const key = match[2];

        // Replacement range: from end of bullet prefix to cursor
        // e.g. "- Key:" -> replace "Key:" with "**Key:**"
        // Cursor is after :
        // Start ch = length of prefix
        // End ch = cursor.ch
        
        const start = { line: cursor.line, ch: prefix.length };
        const end = { line: cursor.line, ch: cursor.ch };
        
        editor.replaceRange(`**${key}:**`, start, end);
    }
  }

  handleAutoReplacement(): void {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) return;

    const editor = activeView.editor;
    const cursor = editor.getCursor();
    const lineText = editor.getLine(cursor.line);

    if (this.isCursorInFrontmatter(editor)) return;

    for (const pair of this.settings.autoReplacements) {
      // Handle auto-inserted quote pairs (e.g., Obsidian inserts '' with cursor in middle)
      if (pair.start === pair.end && pair.endReplace && pair.startReplace !== pair.endReplace) {
        // Check if we have an auto-inserted pair: 'x' or just '' with cursor in middle
        const beforeCursor = lineText.substring(0, cursor.ch);
        const afterCursor = lineText.substring(cursor.ch);
        
        // Pattern: line ends with start token, and next char is also the end token
        // This detects when Obsidian auto-inserted '' and cursor is between them
        if (beforeCursor.endsWith(pair.start) && afterCursor.startsWith(pair.end)) {
          // Replace the opening quote (before cursor)
          this.applyAutoReplacement(cursor.ch, pair.start, pair.startReplace);
          // Delete the closing quote (after cursor) - need to adjust position
          this.applyAutoReplacement(cursor.ch + pair.startReplace.length, pair.end, '');
          return;
        }
        
        // Check if we're typing the closing quote (at end of line with content between)
        if (this.endsWithToken(lineText, cursor.ch, pair.end)) {
          this.applyAutoReplacement(cursor.ch, pair.end, pair.endReplace);
          return;
        }
      }
      
      // Check if cursor is at end of the start token
      if (this.endsWithToken(lineText, cursor.ch, pair.start)) {
        this.applyAutoReplacement(cursor.ch, pair.start, pair.startReplace);
        return;
      }
    }
  }

  applyAutoReplacement(cursorCh: number, token: string, replacement: string): void {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) return;
    const editor = activeView.editor;

    const start = { line: editor.getCursor().line, ch: cursorCh - token.length };
    const end = { line: editor.getCursor().line, ch: cursorCh };

    editor.replaceRange(replacement, start, end);
  }

  endsWithToken(line: string, cursorCh: number, token: string): boolean {
    if (!token) return false;
    const part = line.substring(0, cursorCh);
    return part.endsWith(token);
  }

  replaceAtCursor(cursorCh: number, token: string, replacement: string): void {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) return;
    const editor = activeView.editor;

    const start = { line: editor.getCursor().line, ch: cursorCh - token.length };
    const end = { line: editor.getCursor().line, ch: cursorCh };

    editor.replaceRange(replacement, start, end);
  }

  countOccurrences(text: string, search: string): number {
    if (!search) return 0;
    let count = 0;
    let pos = text.indexOf(search);
    while (pos !== -1) {
      count++;
      pos = text.indexOf(search, pos + search.length);
    }
    return count;
  }

  isCursorInFrontmatter(editor: Editor): boolean {
    const cursor = editor.getCursor();
    const content = editor.getValue();
    const match = content.match(/^---\n[\s\S]*?\n---/);
    if (!match) return false;

    const fmLines = match[0].split('\n').length;
    return cursor.line < fmLines;
  }

  // ==========================================
  // INDEXING & SEARCH
  // ==========================================

  async refreshEntityIndex(): Promise<void> {
    this.entityIndex.clear();
    this.knownRelationshipKeys.clear();

    const root = this.settings.projectPath;
    if (!root) return;

    const charFolder = `${root}/${this.settings.characterFolder}`;
    const locFolder = `${root}/${this.settings.locationFolder}`;

    const files = this.app.vault.getFiles();
    
    for (const file of files) {
        const isChar = file.path.startsWith(charFolder);
        const isLoc = file.path.startsWith(locFolder);

        if (isChar || isLoc) {
            this.entityIndex.set(file.basename, {
                path: file.path,
                display: file.basename
            });

            if (isChar) {
                const content = await this.app.vault.read(file);
                const relationshipLines = this.getSectionLines(content, 'Relationships');
                for (const line of relationshipLines) {
                    const match = line.match(/^(\s*[-*]\s*\*\*(.+?)\*\*([:]?)\s*)/);
                    if (match) {
                        let key = match[2].trim();
                        if (key.endsWith(':')) key = key.slice(0, -1).trim();
                        this.knownRelationshipKeys.add(key);
                    }
                }
            }
        }
    }

    const names = Array.from(this.entityIndex.keys());
    this.entityRegex = this.buildEntityRegex(names);
  }

  buildEntityRegex(names: string[]): RegExp | null {
    if (names.length === 0) return null;
    const escapedNames = names
      .sort((a, b) => b.length - a.length)
      .map((n) => this.escapeRegex(n))
      .join('|');
    return new RegExp(`\\b(${escapedNames})\\b`, 'g');
  }

  escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  isWordChar(ch: string): boolean {
    return /\w/.test(ch);
  }

  getWordAtCursor(editor: Editor): string {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    let start = cursor.ch;
    let end = cursor.ch;

    while (start > 0 && this.isWordChar(line[start - 1])) start--;
    while (end < line.length && this.isWordChar(line[end])) end++;

    return line.substring(start, end);
  }

  getEntityAtCursor(editor: Editor): { path: string; display: string } | null {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    return this.findEntityAtPosition(line, cursor.ch);
  }

  getWordAtCoords(editor: EditorWithCodeMirror, x: number, y: number): string | null {
    const pos = this.getPosAtCoords(editor, x, y);
    if (!pos) return null;

    const line = editor.getLine(pos.line);
    let start = pos.ch;
    let end = pos.ch;

    while (start > 0 && this.isWordChar(line[start - 1])) start--;
    while (end < line.length && this.isWordChar(line[end])) end++;

    return line.substring(start, end);
  }

  getWordAtPoint(x: number, y: number): string {
    const caretPositionFromPoint = (document as unknown as {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    }).caretPositionFromPoint;
    const caretPosition = caretPositionFromPoint?.(x, y);
    if (!caretPosition) return '';

    const textNode = caretPosition.offsetNode;
    const offset = caretPosition.offset;
    
    if (textNode.nodeType !== Node.TEXT_NODE) return '';
    
    const text = textNode.textContent || '';
    let start = offset;
    let end = offset;
    
    while (start > 0 && this.isWordChar(text[start - 1])) start--;
    while (end < text.length && this.isWordChar(text[end])) end++;
    
    return text.substring(start, end);
  }

  getEntityAtCoords(editor: EditorWithCodeMirror, x: number, y: number): { path: string; display: string } | null {
    const pos = this.getPosAtCoords(editor, x, y);
    if (!pos) return null;
    const line = editor.getLine(pos.line);
    return this.findEntityAtPosition(line, pos.ch);
  }

  getPosAtCoords(editor: EditorWithCodeMirror, x: number, y: number): EditorPosition | null {
    if (editor.cm) {
      const offset = editor.cm.posAtCoords({ x, y });
      if (offset !== null) {
        return editor.offsetToPos(offset);
      }
    }
    return null;
  }

  findEntityAtPosition(lineText: string, ch: number): { path: string; display: string } | null {
    // 1. Try strict entity regex (full names)
    if (this.entityRegex) {
        let match: RegExpExecArray | null;
        this.entityRegex.lastIndex = 0;
        while ((match = this.entityRegex.exec(lineText)) !== null) {
          const start = match.index;
          const end = start + match[0].length;
          if (ch >= start && ch <= end) {
            const name = match[0];
            const info = this.entityIndex.get(name);
            return info || null;
          }
        }
    }

    // 2. Fallback: Get word at cursor and try partial match
    // Simple word boundary check
    let start = ch;
    let end = ch;
    while (start > 0 && this.isWordChar(lineText[start - 1])) start--;
    while (end < lineText.length && this.isWordChar(lineText[end])) end++;
    
    const word = lineText.substring(start, end);
    if (word && word.length >= 2) {
        // Try to find entity starting with this word (e.g. "Amy" -> "Amy Calder")
        const target = word.toLowerCase();
        // Prefer exact first name match if possible to avoid "Al" -> "Alan" false positives?
        // But startWith is consistent with the "focus" logic.
        const entry = Array.from(this.entityIndex.entries()).find(([key]) => {
             const lowerKey = key.toLowerCase();
             return lowerKey === target || lowerKey.startsWith(target + ' ');
        });

        if (entry) return entry[1];
        
        // Fallback to simple startsWith for other cases
        const potentialMatch = Array.from(this.entityIndex.entries())
            .find(([key]) => key.toLowerCase().startsWith(target));
            
        if (potentialMatch) return potentialMatch[1];
    }

    return null;
  }

  stripFrontmatter(content: string): string {
    const normalized = content.replace(/\r\n/g, '\n');
    return normalized.replace(/^---\n[\s\S]*?\n---\n?/, '');
  }

  stripChapterRelevantSection(content: string): string {
    let stripped = content.replace(/## Chapter:[\s\S]*?(?=\n## |$)/g, '');
    stripped = stripped.replace(/## Chapter Relevant Information[\s\S]*?(?=\n## |$)/, '');
    return stripped;
  }

  stripImagesSection(content: string): string {
    return content.replace(/## Images[\s\S]*?(?=\n## |$)/, '');
  }

  stripSheetSection(content: string, heading: string): string {
    const pattern = new RegExp(`##\\s+${this.escapeRegex(heading)}[\\s\\S]*?(?=\\n## |$)`, 'g');
    return content.replace(pattern, '').trim();
  }

  extractTitle(content: string): string {
    const match = content.match(/^#\s+(.*)$/m);
    return match ? match[1] : '';
  }

  removeTitle(content: string): string {
    return content.replace(/^#\s+.*$/m, '').trim();
  }

  applyCharacterOverridesToBody(content: string, overrides: Record<string, string>): string {
    if (!overrides) return content;
    
    return content.replace(/^((\s*[-*]\s*\*\*)(.+?)(\*\*[:]?\s*))(.*)$/gm, (match, section, _prefix, key) => {
        const k = (key as string).toLowerCase().replace(/\s+/g, '_');
        if (overrides[k]) {
            return section + String(overrides[k]);
        }
        return match;
    });
  }

  extractFrontmatter(content: string): string {
    const normalized = content.replace(/\r\n/g, '\n');
    const match = normalized.match(/^---\n[\s\S]*?\n---\n?/);
    return match ? match[0] : '';
  }

  extractFrontmatterAndBody(content: string): { frontmatter: Record<string, string>; body: string } {
    const fm = this.parseFrontmatter(content);
    const body = this.stripFrontmatter(content);
    return { frontmatter: fm, body };
  }

  isChapterFile(file: TFile): boolean {
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.chapterFolder}/`;
    return file.path.startsWith(folder);
  }

  isChapterPath(path: string): boolean {
      const root = this.settings.projectPath;
      if (!root) return false;
      const folder = `${root}/${this.settings.chapterFolder}/`;
      return path.startsWith(folder);
  }

  isTemplateFile(file: TFile): boolean {
    const root = this.settings.projectPath;
    const folder = `${root}/Templates/`;
    return file.path.startsWith(folder);
  }

  isCharacterFile(file: TFile): boolean {
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.characterFolder}/`;
    return file.path.startsWith(folder) && file.extension === 'md';
  }

  isLocationFile(file: TFile): boolean {
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.locationFolder}/`;
    return file.path.startsWith(folder) && file.extension === 'md';
  }

  async openCharacterSheet(file: TFile, targetLeaf?: WorkspaceLeaf): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(CHARACTER_SHEET_VIEW_TYPE)
      .find((leaf) => leaf.view instanceof CharacterSheetView && leaf.view.file?.path === file.path);

    if (existingLeaf) {
      void this.app.workspace.revealLeaf(existingLeaf);
      return;
    }

    const leaf = targetLeaf ?? this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: CHARACTER_SHEET_VIEW_TYPE,
      state: { file: file.path }
    });
    void this.app.workspace.revealLeaf(leaf);
  }

  async openLocationSheet(file: TFile, targetLeaf?: WorkspaceLeaf): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(LOCATION_SHEET_VIEW_TYPE)
      .find((leaf) => leaf.view instanceof LocationSheetView && leaf.view.file?.path === file.path);

    if (existingLeaf) {
      void this.app.workspace.revealLeaf(existingLeaf);
      return;
    }

    const leaf = targetLeaf ?? this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: LOCATION_SHEET_VIEW_TYPE,
      state: { file: file.path }
    });
    void this.app.workspace.revealLeaf(leaf);
  }

  normalizeEntityName(name: string): string {
    return name.trim();
  }

  linkifyElement(el: HTMLElement): void {
    const win = window;
    const walk = win.document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (node.parentElement?.closest('a, code, pre')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes: Text[] = [];
    let currentNode: Node | null = walk.nextNode();
    while (currentNode) {
        nodes.push(currentNode as Text);
        currentNode = walk.nextNode();
    }

    for (const node of nodes) {
      if (!node.textContent || !this.entityRegex) continue;

      this.entityRegex.lastIndex = 0;
      const text = node.textContent;
      const matches: Array<{ name: string; start: number; end: number }> = [];
      let m: RegExpExecArray | null;
      while ((m = this.entityRegex.exec(text)) !== null) {
        matches.push({
          name: m[0],
          start: m.index,
          end: m.index + m[0].length
        });
      }

      if (matches.length > 0) {
        const fragment = win.document.createDocumentFragment();
        let lastIdx = 0;
        for (const match of matches) {
          fragment.append(text.substring(lastIdx, match.start));
          const link = win.document.createElement('a');
          link.textContent = match.name;
          link.addClass('novalist-mention');
          link.dataset.href = match.name;
          fragment.append(link);
          lastIdx = match.end;
        }
        fragment.append(text.substring(lastIdx));
        node.replaceWith(fragment);
      }
    }
  }

  // ─── Annotation / Comment System ──────────────────────────────────

  private setupAnnotationExtension(): void {
    const callbacks: AnnotationCallbacks = {
      onAddThread: (anchorText: string, from: number, to: number) => {
        this.addCommentThread(anchorText, from, to);
      },
      onAddMessage: (threadId: string, content: string) => {
        this.addCommentMessage(threadId, content);
      },
      onResolveThread: (threadId: string, resolved: boolean) => {
        this.resolveCommentThread(threadId, resolved);
      },
      onDeleteThread: (threadId: string) => {
        this.deleteCommentThread(threadId);
      },
      onDeleteMessage: (threadId: string, messageId: string) => {
        this.deleteCommentMessage(threadId, messageId);
      },
      getActiveFilePath: () => {
        const file = this.app.workspace.getActiveFile();
        return file ? file.path : null;
      }
    };

    this.annotationExtension = annotationExtension(callbacks);
    this.registerEditorExtension(this.annotationExtension);

    // Sync threads whenever the active file changes
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        // Small delay to let the editor initialize
        setTimeout(() => this.syncAnnotationThreads(), 50);
      })
    );

    // Also sync after file modifications (in case edits shift positions)
    this.registerEvent(
      this.app.workspace.on('editor-change', () => {
        this.debouncedAnnotationSync();
      })
    );
  }

  private setupStatisticsPanel(): void {
    const config: StatisticsPanelConfig = {
      language: this.settings.language,
      getGoals: () => this.settings.wordCountGoals,
      getProjectOverview: () => this.cachedProjectOverview
    };
    this.registerEditorExtension(statisticsPanelExtension(config));

    // Defer initial computation until the workspace & cache are ready
    this.app.workspace.onLayoutReady(() => {
      this.refreshProjectWordCount();
    });
    // Also refresh once more after metadata cache has resolved everything
    this.registerEvent(this.app.metadataCache.on('resolved', () => {
      this.refreshProjectWordCount();
    }));
    // Refresh periodically
    this.registerInterval(
      window.setInterval(() => this.refreshProjectWordCount(), 30000)
    );
    // Also refresh on file changes
    this.registerEvent(this.app.vault.on('modify', () => {
      if (this.projectWordsCacheTimer) clearTimeout(this.projectWordsCacheTimer);
      this.projectWordsCacheTimer = setTimeout(() => {
        this.refreshProjectWordCount();
      }, 3000) as unknown as number;
    }));
    // Refresh on file create/delete (chapter/character/location added/removed)
    this.registerEvent(this.app.vault.on('create', () => {
      this.refreshProjectWordCount();
    }));
    this.registerEvent(this.app.vault.on('delete', () => {
      this.refreshProjectWordCount();
    }));
  }

  private setupFocusPeek(): void {
    const callbacks: FocusPeekCallbacks = {
      getEntityAtPosition: (lineText: string, ch: number) => {
        const info = this.findEntityAtPosition(lineText, ch);
        if (!info) return null;
        const isChar = info.path.includes(this.settings.characterFolder);
        return { display: info.display, type: isChar ? 'character' : 'location' };
      },
      getEntityPeekData: async (name: string): Promise<EntityPeekData | null> => {
        const info = this.entityIndex.get(name);
        if (!info) return null;
        const file = this.app.vault.getAbstractFileByPath(info.path);
        if (!(file instanceof TFile)) return null;
        const isChar = info.path.includes(this.settings.characterFolder);

        const content = await this.app.vault.cachedRead(file);

        if (isChar) {
          const sheet = this.parseCharacterSheetForSidebar(content);
          if (!sheet) return null;

          // Determine active chapter context
          const activeFile = this.app.workspace.getActiveFile();
          const inChapter = activeFile && this.isChapterFile(activeFile);
          const chapterId = inChapter ? this.getChapterIdForFile(activeFile) : '';
          const chapterName = inChapter ? this.getChapterNameForFile(activeFile) : '';

          // Apply chapter overrides to base properties (mirrors sidebar logic)
          let displayName = sheet.name;
          let displaySurname = sheet.surname;
          let displayGender = sheet.gender;
          let displayAge = sheet.age;
          let displayRole = sheet.role;
          let displayCustomProps = sheet.customProperties;
          let chapterOverrideMatch: { overrides: { name?: string; surname?: string; gender?: string; age?: string; role?: string; relationships?: { role: string; character: string }[] }; customProperties?: Record<string, string> } | undefined;

          if (inChapter) {
            const overrides = this.parseCharacterSheetChapterOverrides(content);
            const match = overrides.find(
              o => o.chapter === chapterId || o.chapter === chapterName
            );
            if (match) {
              chapterOverrideMatch = match;
              if (match.overrides.name) displayName = match.overrides.name;
              if (match.overrides.surname) displaySurname = match.overrides.surname;
              if (match.overrides.gender) displayGender = match.overrides.gender;
              if (match.overrides.age) displayAge = match.overrides.age;
              if (match.overrides.role) displayRole = match.overrides.role;
              if (match.customProperties && Object.keys(match.customProperties).length > 0) {
                displayCustomProps = { ...sheet.customProperties, ...match.customProperties };
              }
            }
          }

          // Chapter-specific info
          let chapterInfo: string | undefined;
          if (inChapter) {
            const parsed = await this.parseCharacterFile(file);
            const ci = parsed.chapterInfos.find(
              c => c.chapter === chapterId || c.chapter === chapterName
            );
            if (ci?.info) chapterInfo = ci.info;
          }

          const roleColor = this.settings.roleColors[normalizeCharacterRole(displayRole)] || '';
          const genderColor = this.settings.genderColors[displayGender?.trim()] || '';

          // Resolve images (chapter overrides take priority)
          let images = this.parseCharacterSheetImages(content);
          if (inChapter) {
            const chapterImages = this.parseCharacterSheetChapterImages(content, chapterId, chapterName);
            if (chapterImages && chapterImages.length > 0) images = chapterImages;
          }

          // Parse sections from full character sheet
          const charSheet = parseCharacterSheet(content);

          return {
            type: 'character',
            name: displayName,
            entityFilePath: file.path,
            images,
            surname: displaySurname,
            gender: displayGender,
            age: displayAge,
            role: displayRole,
            roleColor,
            genderColor,
            relationships: (chapterOverrideMatch?.overrides.relationships ?? charSheet.relationships).map(r => ({ role: r.role, character: r.character })),
            customProperties: displayCustomProps,
            chapterInfo,
            sections: charSheet.sections.map(s => ({ title: s.title, content: s.content }))
          };
        } else {
          const locationName = file.basename;

          // Parse sections from full location sheet
          const locSheet = parseLocationSheet(content);

          return {
            type: 'location',
            name: locationName,
            entityFilePath: file.path,
            images: locSheet.images.map(i => ({ name: i.name, path: i.path })),
            locationType: locSheet.type,
            description: locSheet.description,
            customProperties: locSheet.customProperties,
            sections: locSheet.sections.map(s => ({ title: s.title, content: s.content }))
          };
        }
      },
      resolveImageSrc: (imagePath: string, entityFilePath: string): string | null => {
        const resolved = this.resolveImagePath(imagePath, entityFilePath);
        if (!resolved) return null;
        return this.app.vault.getResourcePath(resolved);
      },
      onOpenFile: (name: string) => {
        const info = this.entityIndex.get(name);
        if (info) {
          const file = this.app.vault.getAbstractFileByPath(info.path);
          if (file instanceof TFile) {
            void this.app.workspace.getLeaf('tab').openFile(file);
          }
        }
      },
      renderMarkdown: async (markdown: string, container: HTMLElement, sourcePath: string) => {
        const comp = new Component();
        comp.load();
        try {
          await MarkdownRenderer.render(this.app, markdown, container, sourcePath, comp);
        } finally {
          comp.unload();
        }
      },
      loadLocalStorage: (key: string): string | null => {
        return this.app.loadLocalStorage(key) as string | null;
      },
      saveLocalStorage: (key: string, value: string): void => {
        this.app.saveLocalStorage(key, value);
      }
    };

    this.registerEditorExtension(focusPeekExtension(callbacks));
  }

  private parseLocationTypeFromContent(content: string): string {
    const sheetLines = this.getSectionLines(content, 'LocationSheet');
    for (const line of sheetLines) {
      const match = line.match(/^\s*Type:\s*(.+)$/);
      if (match) return match[1].trim();
    }
    return '';
  }

  private parseLocationCustomProperties(content: string): Record<string, string> {
    const sheetLines = this.getSectionLines(content, 'LocationSheet');
    const props: Record<string, string> = {};
    let inCustom = false;
    for (const line of sheetLines) {
      if (line.trim() === 'CustomProperties:') { inCustom = true; continue; }
      if (inCustom) {
        if (/^\S/.test(line) && !line.trim().startsWith('-') && !line.trim().startsWith('*')) break;
        const match = line.match(/^[-*]\s*(.+?)\s*:\s*(.+)$/);
        if (match) props[match[1].trim()] = match[2].trim();
      }
    }
    return props;
  }

  private refreshProjectWordCount(): void {
    const chapters = this.getChapterDescriptionsSync();
    const charFolder = `${this.settings.projectPath}/${this.settings.characterFolder}/`;
    const characterCount = this.app.vault.getFiles()
      .filter(f => f.path.startsWith(charFolder) && f.extension === 'md')
      .length;
    const locationCount = this.getLocationList().length;

    let totalWords = 0;
    const vault = this.app.vault;
    let remaining = chapters.length;
    const chapterCount = chapters.length;

    if (remaining === 0) {
      this.cachedProjectOverview = {
        totalWords: 0, totalChapters: 0, totalCharacters: characterCount,
        totalLocations: locationCount, readingTime: 0, avgChapter: 0, chapters: []
      };
      return;
    }

    const chapterStats: ChapterOverviewStat[] = [];

    for (const ch of chapters) {
      void vault.cachedRead(ch.file).then(content => {
        const words = countWords(content);
        totalWords += words;
        const readability = calculateReadability(content, this.settings.language);
        chapterStats.push({
          name: ch.name,
          words,
          readability: readability.score > 0 ? readability : null
        });
        remaining--;
        if (remaining === 0) {
          // Sort by name for consistent display
          chapterStats.sort((a, b) => a.name.localeCompare(b.name));
          const avg = chapterCount > 0 ? Math.round(totalWords / chapterCount) : 0;
          this.cachedProjectOverview = {
            totalWords,
            totalChapters: chapterCount,
            totalCharacters: characterCount,
            totalLocations: locationCount,
            readingTime: Math.ceil(totalWords / 200),
            avgChapter: avg,
            chapters: chapterStats
          };
          this.updateDailyWordCount(totalWords);
        }
      });
    }
  }

  private updateDailyWordCount(totalWords: number): void {
    const today = getTodayDate();
    const goals = this.settings.wordCountGoals;
    const todayGoal = getOrCreateDailyGoal(goals, today);

    // Day changed → snapshot current total as the new baseline
    if (goals.dailyBaselineDate !== today) {
      goals.dailyBaselineWords = totalWords;
      goals.dailyBaselineDate = today;
      todayGoal.actualWords = 0;
      void this.saveSettings();
      return;
    }

    // Baseline not set (legacy data) → infer from saved progress
    if (goals.dailyBaselineWords == null) {
      goals.dailyBaselineWords = totalWords - todayGoal.actualWords;
      void this.saveSettings();
      return;
    }

    // Normal update: words today = total now minus baseline at start of day
    const wordsToday = Math.max(0, totalWords - goals.dailyBaselineWords);
    if (todayGoal.actualWords !== wordsToday) {
      todayGoal.actualWords = wordsToday;
      void this.saveSettings();
    }
  }

  private annotationSyncTimer: number | null = null;
  private debouncedAnnotationSync(): void {
    if (this.annotationSyncTimer) clearTimeout(this.annotationSyncTimer);
    this.annotationSyncTimer = setTimeout(() => {
      this.persistAnnotationPositions();
    }, 2000) as unknown as number;
  }

  syncAnnotationThreads(): void {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;

    const threads = (this.settings.commentThreads || [])
      .filter(t => t.filePath === file.path);

    // Dispatch into every CM6 editor showing this file
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) {
        const cm = (leaf.view.editor as EditorWithCodeMirror).cm;
        if (cm && 'dispatch' in cm) {
          (cm as unknown as import('@codemirror/view').EditorView).dispatch({
            effects: setThreadsEffect.of(threads)
          });
        }
      }
    });
  }

  /** Read back positions from the CM state into settings (they may have shifted). */
  private persistAnnotationPositions(): void {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;

    const cm = (view.editor as EditorWithCodeMirror).cm;
    if (!cm || !('state' in cm)) return;

    const editorView = cm as unknown as import('@codemirror/view').EditorView;
    const currentThreads = editorView.state.field(threadsField);

    // Update positions for threads belonging to this file
    const othersThreads = (this.settings.commentThreads || []).filter(t => t.filePath !== file.path);
    const updatedThreads = currentThreads.map(t => ({
      ...t,
      filePath: file.path
    }));
    this.settings.commentThreads = [...othersThreads, ...updatedThreads];
    void this.saveSettings();
  }

  private generateCommentId(): string {
    return `comment-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  addCommentThread(anchorText: string, from: number, to: number): void {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;

    const thread: CommentThread = {
      id: this.generateCommentId(),
      filePath: file.path,
      anchorText,
      from,
      to,
      messages: [],
      resolved: false,
      color: nextAnnotationColor(),
      createdAt: new Date().toISOString()
    };

    if (!this.settings.commentThreads) this.settings.commentThreads = [];
    this.settings.commentThreads.push(thread);
    void this.saveSettings();
    this.syncAnnotationThreads();
    new Notice('Comment added — type your message in the panel');
  }

  addCommentMessage(threadId: string, content: string): void {
    const thread = (this.settings.commentThreads || []).find(t => t.id === threadId);
    if (!thread) return;

    const message: CommentMessage = {
      id: this.generateCommentId(),
      content,
      createdAt: new Date().toISOString()
    };
    thread.messages.push(message);
    void this.saveSettings();
    this.syncAnnotationThreads();
  }

  resolveCommentThread(threadId: string, resolved: boolean): void {
    const thread = (this.settings.commentThreads || []).find(t => t.id === threadId);
    if (!thread) return;
    thread.resolved = resolved;
    void this.saveSettings();
    this.syncAnnotationThreads();
  }

  deleteCommentThread(threadId: string): void {
    this.settings.commentThreads = (this.settings.commentThreads || []).filter(t => t.id !== threadId);
    void this.saveSettings();
    this.syncAnnotationThreads();
  }

  deleteCommentMessage(threadId: string, messageId: string): void {
    const thread = (this.settings.commentThreads || []).find(t => t.id === threadId);
    if (!thread) return;
    thread.messages = thread.messages.filter(m => m.id !== messageId);
    void this.saveSettings();
    this.syncAnnotationThreads();
  }
}
