import {
  Plugin,
  TFile,
  MarkdownView,
  Editor,
  Notice,
  EditorPosition,
  TFolder
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
import { CharacterSuggester } from './suggesters/CharacterSuggester';
import { RelationshipKeySuggester } from './suggesters/RelationshipKeySuggester';
import { ImageSuggester } from './suggesters/ImageSuggester';
import { CharacterModal } from './modals/CharacterModal';
import { LocationModal } from './modals/LocationModal';
import { ChapterDescriptionModal } from './modals/ChapterDescriptionModal';
import { StartupWizardModal } from './modals/StartupWizardModal';
import { NovalistSettingTab } from './settings/NovalistSettingTab';
import { CHARACTER_ROLE_LABELS, CharacterRole, normalizeCharacterRole } from './utils/characterUtils';

export { CHARACTER_ROLE_LABELS, CharacterRole };

export default class NovalistPlugin extends Plugin {
  settings: NovalistSettings;
  private entityIndex: Map<string, { path: string; display: string }> = new Map();
  private entityRegex: RegExp | null = null;
  private lastHoverEntity: string | null = null;
  private hoverTimer: number | null = null;
  public knownRelationshipKeys: Set<string> = new Set();

  async onload(): Promise<void> {
    await this.loadSettings();

    await this.refreshEntityIndex();
    await this.syncAllCharactersChapterInfos();
    await this.migrateCharacterRoles();
    this.app.workspace.onLayoutReady(() => {
      void this.syncAllCharactersChapterInfos();

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

    // Add ribbon icon
    this.addRibbonIcon('book-open', 'Novalist', () => {
      void this.activateView();
    });

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

    // Open focused entity in sidebar (edit mode)
    this.addCommand({
      id: 'open-entity-in-sidebar',
      name: 'Open entity in sidebar',
      callback: () => {
        void this.openEntityFromEditor();
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

    // Add new chapter description command
    this.addCommand({
      id: 'add-chapter-description',
      name: 'Add new chapter description',
      callback: () => {
        this.openChapterDescriptionModal();
      }
    });

    // Sync roles command
    this.addCommand({
        id: 'sync-all-roles',
        name: 'Sync all chapter info sections',
        callback: () => {
            void this.syncAllCharactersChapterInfos();
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

    // Handle hover preview
    this.registerDomEvent(document, 'mousemove', (evt: MouseEvent) => {
      if (!this.settings.enableHoverPreview) return;
      
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!activeView || activeView.getMode() !== 'source') return;

      const editor = activeView.editor as EditorWithCodeMirror;
      const pos = this.getPosAtCoords(editor, evt.clientX, evt.clientY);
      if (pos === null) return;

      const lineText = editor.getLine(pos.line);
      const entity = this.findEntityAtPosition(lineText, pos.ch);

      if (entity) {
        if (this.lastHoverEntity !== entity.display) {
          this.lastHoverEntity = entity.display;
          if (this.hoverTimer) clearTimeout(this.hoverTimer);
          this.hoverTimer = (setTimeout(() => {
            void this.openEntityInSidebar(entity.display, { forceFocus: false });
          }, 300) as unknown as number);
        }
      } else {
        this.lastHoverEntity = null;
        if (this.hoverTimer) clearTimeout(this.hoverTimer);
      }
    });

    // Handle click to open entity
    this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
      if (evt.ctrlKey || evt.metaKey) {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;

        const editor = activeView.editor as EditorWithCodeMirror;
        const entity = this.getEntityAtCoords(editor, evt.clientX, evt.clientY);

        if (entity) {
          evt.preventDefault();
          evt.stopPropagation();
          void this.focusEntityByName(entity.display, true);
        }
      }
    }, true);

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

    // Index update triggers
    this.registerEvent(this.app.vault.on('create', () => { void this.refreshEntityIndex(); }));
    this.registerEvent(this.app.vault.on('delete', () => { void this.refreshEntityIndex(); }));
    this.registerEvent(this.app.vault.on('rename', () => { void this.refreshEntityIndex(); }));
    this.registerEvent(this.app.vault.on('modify', () => { void this.refreshEntityIndex(); }));

    // Auto-sync when editing a chapter file
    this.registerEvent(this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && this.isChapterFile(file)) {
            void this.syncChapterDescriptionFromChapter(file);
        }
    }));
    this.registerEvent(this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && this.isChapterDescriptionFile(file)) {
            void this.ensureChapterFileForDesc(file);
        }
    }));
    
    // Refresh explorer on creation
    this.registerEvent(this.app.vault.on('create', (file) => {
        if (file instanceof TFile && (this.isChapterFile(file) || this.isChapterDescriptionFile(file))) {
             void this.refreshEntityIndex();
        }
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => {
        if (file instanceof TFile && (this.isChapterFile(file) || this.isChapterDescriptionFile(file))) {
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
    // Standard cleanup
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData() as NovalistSettings | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
    this.app.workspace.detachLeavesOfType(NOVELIST_SIDEBAR_VIEW_TYPE);

    const rightLeaf = this.app.workspace.getRightLeaf(false);
    if (rightLeaf) {
        await rightLeaf.setViewState({
            type: NOVELIST_SIDEBAR_VIEW_TYPE,
            active: true
        });

        const leaves = this.app.workspace.getLeavesOfType(NOVELIST_SIDEBAR_VIEW_TYPE);
        if (leaves.length > 0) {
            void this.app.workspace.revealLeaf(leaves[0]);
        }
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

  getSidebarView(): NovalistSidebarView | null {
    const leaf = this.app.workspace.getLeavesOfType(NOVELIST_SIDEBAR_VIEW_TYPE)[0];
    return leaf ? (leaf.view as NovalistSidebarView) : null;
  }

  ensureSidebarView(): NovalistSidebarView | null {
    let view = this.getSidebarView();
    if (!view) {
      void this.activateView();
      view = this.getSidebarView();
    }
    return view;
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
      `${root}/${this.settings.chapterDescFolder}`,
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
        name: 'Chapter Description Template.md',
        content: `# Chapter Name

- **Order**: 1

## Outline
(Bullet points of what happens)

## Chapter notes
- **Characters**: 
- **Locations**: `
      },
      {
        name: 'Chapter Template.md',
        content: `# Chapter Name

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

  async createCharacter(name: string, surname: string, age: string, gender: string, relationship: string, role: string, furtherInfo: string): Promise<void> {
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.characterFolder}`;
    const fileName = `${name} ${surname}`.trim();
    const path = `${folder}/${fileName}.md`;

    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice('Character already exists.');
      return;
    }

    const content = `# ${fileName}

## General Information
- **Role**: ${role}
- **Gender**: ${gender}
- **Age**: ${age}
- **Relationship**: ${relationship}

${furtherInfo ? `## Further Information\n${furtherInfo}\n` : ''}
## Appearance

## Personality

## Relationships

## Images
- **Main**: 
`;

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

  async createChapterDescription(name: string, order: string, outline: string): Promise<void> {
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.chapterDescFolder}`;
    const path = `${folder}/${name}.md`;

    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice('Chapter description already exists.');
      return;
    }

    const content = `# ${name}

- **Order**: ${order}

## Outline
${outline}

## Chapter notes
- **Characters**: 
- **Locations**: 
`;

    await this.app.vault.create(path, content);
    new Notice(`Chapter description ${name} created.`);
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

    return {
      name: file.basename.split(' ')[0],
      surname: file.basename.split(' ').slice(1).join(' '),
      role: frontmatter.role || 'Side',
      gender: frontmatter.gender || '',
      age: frontmatter.age || '',
      relationship: frontmatter.relationship || '',
      chapterInfos
    };
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
      const match = line.match(/^[-*]\s*\*\*(.+?)\*\*[:]?\s*(.*)$/);
      if (match) {
        images.push({ name: match[1], path: match[2].trim() });
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
      const match = line.match(/^[-*]\s*\*\*(.+?)\*\*[:]?\s*(.*)$/);
      if (match) {
        const key = match[1].toLowerCase().replace(/\s+/g, '_');
        overrides[key] = match[2].trim();
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
        if (lines[i].match(/^[-*]\s*\*\*Role\*\*/)) {
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
      const chapterKey = desc.name;
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

  async getChapterDescriptions(): Promise<Array<{ name: string; order: number; file: TFile }>> {
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.chapterDescFolder}`;
    const files = this.app.vault.getFiles().filter((f) => f.path.startsWith(folder));

    const descs: Array<{ name: string; order: number; file: TFile }> = [];
    for (const file of files) {
      const content = await this.app.vault.read(file);
      const { frontmatter } = this.extractFrontmatterAndBody(content);
      descs.push({
        name: file.basename,
        order: Number(frontmatter.order) || 999,
        file
      });
    }

    return descs.sort((a, b) => a.order - b.order);
  }

  getChapterList(): ChapterListData[] {
    const descs = this.getChapterDescriptionsSync();
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.chapterFolder}`;
    const files = this.app.vault.getFiles().filter((f) => f.path.startsWith(folder));

    return descs.map((desc) => {
      const chapterFile = files.find((f) => f.basename === desc.name || f.basename.endsWith(desc.name));
      return {
        name: desc.name,
        file: chapterFile,
        descFile: desc.file
      };
    }).filter((d): d is ChapterListData & { file: TFile } => !!d.file);
  }

  getChapterDescriptionsSync(): Array<{ name: string; order: number; file: TFile }> {
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.chapterDescFolder}`;
    const files = this.app.vault.getFiles().filter((f) => f.path.startsWith(folder));

    const descs: Array<{ name: string; order: number; file: TFile }> = [];
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter || {};
      descs.push({
        name: file.basename,
        order: Number(frontmatter.order) || 999,
        file
      });
    }

    return descs.sort((a, b) => a.order - b.order);
  }

  async updateChapterOrder(descFiles: TFile[]): Promise<void> {
    for (let i = 0; i < descFiles.length; i++) {
      const file = descFiles[i];
      const content = await this.app.vault.read(file);
      const { frontmatter, body } = this.extractFrontmatterAndBody(content);
      
      frontmatter.order = (i + 1).toString();
      
      const nextFrontmatter = this.serializeFrontmatter(frontmatter);
      await this.app.vault.modify(file, nextFrontmatter + body);
    }
  }

  async getCharacterList(): Promise<CharacterListData[]> {
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.characterFolder}`;
    const files = this.app.vault.getFiles().filter((f) => f.path.startsWith(folder));

    const chars: CharacterListData[] = [];
    for (const file of files) {
      const content = await this.app.vault.read(file);
      const { frontmatter } = this.extractFrontmatterAndBody(content);
      
      let role = frontmatter.role;
      let gender = frontmatter.gender;

      if (!role) {
         const match = content.match(/^[-*]\s*\*\*Role\*\*:[ \t]*([^\n\r]*)/im);
         if (match) role = match[1].trim();
      }

      if (!gender) {
         const match = content.match(/^[-*]\s*\*\*Gender\*\*:[ \t]*([^\n\r]*)/im);
         if (match) gender = match[1].trim();
      }

      chars.push({
        name: file.basename,
        file,
        role: normalizeCharacterRole(role || 'Side'),
        gender: gender || ''
      });
    }

    return chars.sort((a, b) => a.name.localeCompare(b.name));
  }

  async updateCharacterRole(file: TFile, roleLabel: string): Promise<void> {
    const content = await this.app.vault.read(file);
    let { frontmatter, body } = this.extractFrontmatterAndBody(content);
    const hasFrontmatter = Object.keys(frontmatter).length > 0;
    
    // Update frontmatter only if it existed or if we want to enforce it (but we don't anymore)
    if (frontmatter.role) {
        frontmatter.role = roleLabel;
    }
    
    // Update "General Information" section in body
    const lines = body.split('\n');
    const roleIdx = lines.findIndex(l => l.match(/^[-*]\s*\*\*Role\*\*/));
    if (roleIdx !== -1) {
        lines[roleIdx] = `- **Role**: ${roleLabel}`;
    }

    let newContent = lines.join('\n');

    if (hasFrontmatter) {
        const nextFrontmatter = this.serializeFrontmatter(frontmatter);
        newContent = nextFrontmatter + newContent;
    }

    await this.app.vault.modify(file, newContent);
    
    new Notice(`Updated ${file.basename} role to ${roleLabel}`);
  }

  serializeFrontmatter(fm: Record<string, string | number>): string {
      const entries = Object.entries(fm).map(([k, v]) => `${k}: ${v}`);
      return `---\n${entries.join('\n')}\n---\n`;
  }

  getLocationList(): LocationListData[] {
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.locationFolder}`;
    const files = this.app.vault.getFiles().filter((f) => f.path.startsWith(folder));

    return files.map((file) => ({
      name: file.basename,
      file
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  getChapterNameForFileSync(file: TFile): string {
    const descs = this.getChapterDescriptionsSync();
    const desc = descs.find(d => file.basename.includes(d.name));
    return desc ? desc.name : file.basename;
  }

  getChapterNameForFile(file: TFile): string {
    return this.getChapterNameForFileSync(file);
  }

  async parseChapterFile(file: TFile): Promise<{ characters: string[]; locations: string[] }> {
    const content = await this.app.vault.read(file);
    const body = this.stripFrontmatter(content);
    
    const chapterName = this.getChapterNameForFile(file);
    const root = this.settings.projectPath;
    const descPath = `${root}/${this.settings.chapterDescFolder}/${chapterName}.md`;
    const descFile = this.app.vault.getAbstractFileByPath(descPath);
    
    let charList: string[] = [];
    let locList: string[] = [];

    if (descFile instanceof TFile) {
        const descContent = await this.app.vault.read(descFile);
        const notes = this.getSectionLines(descContent, 'Chapter notes');
        for (const line of notes) {
            const match = line.match(/^[-*]\s*\*\*(.+?)\*\*[:]?\s*(.*)$/);
            if (match) {
                const key = match[1].toLowerCase();
                const values = match[2].split(',').map(v => v.trim()).filter(Boolean);
                if (key === 'characters') charList = values;
                if (key === 'locations') locList = values;
            }
        }
    }

    if (charList.length === 0 || locList.length === 0) {
        const mentions = this.scanMentions(body);
        if (charList.length === 0) charList = mentions.characters;
        if (locList.length === 0) locList = mentions.locations;
    }

    return {
      characters: charList,
      locations: locList
    };
  }

  scanMentions(content: string): { characters: string[]; locations: string[] } {
    const characters: string[] = [];
    const locations: string[] = [];

    for (const [name, info] of this.entityIndex.entries()) {
      if (content.includes(name)) {
        if (info.path.includes(this.settings.characterFolder)) characters.push(name);
        if (info.path.includes(this.settings.locationFolder)) locations.push(name);
      }
    }

    return { characters, locations };
  }

  parseFrontmatter(content: string): Record<string, string> {
    const match = content.match(/^---\n([\s\S]+?)\n---/);
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
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.characterFolder}`;
    
    let cleanName = name.replace(/^\[{2}/, '').replace(/\]{2}$/, '');
    cleanName = cleanName.split('|')[0].trim();
    
    const path = `${folder}/${cleanName}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  findLocationFile(name: string): TFile | null {
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.locationFolder}`;
    const cleanName = name.replace(/^\[{2}/, '').replace(/\]{2}$/, '').split('|')[0].trim();
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
      if (this.endsWithToken(lineText, cursor.ch, pair.start)) {
        this.applyAutoReplacement(cursor.ch, pair.start, pair.startReplace);
        return;
      }
      if (pair.end && this.endsWithToken(lineText, cursor.ch, pair.end)) {
        this.applyAutoReplacement(cursor.ch, pair.end, pair.endReplace);
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

    const folders = [
      `${root}/${this.settings.characterFolder}`,
      `${root}/${this.settings.locationFolder}`
    ];

    for (const folder of folders) {
      const abstractFolder = this.app.vault.getAbstractFileByPath(folder);
      if (abstractFolder instanceof TFolder) {
        const children = abstractFolder.children;
        for (const child of children) {
          if (child instanceof TFile && child.extension === 'md') {
            this.entityIndex.set(child.basename, {
              path: child.path,
              display: child.basename
            });
            
            if (folder.includes(this.settings.characterFolder)) {
                const content = await this.app.vault.read(child);
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
    if (!this.entityRegex) return null;

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
    return null;
  }

  stripFrontmatter(content: string): string {
    return content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  }

  stripChapterRelevantSection(content: string): string {
    return content.replace(/## Chapter:[\s\S]*?(?=\n## |$)/, '');
  }

  stripImagesSection(content: string): string {
    return content.replace(/## Images[\s\S]*?(?=\n## |$)/, '');
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
    const match = content.match(/^---\n[\s\S]*?\n---\n?/);
    return match ? match[0] : '';
  }

  extractFrontmatterAndBody(content: string): { frontmatter: Record<string, string>; body: string } {
    const fm = this.parseFrontmatter(content);
    const body = this.stripFrontmatter(content);
    return { frontmatter: fm, body };
  }

  isChapterFile(file: TFile): boolean {
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.chapterFolder}`;
    return file.path.startsWith(folder);
  }

  isChapterPath(path: string): boolean {
      const root = this.settings.projectPath;
      if (!root) return false;
      const folder = `${root}/${this.settings.chapterFolder}`;
      return path.startsWith(folder);
  }

  isTemplateFile(file: TFile): boolean {
    const root = this.settings.projectPath;
    const folder = `${root}/Templates`;
    return file.path.startsWith(folder);
  }

  async syncChapterDescriptionFromChapter(chapterFile: TFile): Promise<void> {
    const content = await this.app.vault.read(chapterFile);
    const { frontmatter } = this.extractFrontmatterAndBody(content);
    
    const chapterName = this.getChapterNameForFile(chapterFile);
    const root = this.settings.projectPath;
    const descPath = `${root}/${this.settings.chapterDescFolder}/${chapterName}.md`;
    const descFile = this.app.vault.getAbstractFileByPath(descPath);
    
    if (descFile instanceof TFile) {
        const descContent = await this.app.vault.read(descFile);
        const { frontmatter: descFm, body: descBody } = this.extractFrontmatterAndBody(descContent);
        
        let changed = false;
        if (frontmatter.order && descFm.order !== frontmatter.order) {
            descFm.order = frontmatter.order;
            changed = true;
        }
        
        if (changed) {
            const nextFrontmatter = this.serializeFrontmatter(descFm);
            await this.app.vault.modify(descFile, nextFrontmatter + descBody);
        }
    }
  }

  isChapterDescriptionFile(file: TFile): boolean {
    const root = this.settings.projectPath;
    const folder = `${root}/${this.settings.chapterDescFolder}`;
    return file.path.startsWith(folder);
  }

  async ensureChapterFileForDesc(descFile: TFile): Promise<void> {
      const root = this.settings.projectPath;
      const chapterFolder = `${root}/${this.settings.chapterFolder}`;
      const chapterPath = `${chapterFolder}/${descFile.basename}.md`;
      
      const chapterFile = this.app.vault.getAbstractFileByPath(chapterPath);
      if (!(chapterFile instanceof TFile)) {
          const content = `# ${descFile.basename}\n\n(Write your story here)`;
          await this.app.vault.create(chapterPath, content);
          new Notice(`Created chapter file for ${descFile.basename}`);
      }
  }

  openEntityFromEditor(): void {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) return;
    const editor = activeView.editor as EditorWithCodeMirror;
    const entity = this.getEntityAtCursor(editor);
    if (entity) {
      this.focusEntityByName(entity.display, true);
    }
  }

  focusEntityByName(name: string, reveal: boolean): boolean {
    const cleanName = name.replace(/^\[{2}/, '').replace(/\]{2}$/, '').split('|')[0].trim();
    const info = this.entityIndex.get(cleanName);
    if (info) {
      const file = this.app.vault.getAbstractFileByPath(info.path);
      if (file instanceof TFile) {
        const sidebar = this.ensureSidebarView();
        if (sidebar) {
            sidebar.setSelectedEntity({
                type: info.path.includes(this.settings.characterFolder) ? 'character' : 'location',
                file,
                display: info.display
            }, { forceFocus: reveal });
        }
        return true;
      }
    }
    return false;
  }

  clearFocus(): void {
    const sidebar = this.getSidebarView();
    if (sidebar) {
      sidebar.setSelectedEntity(null);
    }
  }

  normalizeEntityName(name: string): string {
    return name.trim();
  }

  openEntityInSidebar(name: string, options?: { forceFocus?: boolean }): void {
    const info = this.entityIndex.get(name);
    if (info) {
      const file = this.app.vault.getAbstractFileByPath(info.path);
      if (file instanceof TFile) {
        const sidebar = this.ensureSidebarView();
        if (sidebar) {
          sidebar.setSelectedEntity({
            type: info.path.includes(this.settings.characterFolder) ? 'character' : 'location',
            file,
            display: info.display
          }, options);
        }
      }
    }
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
          link.addEventListener('click', (evt) => {
            evt.preventDefault();
            this.focusEntityByName(match.name, true);
          });
          fragment.append(link);
          lastIdx = match.end;
        }
        fragment.append(text.substring(lastIdx));
        node.replaceWith(fragment);
      }
    }
  }
}
