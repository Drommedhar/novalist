import {
  Plugin,
  TFile,
  TFolder,
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
  NovalistProject,
  EditorWithCodeMirror,
  AutoReplacementPair,
  LanguageKey,
  CharacterData,
  CharacterChapterInfo,
  LocationData,
  ChapterListData,
  CharacterListData,
  LocationListData,
  ChapterStatus,
  SceneData,
  CharacterTemplate,
  LocationTemplate,
  ItemTemplate,
  LoreTemplate,
  ItemListData,
  LoreListData
} from './types';
import { DEFAULT_SETTINGS, cloneAutoReplacements, LANGUAGE_DEFAULTS, DEFAULT_CHARACTER_TEMPLATE, DEFAULT_LOCATION_TEMPLATE, DEFAULT_ITEM_TEMPLATE, DEFAULT_LORE_TEMPLATE, cloneCharacterTemplate, cloneLocationTemplate, cloneItemTemplate, cloneLoreTemplate, createDefaultProject, createDefaultProjectData, migrateTemplateDefs } from './settings/NovalistSettings';
import { NovalistSidebarView, NOVELIST_SIDEBAR_VIEW_TYPE } from './views/NovalistSidebarView';
import { NovalistExplorerView, NOVELIST_EXPLORER_VIEW_TYPE } from './views/NovalistExplorerView';
import { CharacterMapView, CHARACTER_MAP_VIEW_TYPE } from './views/CharacterMapView';
import { LocationSheetView, LOCATION_SHEET_VIEW_TYPE } from './views/LocationSheetView';
import { CharacterSheetView, CHARACTER_SHEET_VIEW_TYPE } from './views/CharacterSheetView';
import { ExportView, EXPORT_VIEW_TYPE } from './views/ExportView';
import { PlotBoardView, PLOT_BOARD_VIEW_TYPE } from './views/PlotBoardView';
import { ItemSheetView, ITEM_SHEET_VIEW_TYPE } from './views/ItemSheetView';
import { LoreSheetView, LORE_SHEET_VIEW_TYPE } from './views/LoreSheetView';
import { ImageGalleryView, IMAGE_GALLERY_VIEW_TYPE } from './views/ImageGalleryView';
import { NovalistToolbarManager } from './utils/toolbarUtils';

import { CharacterSuggester } from './suggesters/CharacterSuggester';
import { RelationshipKeySuggester } from './suggesters/RelationshipKeySuggester';
import { ImageSuggester } from './suggesters/ImageSuggester';
import { CharacterModal } from './modals/CharacterModal';
import { LocationModal } from './modals/LocationModal';
import { ItemModal } from './modals/ItemModal';
import { LoreModal } from './modals/LoreModal';
import { ChapterDescriptionModal, ChapterEditData } from './modals/ChapterDescriptionModal';
import { SceneNameModal } from './modals/SceneNameModal';
import { StartupWizardModal } from './modals/StartupWizardModal';
import { ProjectSwitcherModal, ProjectRenameModal } from './modals/ProjectModals';
import { NovalistSettingTab } from './settings/NovalistSettingTab';
import { normalizeCharacterRole, computeInterval } from './utils/characterUtils';
import { parseCharacterSheet, applyChapterOverride } from './utils/characterSheetUtils';
import { parseLocationSheet } from './utils/locationSheetUtils';
import { parseItemSheet } from './utils/itemSheetUtils';
import { parseLoreSheet } from './utils/loreSheetUtils';
import { initLocale, t } from './i18n';
import {
  annotationExtension,
  setThreadsEffect,
  threadsField,
  nextAnnotationColor,
  type AnnotationCallbacks
} from './cm/annotationExtension';
import { statisticsPanelExtension, type StatisticsPanelConfig, type ChapterOverviewStat, type SceneOverviewStat } from './cm/statisticsPanelExtension';
import {
  focusPeekExtension,
  FOCUS_PEEK_SIZE_STORAGE_KEY,
  type FocusPeekCallbacks,
  type EntityPeekData
} from './cm/focusPeekExtension';
import { countWords, getTodayDate, getOrCreateDailyGoal } from './utils/statisticsUtils';
import { calculateReadability } from './utils/readabilityUtils';
import type { CommentThread, CommentMessage, ProjectData } from './types';

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
    initLocale();
    
    // Apply book paragraph spacing if enabled
    this.updateBookParagraphSpacing();

    await this.refreshEntityIndex();
    this.app.workspace.onLayoutReady(() => {
      if (!this.settings.startupWizardShown || !this.app.vault.getAbstractFileByPath(this.resolvedProjectPath())) {
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

    // Register item sheet view
    this.registerView(
      ITEM_SHEET_VIEW_TYPE,
      (leaf) => new ItemSheetView(leaf, this)
    );

    // Register lore sheet view
    this.registerView(
      LORE_SHEET_VIEW_TYPE,
      (leaf) => new LoreSheetView(leaf, this)
    );

    // Register image gallery view
    this.registerView(
      IMAGE_GALLERY_VIEW_TYPE,
      (leaf) => new ImageGalleryView(leaf, this)
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
      name: t('cmd.openCharacterSheet'),
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
      name: t('cmd.openLocationSheet'),
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
    this.addRibbonIcon('book-open', t('ribbon.sidebar'), () => {
      void this.activateView();
    });

    // Initialize toolbar manager and apply setting
    this.toolbarManager = new NovalistToolbarManager(this);
    this.toolbarManager.update();

    // Initialize project structure command
    this.addCommand({
      id: 'initialize-novel-project',
      name: t('cmd.initProject'),
      callback: () => {
        new StartupWizardModal(this.app, this).open();
      }
    });

    // Open sidebar command
    this.addCommand({
      id: 'open-context-sidebar',
      name: t('cmd.openSidebar'),
      callback: () => {
        void this.activateView();
      }
    });

    // Open custom explorer command
    this.addCommand({
      id: 'open-custom-explorer',
      name: t('cmd.openExplorer'),
      callback: () => {
        void this.activateExplorerView(true);
      }
    });

    this.addCommand({
      id: 'open-character-map',
      name: t('cmd.openCharacterMap'),
      callback: () => {
        void this.activateCharacterMapView();
      }
    });

    // Open export view
    this.addCommand({
      id: 'open-export',
      name: t('cmd.export'),
      callback: () => {
        void this.activateExportView();
      }
    });

    // Open plot board
    this.addCommand({
      id: 'open-plot-board',
      name: t('cmd.openPlotBoard'),
      callback: () => {
        void this.activatePlotBoardView();
      }
    });

    // Add new character command
    this.addCommand({
      id: 'add-character',
      name: t('cmd.addCharacter'),
      callback: () => {
        this.openCharacterModal();
      }
    });

    // Add new location command
    this.addCommand({
      id: 'add-location',
      name: t('cmd.addLocation'),
      callback: () => {
        this.openLocationModal();
      }
    });

    // Add new item command
    this.addCommand({
      id: 'add-item',
      name: t('cmd.addItem'),
      callback: () => {
        this.openItemModal();
      }
    });

    // Add new lore command
    this.addCommand({
      id: 'add-lore',
      name: t('cmd.addLore'),
      callback: () => {
        this.openLoreModal();
      }
    });

    // Command to open current item file in sheet view
    this.addCommand({
      id: 'open-item-sheet',
      name: t('cmd.openItemSheet'),
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = file instanceof TFile && this.isItemFile(file);
        if (checking) return canRun;
        if (canRun && file) {
          const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
          void this.openItemSheet(file, activeView?.leaf);
        }
      }
    });

    // Command to open current lore file in sheet view
    this.addCommand({
      id: 'open-lore-sheet',
      name: t('cmd.openLoreSheet'),
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = file instanceof TFile && this.isLoreFile(file);
        if (checking) return canRun;
        if (canRun && file) {
          const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
          void this.openLoreSheet(file, activeView?.leaf);
        }
      }
    });

    // Open image gallery
    this.addCommand({
      id: 'open-image-gallery',
      name: t('cmd.openImageGallery'),
      callback: () => {
        void this.activateImageGalleryView();
      }
    });

    // Add new chapter command
    this.addCommand({
      id: 'add-chapter-description',
      name: t('cmd.addChapter'),
      callback: () => {
        this.openChapterDescriptionModal();
      }
    });

    // Add scene to current chapter
    this.addCommand({
      id: 'add-scene',
      name: t('cmd.addScene'),
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = file instanceof TFile && this.isChapterFile(file);
        if (checking) return canRun;
        if (canRun && file) {
          this.promptSceneName(file);
        }
      }
    });

    // Switch project command
    this.addCommand({
      id: 'switch-project',
      name: t('cmd.switchProject'),
      callback: () => {
        const projects = this.getProjects();
        if (projects.length <= 1) {
          new Notice(t('notice.onlyOneProject'));
          return;
        }
        const modal = new ProjectSwitcherModal(this.app, this);
        modal.open();
      }
    });

    // Rename active project command
    this.addCommand({
      id: 'rename-project',
      name: t('cmd.renameProject'),
      callback: () => {
        const modal = new ProjectRenameModal(this.app, this);
        modal.open();
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
      void this.activateExplorerView();
    }));

    // Auto-open character and location files in sheet view
    const processedFiles = new Set<string>();
    this.registerEvent(this.app.workspace.on('file-open', (file: TFile | null) => {
      if (!file) return;
      
      const isChar = this.isCharacterFile(file);
      const isLoc = this.isLocationFile(file);
      const isItem = this.isItemFile(file);
      const isLore = this.isLoreFile(file);
      
      if (!isChar && !isLoc && !isItem && !isLore) return;
      
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
        } else if (isLoc) {
            void this.openLocationSheet(file, activeLeaf);
        } else if (isItem) {
            void this.openItemSheet(file, activeLeaf);
        } else {
            void this.openLoreSheet(file, activeLeaf);
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

        const projectPath = this.resolvedProjectPath();
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
    this.settings.enableToolbar = true;
    this.settings.enableCustomExplorer = true;

    // ── Migrate to multi-project model ──────────────────────────────
    if (!this.settings.projects || this.settings.projects.length === 0) {
      const projectPath = this.settings.projectPath || 'NovelProject';
      const project = createDefaultProject();
      project.name = projectPath;
      project.path = projectPath;
      this.settings.projects = [project];
      this.settings.activeProjectId = project.id;
      // Move per-project data into projectData map
      this.settings.projectData = {};
      this.settings.projectData[project.id] = {
        commentThreads: this.settings.commentThreads || [],
        plotBoard: this.settings.plotBoard || DEFAULT_SETTINGS.plotBoard,
        wordCountGoals: this.settings.wordCountGoals || DEFAULT_SETTINGS.wordCountGoals,
        explorerGroupCollapsed: this.settings.explorerGroupCollapsed || {},
        relationshipPairs: this.settings.relationshipPairs || {},
      };
    }
    if (!this.settings.projectData) {
      this.settings.projectData = {};
    }
    if (!this.settings.worldBiblePath) {
      this.settings.worldBiblePath = 'WorldBible';
    }

    // Ensure active project exists
    const activeProject = this.settings.projects.find(p => p.id === this.settings.activeProjectId);
    if (!activeProject && this.settings.projects.length > 0) {
      this.settings.activeProjectId = this.settings.projects[0].id;
    }

    // Hydrate per-project data into top-level fields (so all existing code works)
    this.hydrateActiveProjectData();

    // Migrate plotBoard: ensure new fields exist for older saved data
    const pb = this.settings.plotBoard;
    if (!pb.labels) pb.labels = [];
    if (!pb.cardColors) pb.cardColors = {};
    if (!pb.cardLabels) pb.cardLabels = {};
    if (!pb.viewMode) pb.viewMode = 'board';
    if (!pb.collapsedActs) pb.collapsedActs = [];

    // Migrate templates: ensure templates exist for older saved data
    if (!this.settings.characterTemplates || this.settings.characterTemplates.length === 0) {
      this.settings.characterTemplates = [cloneCharacterTemplate(DEFAULT_CHARACTER_TEMPLATE)];
    }
    if (!this.settings.locationTemplates || this.settings.locationTemplates.length === 0) {
      this.settings.locationTemplates = [cloneLocationTemplate(DEFAULT_LOCATION_TEMPLATE)];
    }
    // Remove deprecated FaceShot field from saved character templates
    for (const tpl of this.settings.characterTemplates) {
      tpl.fields = tpl.fields.filter(f => f.key !== 'FaceShot');
    }
    // Migrate legacy customProperties map → customPropertyDefs
    for (const tpl of this.settings.characterTemplates) migrateTemplateDefs(tpl);
    for (const tpl of this.settings.locationTemplates) migrateTemplateDefs(tpl);
    if (!this.settings.activeCharacterTemplateId) {
      this.settings.activeCharacterTemplateId = 'default';
    }
    if (!this.settings.activeLocationTemplateId) {
      this.settings.activeLocationTemplateId = 'default';
    }

    // Migrate item/lore templates: ensure templates exist for older saved data
    if (!this.settings.itemTemplates || this.settings.itemTemplates.length === 0) {
      this.settings.itemTemplates = [cloneItemTemplate(DEFAULT_ITEM_TEMPLATE)];
    }
    if (!this.settings.loreTemplates || this.settings.loreTemplates.length === 0) {
      this.settings.loreTemplates = [cloneLoreTemplate(DEFAULT_LORE_TEMPLATE)];
    }
    for (const tpl of this.settings.itemTemplates) migrateTemplateDefs(tpl);
    for (const tpl of this.settings.loreTemplates) migrateTemplateDefs(tpl);
    if (!this.settings.activeItemTemplateId) {
      this.settings.activeItemTemplateId = 'default';
    }
    if (!this.settings.activeLoreTemplateId) {
      this.settings.activeLoreTemplateId = 'default';
    }
    // Ensure item/lore folder names exist
    if (!this.settings.itemFolder) {
      this.settings.itemFolder = 'Items';
    }
    if (!this.settings.loreFolder) {
      this.settings.loreFolder = 'Lore';
    }
  }

  /** Copy per-project data from the projectData map into top-level settings fields. */
  private hydrateActiveProjectData(): void {
    const activeProject = this.getActiveProject();
    if (activeProject) {
      this.settings.projectPath = activeProject.path;
    }
    const pd = this.settings.projectData[this.settings.activeProjectId];
    if (pd) {
      this.settings.commentThreads = pd.commentThreads;
      this.settings.plotBoard = pd.plotBoard;
      this.settings.wordCountGoals = pd.wordCountGoals;
      this.settings.explorerGroupCollapsed = pd.explorerGroupCollapsed;
      this.settings.relationshipPairs = pd.relationshipPairs;
    } else {
      // No projectData entry yet — preserve any top-level data that was
      // loaded from an older version instead of replacing it with empty defaults.
      const fallback: ProjectData = {
        commentThreads: this.settings.commentThreads ?? [],
        plotBoard: this.settings.plotBoard ?? createDefaultProjectData().plotBoard,
        wordCountGoals: this.settings.wordCountGoals ?? createDefaultProjectData().wordCountGoals,
        explorerGroupCollapsed: this.settings.explorerGroupCollapsed ?? {},
        relationshipPairs: this.settings.relationshipPairs ?? {},
      };
      this.settings.projectData[this.settings.activeProjectId] = fallback;
      this.settings.commentThreads = fallback.commentThreads;
      this.settings.plotBoard = fallback.plotBoard;
      this.settings.wordCountGoals = fallback.wordCountGoals;
      this.settings.explorerGroupCollapsed = fallback.explorerGroupCollapsed;
      this.settings.relationshipPairs = fallback.relationshipPairs;
    }
  }

  /** Flush top-level per-project fields back into the projectData map. */
  private flushActiveProjectData(): void {
    this.settings.projectData[this.settings.activeProjectId] = {
      commentThreads: this.settings.commentThreads,
      plotBoard: this.settings.plotBoard,
      wordCountGoals: this.settings.wordCountGoals,
      explorerGroupCollapsed: this.settings.explorerGroupCollapsed,
      relationshipPairs: this.settings.relationshipPairs,
    };
    const activeProject = this.getActiveProject();
    if (activeProject) {
      this.settings.projectPath = activeProject.path;
    }
  }

  async saveSettings(): Promise<void> {
    this.flushActiveProjectData();
    await this.saveData(this.settings);
  }

  resetFocusPeekSize(): void {
    this.app.saveLocalStorage(FOCUS_PEEK_SIZE_STORAGE_KEY, '');
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

  // ─── Path resolution helpers ─────────────────────────────────────────

  /** Prepend the optional novalistRoot to a vault-relative path. */
  resolvePath(path: string): string {
    const root = this.settings.novalistRoot;
    if (!root) return path;
    return `${root}/${path}`;
  }

  /** Resolved vault path for the active project folder. */
  resolvedProjectPath(): string {
    return this.resolvePath(this.settings.projectPath);
  }

  /** Resolved vault path for the World Bible folder. */
  resolvedWorldBiblePath(): string {
    return this.settings.worldBiblePath
      ? this.resolvePath(this.settings.worldBiblePath)
      : '';
  }

  // ─── Multi-project helpers ─────────────────────────────────────────

  getActiveProject(): NovalistProject | undefined {
    return this.settings.projects.find(p => p.id === this.settings.activeProjectId);
  }

  getProjects(): NovalistProject[] {
    return this.settings.projects;
  }

  async addProject(name: string, path: string): Promise<NovalistProject> {
    const id = `project-${Date.now()}`;
    const project: NovalistProject = { id, name, path };
    this.settings.projects.push(project);
    this.settings.projectData[id] = createDefaultProjectData();
    await this.saveSettings();
    return project;
  }

  async switchProject(projectId: string): Promise<void> {
    if (projectId === this.settings.activeProjectId) return;
    const target = this.settings.projects.find(p => p.id === projectId);
    if (!target) return;

    // Flush current project data first
    this.flushActiveProjectData();

    // Switch
    this.settings.activeProjectId = projectId;
    this.hydrateActiveProjectData();
    await this.saveSettings();

    // Refresh everything
    await this.refreshEntityIndex();
    this.refreshProjectWordCount();

    // Refresh views
    for (const leaf of this.app.workspace.getLeavesOfType(NOVELIST_EXPLORER_VIEW_TYPE)) {
      void (leaf.view as NovalistExplorerView).render();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(NOVELIST_SIDEBAR_VIEW_TYPE)) {
      void (leaf.view as NovalistSidebarView).render();
    }

    new Notice(t('notice.projectSwitched', { name: target.name }));
  }

  async renameProject(projectId: string, newName: string): Promise<void> {
    const project = this.settings.projects.find(p => p.id === projectId);
    if (!project) return;

    const oldName = project.name;
    const oldPath = project.path;
    const newPath = newName;

    // If the name hasn't changed, nothing to do
    if (oldName === newName) return;

    // Resolve vault-level paths (with optional root prefix)
    const oldResolvedPath = this.resolvePath(oldPath);
    const newResolvedPath = this.resolvePath(newPath);

    // Rename the vault folder if it exists
    const folder = this.app.vault.getAbstractFileByPath(oldResolvedPath);
    if (folder) {
      try {
        await this.app.fileManager.renameFile(folder, newResolvedPath);
      } catch (e) {
        new Notice(String(e));
        return;
      }
    }

    // Update comment thread file paths
    const pd = this.settings.projectData[projectId];
    if (pd) {
      for (const thread of pd.commentThreads) {
        if (thread.filePath.startsWith(oldResolvedPath + '/') || thread.filePath === oldResolvedPath) {
          thread.filePath = newResolvedPath + thread.filePath.substring(oldResolvedPath.length);
        }
      }
    }

    // Update project entry
    project.name = newName;
    project.path = newPath;

    // If this is the active project, also update the top-level projectPath
    if (projectId === this.settings.activeProjectId) {
      this.settings.projectPath = newPath;
      // Also update commentThreads in the hydrated settings
      for (const thread of this.settings.commentThreads) {
        if (thread.filePath.startsWith(oldResolvedPath + '/') || thread.filePath === oldResolvedPath) {
          thread.filePath = newResolvedPath + thread.filePath.substring(oldResolvedPath.length);
        }
      }
    }

    await this.saveSettings();
    await this.refreshEntityIndex();

    // Refresh views
    for (const leaf of this.app.workspace.getLeavesOfType(NOVELIST_EXPLORER_VIEW_TYPE)) {
      void (leaf.view as NovalistExplorerView).render();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(NOVELIST_SIDEBAR_VIEW_TYPE)) {
      void (leaf.view as NovalistSidebarView).render();
    }

    new Notice(t('notice.projectRenamed', { oldName, newName }));
  }

  async deleteProject(projectId: string): Promise<void> {
    if (this.settings.projects.length <= 1) return; // Keep at least one
    if (projectId === this.settings.activeProjectId) {
      // Switch to another project first
      const other = this.settings.projects.find(p => p.id !== projectId);
      if (other) await this.switchProject(other.id);
    }
    this.settings.projects = this.settings.projects.filter(p => p.id !== projectId);
    delete this.settings.projectData[projectId];
    await this.saveSettings();
  }

  /**
   * Change the novalistRoot setting, optionally move existing content.
   * After the change, refreshes all indexes and views.
   */
  async changeNovalistRoot(newRoot: string, moveContent: boolean): Promise<void> {
    const oldRoot = this.settings.novalistRoot;
    const cleaned = newRoot.replace(/^\/+|\/+$/g, '');
    if (oldRoot === cleaned) return;

    if (moveContent) {
      // Ensure new root folder exists
      if (cleaned && !this.app.vault.getAbstractFileByPath(cleaned)) {
        await this.app.vault.createFolder(cleaned);
      }

      // Collect the vault-level folders to move (projects + world bible)
      const foldersToMove: { oldResolved: string; newResolved: string }[] = [];

      for (const project of this.settings.projects) {
        const oldResolved = oldRoot ? `${oldRoot}/${project.path}` : project.path;
        const newResolved = cleaned ? `${cleaned}/${project.path}` : project.path;
        foldersToMove.push({ oldResolved, newResolved });
      }

      if (this.settings.worldBiblePath) {
        const oldResolved = oldRoot ? `${oldRoot}/${this.settings.worldBiblePath}` : this.settings.worldBiblePath;
        const newResolved = cleaned ? `${cleaned}/${this.settings.worldBiblePath}` : this.settings.worldBiblePath;
        foldersToMove.push({ oldResolved, newResolved });
      }

      for (const { oldResolved, newResolved } of foldersToMove) {
        const folder = this.app.vault.getAbstractFileByPath(oldResolved);
        if (folder instanceof TFolder) {
          // Update comment thread paths
          for (const project of this.settings.projects) {
            const pd = this.settings.projectData[project.id];
            if (!pd) continue;
            for (const thread of pd.commentThreads) {
              if (thread.filePath.startsWith(oldResolved + '/') || thread.filePath === oldResolved) {
                thread.filePath = newResolved + thread.filePath.substring(oldResolved.length);
              }
            }
          }
          // Also update hydrated comment threads
          for (const thread of this.settings.commentThreads) {
            if (thread.filePath.startsWith(oldResolved + '/') || thread.filePath === oldResolved) {
              thread.filePath = newResolved + thread.filePath.substring(oldResolved.length);
            }
          }

          try {
            await this.app.fileManager.renameFile(folder, newResolved);
          } catch (e) {
            new Notice(String(e));
          }
        }
      }

      // Remove empty old root folder
      if (oldRoot) {
        const oldRootFolder = this.app.vault.getAbstractFileByPath(oldRoot);
        if (oldRootFolder instanceof TFolder && oldRootFolder.children.length === 0) {
          try {
            await this.app.fileManager.trashFile(oldRootFolder);
          } catch { /* ignore if it fails */ }
        }
      }
    }

    this.settings.novalistRoot = cleaned;
    await this.saveSettings();

    // Refresh everything
    await this.refreshEntityIndex();
    this.refreshProjectWordCount();

    for (const leaf of this.app.workspace.getLeavesOfType(NOVELIST_EXPLORER_VIEW_TYPE)) {
      void (leaf.view as NovalistExplorerView).render();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(NOVELIST_SIDEBAR_VIEW_TYPE)) {
      void (leaf.view as NovalistSidebarView).render();
    }

    new Notice(t('notice.rootChanged'));
  }

  /** Check whether a path belongs to the World Bible folder. */
  isWorldBiblePath(path: string): boolean {
    const wb = this.resolvedWorldBiblePath();
    return !!wb && (path.startsWith(wb + '/') || path === wb);
  }

  /** Initialize World Bible folder structure. */
  async initializeWorldBible(): Promise<void> {
    const wb = this.resolvedWorldBiblePath();
    if (!wb) return;

    // Ensure novalistRoot folder exists when set
    const novalistRoot = this.settings.novalistRoot;
    if (novalistRoot && !this.app.vault.getAbstractFileByPath(novalistRoot)) {
      await this.app.vault.createFolder(novalistRoot);
    }

    const folders = [
      wb,
      `${wb}/${this.settings.characterFolder}`,
      `${wb}/${this.settings.locationFolder}`,
      `${wb}/${this.settings.itemFolder}`,
      `${wb}/${this.settings.loreFolder}`,
      `${wb}/${this.settings.imageFolder}`,
    ];

    for (const folder of folders) {
      if (!this.app.vault.getAbstractFileByPath(folder)) {
        await this.app.vault.createFolder(folder);
      }
    }

    new Notice(t('notice.worldBibleInitialized'));
  }

  /** Determine the entity subfolder (Characters or Locations) for a file. */
  private getEntitySubfolder(file: TFile): string | null {
    const charFolder = this.settings.characterFolder;
    const locFolder = this.settings.locationFolder;
    const itemFolder = this.settings.itemFolder;
    const loreFolder = this.settings.loreFolder;
    if (file.path.includes(`/${charFolder}/`)) return charFolder;
    if (file.path.includes(`/${locFolder}/`)) return locFolder;
    if (file.path.includes(`/${itemFolder}/`)) return itemFolder;
    if (file.path.includes(`/${loreFolder}/`)) return loreFolder;
    return null;
  }

  /** Move a character or location file into the World Bible folder. */
  async moveEntityToWorldBible(file: TFile): Promise<void> {
    const wb = this.resolvedWorldBiblePath();
    if (!wb) return;

    const subfolder = this.getEntitySubfolder(file);
    if (!subfolder) return;

    const targetDir = `${wb}/${subfolder}`;
    // Ensure target directory exists
    if (!this.app.vault.getAbstractFileByPath(targetDir)) {
      await this.app.vault.createFolder(targetDir);
    }

    const newPath = `${targetDir}/${file.name}`;
    if (this.app.vault.getAbstractFileByPath(newPath)) {
      new Notice(t('notice.moveTargetExists', { name: file.basename }));
      return;
    }

    await this.app.fileManager.renameFile(file, newPath);
    await this.refreshEntityIndex();
    new Notice(t('notice.movedToWorldBible', { name: file.basename }));
  }

  /** Move a character or location file into a specific project folder. */
  async moveEntityToProject(file: TFile, projectId: string): Promise<void> {
    const project = this.settings.projects.find(p => p.id === projectId);
    if (!project) return;

    const subfolder = this.getEntitySubfolder(file);
    if (!subfolder) return;

    const targetDir = `${project.path}/${subfolder}`;
    // Ensure target directory exists
    if (!this.app.vault.getAbstractFileByPath(targetDir)) {
      await this.app.vault.createFolder(targetDir);
    }

    const newPath = `${targetDir}/${file.name}`;
    if (this.app.vault.getAbstractFileByPath(newPath)) {
      new Notice(t('notice.moveTargetExists', { name: file.basename }));
      return;
    }

    await this.app.fileManager.renameFile(file, newPath);
    await this.refreshEntityIndex();
    new Notice(t('notice.movedToProject', { name: file.basename, project: project.name }));
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
    new Notice(t('notice.updatedRelationships', { name: file.basename }));
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
    const root = this.resolvedProjectPath();
    if (!root) {
      new Notice(t('notice.setProjectPath'));
      return;
    }

    // Ensure novalistRoot folder exists when set
    const novalistRoot = this.settings.novalistRoot;
    if (novalistRoot && !this.app.vault.getAbstractFileByPath(novalistRoot)) {
      await this.app.vault.createFolder(novalistRoot);
    }

    const folders = [
      root,
      `${root}/${this.settings.characterFolder}`,
      `${root}/${this.settings.locationFolder}`,
      `${root}/${this.settings.itemFolder}`,
      `${root}/${this.settings.loreFolder}`,
      `${root}/${this.settings.chapterFolder}`,
      `${root}/${this.settings.imageFolder}`,
    ];

    for (const folder of folders) {
      if (!this.app.vault.getAbstractFileByPath(folder)) {
        await this.app.vault.createFolder(folder);
      }
    }

    new Notice(t('notice.projectInitialized'));
  }

  getCharacterTemplate(templateId?: string): CharacterTemplate {
    const id = templateId ?? this.settings.activeCharacterTemplateId;
    return this.settings.characterTemplates.find(t => t.id === id)
      ?? this.settings.characterTemplates[0]
      ?? DEFAULT_CHARACTER_TEMPLATE;
  }

  getLocationTemplate(templateId?: string): LocationTemplate {
    const id = templateId ?? this.settings.activeLocationTemplateId;
    return this.settings.locationTemplates.find(t => t.id === id)
      ?? this.settings.locationTemplates[0]
      ?? DEFAULT_LOCATION_TEMPLATE;
  }

  getItemTemplate(templateId?: string): ItemTemplate {
    const id = templateId ?? this.settings.activeItemTemplateId;
    return this.settings.itemTemplates.find(t => t.id === id)
      ?? this.settings.itemTemplates[0]
      ?? DEFAULT_ITEM_TEMPLATE;
  }

  getLoreTemplate(templateId?: string): LoreTemplate {
    const id = templateId ?? this.settings.activeLoreTemplateId;
    return this.settings.loreTemplates.find(t => t.id === id)
      ?? this.settings.loreTemplates[0]
      ?? DEFAULT_LORE_TEMPLATE;
  }

  generateCharacterContent(name: string, surname: string, template: CharacterTemplate): string {
    const fullName = `${name} ${surname}`.trim();
    const lines: string[] = [
      `# ${fullName}`,
      '',
      '## CharacterSheet',
      `TemplateId: ${template.id}`,
      `Name: ${name}`,
      `Surname: ${surname}`,
    ];

    for (const field of template.fields) {
      lines.push(`${field.key}: ${field.defaultValue}`);
    }

    lines.push('');

    if (template.includeRelationships) {
      lines.push('Relationships:', '');
    }

    if (template.includeImages) {
      lines.push('Images:', '');
    }

    lines.push('CustomProperties:');
    for (const def of template.customPropertyDefs) {
      lines.push(`- ${def.key}: ${def.defaultValue}`);
    }
    lines.push('');

    lines.push('Sections:');
    for (const section of template.sections) {
      lines.push(section.title);
      if (section.defaultContent) {
        lines.push(section.defaultContent);
      }
      lines.push('---');
    }
    lines.push('');

    if (template.includeChapterOverrides) {
      lines.push('ChapterOverrides:');
    }

    return lines.join('\n');
  }

  generateLocationContent(name: string, description: string, template: LocationTemplate): string {
    const lines: string[] = [
      `# ${name}`,
      '',
      '## LocationSheet',
      `TemplateId: ${template.id}`,
      `Name: ${name}`,
    ];

    for (const field of template.fields) {
      if (field.key === 'Description') {
        lines.push('Description:');
        lines.push(description || field.defaultValue || '');
      } else {
        lines.push(`${field.key}: ${field.defaultValue}`);
      }
    }

    // If template doesn't have a Description field, add description inline if provided
    if (!template.fields.some(f => f.key === 'Description') && description) {
      lines.push('Description:');
      lines.push(description);
    }

    if (template.includeImages) {
      lines.push('Images:', '');
    }

    if (template.customPropertyDefs.length > 0) {
      lines.push('CustomProperties:');
      for (const def of template.customPropertyDefs) {
        lines.push(`- ${def.key}: ${def.defaultValue}`);
      }
    }

    if (template.sections.length > 0) {
      lines.push('Sections:');
      for (const section of template.sections) {
        lines.push(section.title);
        if (section.defaultContent) {
          lines.push(section.defaultContent);
        }
        lines.push('---');
      }
    }

    return lines.join('\n');
  }

  async createCharacter(name: string, surname: string, templateId?: string, useWorldBible?: boolean): Promise<void> {
    const root = useWorldBible && this.settings.worldBiblePath ? this.resolvedWorldBiblePath() : this.resolvedProjectPath();
    const folder = `${root}/${this.settings.characterFolder}`;
    const fileName = `${name} ${surname}`.trim();
    const path = `${folder}/${fileName}.md`;

    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice(t('notice.characterExists'));
      return;
    }

    const template = this.getCharacterTemplate(templateId);
    const content = this.generateCharacterContent(name, surname, template);

    await this.app.vault.create(path, content);
    new Notice(t('notice.characterCreated', { name: fileName }));
  }

  async createLocation(name: string, description: string, templateId?: string, useWorldBible?: boolean): Promise<void> {
    const root = useWorldBible && this.settings.worldBiblePath ? this.resolvedWorldBiblePath() : this.resolvedProjectPath();
    const folder = `${root}/${this.settings.locationFolder}`;
    const path = `${folder}/${name}.md`;

    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice(t('notice.locationExists'));
      return;
    }

    const template = this.getLocationTemplate(templateId);
    const content = this.generateLocationContent(name, description, template);

    await this.app.vault.create(path, content);
    new Notice(t('notice.locationCreated', { name }));
  }

  generateItemContent(name: string, description: string, template: ItemTemplate): string {
    const lines: string[] = [
      `# ${name}`,
      '',
      '## ItemSheet',
      `TemplateId: ${template.id}`,
      `Name: ${name}`,
    ];

    for (const field of template.fields) {
      if (field.key === 'Description') {
        lines.push('Description:');
        lines.push(description || field.defaultValue || '');
      } else {
        lines.push(`${field.key}: ${field.defaultValue}`);
      }
    }

    if (!template.fields.some(f => f.key === 'Description') && description) {
      lines.push('Description:');
      lines.push(description);
    }

    if (template.includeImages) {
      lines.push('Images:', '');
    }

    if (template.customPropertyDefs.length > 0) {
      lines.push('CustomProperties:');
      for (const def of template.customPropertyDefs) {
        lines.push(`- ${def.key}: ${def.defaultValue}`);
      }
    }

    if (template.sections.length > 0) {
      lines.push('Sections:');
      for (const section of template.sections) {
        lines.push(section.title);
        if (section.defaultContent) {
          lines.push(section.defaultContent);
        }
        lines.push('---');
      }
    }

    return lines.join('\n');
  }

  generateLoreContent(name: string, description: string, category: string, template: LoreTemplate): string {
    const lines: string[] = [
      `# ${name}`,
      '',
      '## LoreSheet',
      `TemplateId: ${template.id}`,
      `Name: ${name}`,
      `Category: ${category}`,
    ];

    for (const field of template.fields) {
      if (field.key === 'Description') {
        lines.push('Description:');
        lines.push(description || field.defaultValue || '');
      } else if (field.key !== 'Category') {
        lines.push(`${field.key}: ${field.defaultValue}`);
      }
    }

    if (!template.fields.some(f => f.key === 'Description') && description) {
      lines.push('Description:');
      lines.push(description);
    }

    if (template.includeImages) {
      lines.push('Images:', '');
    }

    if (template.customPropertyDefs.length > 0) {
      lines.push('CustomProperties:');
      for (const def of template.customPropertyDefs) {
        lines.push(`- ${def.key}: ${def.defaultValue}`);
      }
    }

    if (template.sections.length > 0) {
      lines.push('Sections:');
      for (const section of template.sections) {
        lines.push(section.title);
        if (section.defaultContent) {
          lines.push(section.defaultContent);
        }
        lines.push('---');
      }
    }

    return lines.join('\n');
  }

  async createItem(name: string, description: string, templateId?: string, useWorldBible?: boolean): Promise<void> {
    const root = useWorldBible && this.settings.worldBiblePath ? this.resolvedWorldBiblePath() : this.resolvedProjectPath();
    const folder = `${root}/${this.settings.itemFolder}`;
    const path = `${folder}/${name}.md`;

    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice(t('notice.itemExists'));
      return;
    }

    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }

    const template = this.getItemTemplate(templateId);
    const content = this.generateItemContent(name, description, template);

    await this.app.vault.create(path, content);
    new Notice(t('notice.itemCreated', { name }));
  }

  async createLore(name: string, description: string, category: string, templateId?: string, useWorldBible?: boolean): Promise<void> {
    const root = useWorldBible && this.settings.worldBiblePath ? this.resolvedWorldBiblePath() : this.resolvedProjectPath();
    const folder = `${root}/${this.settings.loreFolder}`;
    const path = `${folder}/${name}.md`;

    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice(t('notice.loreExists'));
      return;
    }

    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }

    const template = this.getLoreTemplate(templateId);
    const content = this.generateLoreContent(name, description, category, template);

    await this.app.vault.create(path, content);
    new Notice(t('notice.loreCreated', { name }));
  }

  async createChapter(name: string, order: string): Promise<void> {
    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.chapterFolder}`;
    const path = `${folder}/${name}.md`;

    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice(t('notice.chapterExists'));
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
    new Notice(t('notice.chapterCreated', { name }));
  }

  async createScene(chapterFile: TFile, sceneName: string): Promise<void> {
    const content = await this.app.vault.read(chapterFile);
    const newScene = `\n\n## ${sceneName}\n\n`;
    await this.app.vault.modify(chapterFile, content + newScene);
    new Notice(t('notice.sceneCreated', { name: sceneName }));
  }

  getScenesForChapter(file: TFile): string[] {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.headings) return [];
    return cache.headings
      .filter(h => h.level === 2)
      .map(h => h.heading);
  }

  async getScenesForChapterAsync(file: TFile): Promise<string[]> {
    const content = await this.app.vault.read(file);
    const scenes: string[] = [];
    const regex = /^##\s+(.+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      scenes.push(match[1].trim());
    }
    return scenes;
  }

  getCurrentSceneForLine(file: TFile, line: number): string | null {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.headings) return null;
    const h2s = cache.headings.filter(h => h.level === 2);
    if (h2s.length === 0) return null;

    // Find the last H2 whose line is <= the cursor line (0-based positions)
    let currentScene: string | null = null;
    for (const h of h2s) {
      if (h.position.start.line <= line) {
        currentScene = h.heading;
      } else {
        break;
      }
    }
    return currentScene;
  }

  getSceneDataForChapter(file: TFile): SceneData[] {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.headings) return [];
    const chapterId = this.getChapterIdForFileSync(file);
    const chapterName = this.getChapterNameForFileSync(file);
    return cache.headings
      .filter(h => h.level === 2)
      .map(h => ({
        name: h.heading,
        chapterId,
        chapterName,
        file
      }));
  }

  async openSceneInFile(file: TFile, sceneName: string): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType('markdown')
      .find((leaf) => (leaf.view as MarkdownView).file?.path === file.path);

    const leaf = existingLeaf ?? this.app.workspace.getLeaf(true);
    await leaf.openFile(file);
    await this.app.workspace.revealLeaf(leaf);

    const cache = this.app.metadataCache.getFileCache(file);
    if (cache?.headings) {
      const heading = cache.headings.find(h => h.level === 2 && h.heading === sceneName);
      if (heading) {
        const view = leaf.view;
        if (view instanceof MarkdownView) {
          view.editor.setCursor({ line: heading.position.start.line, ch: 0 });
          view.editor.scrollIntoView({
            from: { line: heading.position.start.line, ch: 0 },
            to: { line: heading.position.start.line, ch: 0 }
          }, true);
        }
      }
    }
  }

  openCharacterModal(): void {
    new CharacterModal(this.app, this).open();
  }

  openLocationModal(): void {
    new LocationModal(this.app, this).open();
  }

  openItemModal(): void {
    new ItemModal(this.app, this).open();
  }

  openLoreModal(): void {
    new LoreModal(this.app, this).open();
  }

  openChapterDescriptionModal(existing?: ChapterEditData, onSave?: (data: ChapterEditData) => void): void {
    new ChapterDescriptionModal(this.app, this, existing, onSave).open();
  }

  promptSceneName(chapterFile: TFile): void {
    const modal = new SceneNameModal(this.app, (data) => {
      void this.createScene(chapterFile, data.name).then(async () => {
        if (data.date) {
          await this.setSceneDate(chapterFile, data.name, data.date);
        }
      });
    });
    modal.open();
  }

  // ─── Act management ──────────────────────────────────────────────

  /** Get all unique act names across chapter files, preserving order. */
  getActNames(): string[] {
    const chapters = this.getChapterDescriptionsSync();
    const seen = new Set<string>();
    const acts: string[] = [];
    for (const ch of chapters) {
      if (ch.act && !seen.has(ch.act)) {
        seen.add(ch.act);
        acts.push(ch.act);
      }
    }
    return acts;
  }

  /** Get the act name for a chapter file (from frontmatter). */
  getActForFileSync(file: TFile): string {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    return typeof fm?.act === 'string' ? fm.act.trim() : '';
  }

  /** Assign a chapter to an act by updating its frontmatter. */
  async assignChapterToAct(file: TFile, actName: string): Promise<void> {
    const content = await this.app.vault.read(file);
    const { frontmatter, body } = this.extractFrontmatterAndBody(content);
    frontmatter.act = actName;
    const next = this.serializeFrontmatter(frontmatter);
    await this.app.vault.modify(file, next + body);
    new Notice(t('notice.chapterAssignedToAct', { name: actName }));
  }

  /** Remove a chapter from its act. */
  async removeChapterFromAct(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const { frontmatter, body } = this.extractFrontmatterAndBody(content);
    delete frontmatter.act;
    const next = this.serializeFrontmatter(frontmatter);
    await this.app.vault.modify(file, next + body);
    new Notice(t('notice.chapterRemovedFromAct'));
  }

  /** Rename an act across all chapter files that reference it. */
  async renameAct(oldName: string, newName: string): Promise<void> {
    const chapters = await this.getChapterDescriptions();
    for (const ch of chapters) {
      if (ch.act === oldName) {
        const content = await this.app.vault.read(ch.file);
        const { frontmatter, body } = this.extractFrontmatterAndBody(content);
        frontmatter.act = newName;
        const next = this.serializeFrontmatter(frontmatter);
        await this.app.vault.modify(ch.file, next + body);
      }
    }
  }

  /** Delete an act by removing the act field from all chapters in it. */
  async deleteAct(actName: string): Promise<void> {
    const chapters = await this.getChapterDescriptions();
    for (const ch of chapters) {
      if (ch.act === actName) {
        await this.removeChapterFromAct(ch.file);
      }
    }
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
        templateId: sheetData.templateId || undefined,
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

  parseCharacterSheetForSidebar(content: string): { name: string; surname: string; gender: string; age: string; role: string; templateId: string; customProperties: Record<string, string> } | null {
    const sheetLines = this.getSectionLines(content, 'CharacterSheet');
    if (sheetLines.length === 0) return null;
    
    const sheetContent = sheetLines.join('\n');
    
    const parseField = (fieldName: string): string => {
      const pattern = new RegExp(`^[ \\t]*${fieldName}:[ \\t]*(.*?)$`, 'm');
      const match = sheetContent.match(pattern);
      if (!match) return '';
      const value = match[1].trim();
      // Check for corrupted data
      // Images: is a section, not a field.
      const knownFields = ['Name:', 'Surname:', 'Gender:', 'Age:', 'Role:', 'FaceShot:', 'EyeColor:', 'HairColor:', 'HairLength:', 'Height:', 'Build:', 'SkinTone:', 'DistinguishingFeatures:', 'Relationships:', 'Images:', 'CustomProperties:', 'Sections:', 'ChapterOverrides:', 'TemplateId:'];
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
      templateId: parseField('TemplateId'),
      customProperties
    };
  }

  parseCharacterSheetChapterOverrides(content: string): Array<{ chapter: string; act?: string; scene?: string; overrides: Record<string, string>; info: string; customProperties?: Record<string, string> }> {
    const sheetLines = this.getSectionLines(content, 'CharacterSheet');
    if (sheetLines.length === 0) return [];
    
    const sheetContent = sheetLines.join('\n');
    const chapterOverridesIdx = sheetContent.indexOf('\nChapterOverrides:');
    if (chapterOverridesIdx === -1) return [];
    
    const chapterText = sheetContent.substring(chapterOverridesIdx + '\nChapterOverrides:'.length);
    const results: Array<{ chapter: string; act?: string; scene?: string; overrides: Record<string, string>; info: string; customProperties?: Record<string, string> }> = [];
    
    // Split by "Chapter: " to get individual chapter blocks
    const chapterBlocks = chapterText.split(/\nChapter:[ \t]*/).filter(Boolean);
    
    for (const block of chapterBlocks) {
      const lines = block.split('\n');
      const chapter = lines[0].trim();
      const overrides: Record<string, string> = {};
      const customProperties: Record<string, string> = {};
      let scene: string | undefined;
      let act: string | undefined;
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Check for simple property lines: - Property: value
        const simpleMatch = line.match(/^[-*]\s*(.+?)\s*:\s*(.*)$/);
        if (simpleMatch) {
          const key = simpleMatch[1].trim().toLowerCase();
          const value = simpleMatch[2].trim();
          
          if (key === 'scene') {
            scene = value;
            continue;
          }
          
          if (key === 'act') {
            act = value;
            continue;
          }
          
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
      

      if (chapter || act) {
        results.push({ chapter, act, scene, overrides, info: '', customProperties });
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

  async getChapterDescriptions(): Promise<Array<{ id: string; name: string; order: number; status: ChapterStatus; act: string; date: string; file: TFile; scenes: string[] }>> {
    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.chapterFolder}/`;
    const files = this.app.vault.getFiles().filter((f) => f.path.startsWith(folder) && f.extension === 'md');

    const chapters: Array<{ id: string; name: string; order: number; status: ChapterStatus; act: string; date: string; file: TFile; scenes: string[] }> = [];
    for (const file of files) {
      const content = await this.app.vault.read(file);
      const { frontmatter, body } = this.extractFrontmatterAndBody(content);
      const guid = typeof frontmatter.guid === 'string' && frontmatter.guid.trim()
        ? frontmatter.guid.trim()
        : file.basename;
      const title = this.extractTitle(body) || file.basename;
      const status = (frontmatter.status as ChapterStatus) || 'outline';
      const act = typeof frontmatter.act === 'string' ? frontmatter.act.trim() : '';
      const date = typeof frontmatter.date === 'string' ? frontmatter.date.trim() : '';
      const scenes = await this.getScenesForChapterAsync(file);
      chapters.push({
        id: guid,
        name: title,
        order: Number(frontmatter.order) || 999,
        status,
        act,
        date,
        file,
        scenes
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
      file: chapter.file,
      scenes: this.getScenesForChapter(chapter.file)
    }));
  }

  getChapterDescriptionsSync(): Array<{ id: string; name: string; order: number; status: ChapterStatus; act: string; date: string; file: TFile; scenes: string[] }> {
    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.chapterFolder}/`;
    const files = this.app.vault.getFiles().filter((f) => f.path.startsWith(folder) && f.extension === 'md');

    const chapters: Array<{ id: string; name: string; order: number; status: ChapterStatus; act: string; date: string; file: TFile; scenes: string[] }> = [];
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter || {};
      const heading = cache?.headings?.find(h => h.level === 1)?.heading;
      const status = (frontmatter.status as ChapterStatus) || 'outline';
      const act = typeof frontmatter.act === 'string' ? frontmatter.act.trim() : '';
      const date = typeof frontmatter.date === 'string' ? frontmatter.date.trim() : '';
      const scenes = this.getScenesForChapter(file);
      chapters.push({
        id: typeof frontmatter.guid === 'string' && frontmatter.guid.trim() ? frontmatter.guid.trim() : file.basename,
        name: heading || file.basename,
        order: Number(frontmatter.order) || 999,
        status,
        act,
        date,
        file,
        scenes
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

  async updateChapterStatus(file: TFile, status: ChapterStatus): Promise<void> {
    const content = await this.app.vault.read(file);
    const { frontmatter, body } = this.extractFrontmatterAndBody(content);
    frontmatter.status = status;
    const nextFrontmatter = this.serializeFrontmatter(frontmatter);
    await this.app.vault.modify(file, nextFrontmatter + body);
  }

  /** Update multiple frontmatter fields on a chapter file found by name. */
  async updateChapterMetadata(chapterName: string, fields: Record<string, string>): Promise<void> {
    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.chapterFolder}`;
    const path = `${folder}/${chapterName}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    await this.updateChapterFrontmatter(file, fields);
  }

  /** Update arbitrary frontmatter fields on a chapter file. */
  async updateChapterFrontmatter(file: TFile, fields: Record<string, string>): Promise<void> {
    const content = await this.app.vault.read(file);
    const { frontmatter, body } = this.extractFrontmatterAndBody(content);
    for (const [key, value] of Object.entries(fields)) {
      if (value) {
        frontmatter[key] = value;
      } else {
        delete frontmatter[key];
      }
    }
    const next = this.serializeFrontmatter(frontmatter);
    await this.app.vault.modify(file, next + body);
  }

  /** Get the date assigned to a chapter (from frontmatter). */
  getChapterDateSync(file: TFile): string {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    return typeof fm?.date === 'string' ? fm.date.trim() : '';
  }

  /** Get the date for a specific scene within a chapter. Falls back to the chapter date. */
  getSceneDateSync(file: TFile, sceneName: string): string {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (fm?.sceneDates && typeof fm.sceneDates === 'object') {
      const sd = fm.sceneDates as Record<string, string>;
      if (typeof sd[sceneName] === 'string' && sd[sceneName].trim()) {
        return sd[sceneName].trim();
      }
    }
    // Fall back to chapter date
    return typeof fm?.date === 'string' ? fm.date.trim() : '';
  }

  /** Set the date for a specific scene (stored in frontmatter sceneDates map). */
  async setSceneDate(file: TFile, sceneName: string, date: string): Promise<void> {
    const content = await this.app.vault.read(file);
    const { frontmatter, body } = this.extractFrontmatterAndBody(content);
    if (!frontmatter.sceneDates || typeof frontmatter.sceneDates !== 'object') {
      (frontmatter as Record<string, unknown>).sceneDates = {};
    }
    const sceneDates = (frontmatter as Record<string, Record<string, string>>).sceneDates;
    if (date) {
      sceneDates[sceneName] = date;
    } else {
      delete sceneDates[sceneName];
    }
    const next = this.serializeFrontmatter(frontmatter);
    await this.app.vault.modify(file, next + body);
  }

  /** Get the date for a chapter/scene by IDs (used by character sheet). */
  getDateForChapterScene(chapterId: string, sceneName?: string | null): string {
    const chapters = this.getChapterDescriptionsSync();
    const chapter = chapters.find(ch => ch.id === chapterId);
    if (!chapter) return '';
    if (sceneName) {
      return this.getSceneDateSync(chapter.file, sceneName);
    }
    return chapter.date;
  }

  detectCharacterRole(content: string, frontmatter: Record<string, string>): string {
      let role = frontmatter.role;
      if (!role) {
         const sheetLines = this.getSectionLines(content, 'CharacterSheet');
         if (sheetLines.length > 0) {
           const sheetContent = sheetLines.join('\n');
           const match = sheetContent.match(/^[ \t]*Role:[ \t]*(.*?)$/m);
           if (match) role = match[1].trim();
         }
      }
      if (!role) return '';
      return normalizeCharacterRole(role);
  }

  async getCharacterList(): Promise<CharacterListData[]> {
    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.characterFolder}/`;
    const wb = this.resolvedWorldBiblePath();
    const wbFolder = wb ? `${wb}/${this.settings.characterFolder}/` : '';
    const files = this.app.vault.getFiles().filter((f) =>
      (f.path.startsWith(folder) || (wbFolder && f.path.startsWith(wbFolder))) && f.extension === 'md'
    );

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
    
    new Notice(t('notice.updatedRole', { name: file.basename, role: trimmedRole || t('general.unassigned') }));
  }

  serializeFrontmatter(fm: Record<string, string | number | Record<string, string>>): string {
      const lines: string[] = [];
      for (const [k, v] of Object.entries(fm)) {
        if (v !== null && typeof v === 'object') {
          const entries = Object.entries(v);
          if (entries.length === 0) continue;
          lines.push(`${k}:`);
          for (const [subK, subV] of entries) {
            lines.push(`  ${subK}: ${String(subV)}`);
          }
        } else {
          const scalar = v as string | number;
          lines.push(`${k}: ${String(scalar)}`);
        }
      }
      return `---\n${lines.join('\n')}\n---\n`;
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
    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.locationFolder}/`;
    const wb = this.resolvedWorldBiblePath();
    const wbFolder = wb ? `${wb}/${this.settings.locationFolder}/` : '';
    const files = this.app.vault.getFiles().filter((f) =>
      (f.path.startsWith(folder) || (wbFolder && f.path.startsWith(wbFolder))) && f.extension === 'md'
    );

    return files.map((file) => ({
      name: file.basename,
      file
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  getItemList(): ItemListData[] {
    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.itemFolder}/`;
    const wb = this.resolvedWorldBiblePath();
    const wbFolder = wb ? `${wb}/${this.settings.itemFolder}/` : '';
    const files = this.app.vault.getFiles().filter((f) =>
      (f.path.startsWith(folder) || (wbFolder && f.path.startsWith(wbFolder))) && f.extension === 'md'
    );

    return files.map((file) => ({
      name: file.basename,
      file,
      type: ''
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  getLoreList(): LoreListData[] {
    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.loreFolder}/`;
    const wb = this.resolvedWorldBiblePath();
    const wbFolder = wb ? `${wb}/${this.settings.loreFolder}/` : '';
    const files = this.app.vault.getFiles().filter((f) =>
      (f.path.startsWith(folder) || (wbFolder && f.path.startsWith(wbFolder))) && f.extension === 'md'
    );

    return files.map((file) => ({
      name: file.basename,
      file,
      category: ''
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

  async parseChapterFile(file: TFile): Promise<{ characters: string[]; locations: string[]; items: string[]; lore: string[] }> {
    const content = await this.app.vault.read(file);
    const body = this.stripFrontmatter(content);
    
    const mentions = this.scanMentions(body);

    return {
      characters: mentions.characters,
      locations: mentions.locations,
      items: mentions.items,
      lore: mentions.lore
    };
  }

  scanMentions(content: string): { characters: string[]; locations: string[]; items: string[]; lore: string[] } {
    const characters: Set<string> = new Set();
    const locations: Set<string> = new Set();
    const items: Set<string> = new Set();
    const lore: Set<string> = new Set();
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
        const charFolder = this.settings.characterFolder;
        if (info.path.includes(`/${charFolder}/`) || info.path.startsWith(charFolder + '/')) characters.add(name);
        const locFolder = this.settings.locationFolder;
        if (info.path.includes(`/${locFolder}/`) || info.path.startsWith(locFolder + '/')) locations.add(name);
        const itemFolder = this.settings.itemFolder;
        if (info.path.includes(`/${itemFolder}/`) || info.path.startsWith(itemFolder + '/')) items.add(name);
        const loreFolder = this.settings.loreFolder;
        if (info.path.includes(`/${loreFolder}/`) || info.path.startsWith(loreFolder + '/')) lore.add(name);
      }
    }

    return { characters: Array.from(characters), locations: Array.from(locations), items: Array.from(items), lore: Array.from(lore) };
  }

  parseFrontmatter(content: string): Record<string, string | Record<string, string>> {
    const normalized = content.replace(/\r\n/g, '\n');
    const match = normalized.match(/^---\n([\s\S]+?)\n---/);
    if (!match) return {};

    const fm: Record<string, string | Record<string, string>> = {};
    const lines = match[1].split('\n');
    let currentKey: string | null = null;
    for (const line of lines) {
      // Indented line — belongs to current nested object
      if (/^\s{2,}/.test(line) && currentKey !== null) {
        const parts = line.split(':');
        if (parts.length >= 2) {
          const subKey = parts[0].trim();
          const subVal = parts.slice(1).join(':').trim();
          if (subKey) {
            if (typeof fm[currentKey] !== 'object') {
              fm[currentKey] = {};
            }
            (fm[currentKey] as Record<string, string>)[subKey] = subVal;
          }
        }
        continue;
      }
      // Top-level line
      currentKey = null;
      const parts = line.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join(':').trim();
        if (value === '') {
          // Possible nested object starts on next lines
          currentKey = key;
          fm[key] = {};
        } else {
          fm[key] = value;
        }
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
    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.characterFolder}`;
    const path = `${folder}/${cleanName}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return file;

    // Also check World Bible
    const wb = this.resolvedWorldBiblePath();
    if (wb) {
      const wbPath = `${wb}/${this.settings.characterFolder}/${cleanName}.md`;
      const wbFile = this.app.vault.getAbstractFileByPath(wbPath);
      if (wbFile instanceof TFile) return wbFile;
    }

    return null;
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
    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.locationFolder}`;
    const path = `${folder}/${cleanName}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return file;

    // Also check World Bible
    const wb = this.resolvedWorldBiblePath();
    if (wb) {
      const wbPath = `${wb}/${this.settings.locationFolder}/${cleanName}.md`;
      const wbFile = this.app.vault.getAbstractFileByPath(wbPath);
      if (wbFile instanceof TFile) return wbFile;
    }

    return null;
  }

  findItemFile(name: string): TFile | null {
    let cleanName = name.replace(/^\[{2}/, '').replace(/\]{2}$/, '').split('|')[0].trim();

    const info = this.entityIndex.get(cleanName);
    if (info && info.path.includes(this.settings.itemFolder)) {
      const file = this.app.vault.getAbstractFileByPath(info.path);
      if (file instanceof TFile) return file;
    }

    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.itemFolder}`;
    const path = `${folder}/${cleanName}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return file;

    const wb = this.resolvedWorldBiblePath();
    if (wb) {
      const wbPath = `${wb}/${this.settings.itemFolder}/${cleanName}.md`;
      const wbFile = this.app.vault.getAbstractFileByPath(wbPath);
      if (wbFile instanceof TFile) return wbFile;
    }

    return null;
  }

  findLoreFile(name: string): TFile | null {
    let cleanName = name.replace(/^\[{2}/, '').replace(/\]{2}$/, '').split('|')[0].trim();

    const info = this.entityIndex.get(cleanName);
    if (info && info.path.includes(this.settings.loreFolder)) {
      const file = this.app.vault.getAbstractFileByPath(info.path);
      if (file instanceof TFile) return file;
    }

    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.loreFolder}`;
    const path = `${folder}/${cleanName}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return file;

    const wb = this.resolvedWorldBiblePath();
    if (wb) {
      const wbPath = `${wb}/${this.settings.loreFolder}/${cleanName}.md`;
      const wbFile = this.app.vault.getAbstractFileByPath(wbPath);
      if (wbFile instanceof TFile) return wbFile;
    }

    return null;
  }

  async parseItemFile(file: TFile): Promise<{ name: string; type: string; description: string }> {
    const content = await this.app.vault.read(file);
    const body = this.stripFrontmatter(content);
    const typeLines = this.getSectionLines(body, 'Type');
    const descLines = this.getSectionLines(body, 'Description');
    return {
      name: file.basename,
      type: typeLines.join('\n').trim(),
      description: descLines.join('\n').trim()
    };
  }

  async parseLoreFile(file: TFile): Promise<{ name: string; category: string; description: string }> {
    const content = await this.app.vault.read(file);
    const body = this.stripFrontmatter(content);
    const catLines = this.getSectionLines(body, 'Category');
    const descLines = this.getSectionLines(body, 'Description');
    return {
      name: file.basename,
      category: catLines.join('\n').trim(),
      description: descLines.join('\n').trim()
    };
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

    const root = this.resolvedProjectPath();
    if (!root) return;

    const charFolder = `${root}/${this.settings.characterFolder}`;
    const locFolder = `${root}/${this.settings.locationFolder}`;
    const itemFolder = `${root}/${this.settings.itemFolder}`;
    const loreFolder = `${root}/${this.settings.loreFolder}`;

    // Also scan World Bible folders
    const wb = this.resolvedWorldBiblePath();
    const wbCharFolder = wb ? `${wb}/${this.settings.characterFolder}` : '';
    const wbLocFolder = wb ? `${wb}/${this.settings.locationFolder}` : '';
    const wbItemFolder = wb ? `${wb}/${this.settings.itemFolder}` : '';
    const wbLoreFolder = wb ? `${wb}/${this.settings.loreFolder}` : '';

    const files = this.app.vault.getFiles();
    
    for (const file of files) {
        const isChar = file.path.startsWith(charFolder) || (wbCharFolder && file.path.startsWith(wbCharFolder));
        const isLoc = file.path.startsWith(locFolder) || (wbLocFolder && file.path.startsWith(wbLocFolder));
        const isItem = file.path.startsWith(itemFolder) || (wbItemFolder && file.path.startsWith(wbItemFolder));
        const isLore = file.path.startsWith(loreFolder) || (wbLoreFolder && file.path.startsWith(wbLoreFolder));

        if (isChar || isLoc || isItem || isLore) {
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

  extractFrontmatterAndBody(content: string): { frontmatter: Record<string, string | Record<string, string>>; body: string } {
    const fm = this.parseFrontmatter(content);
    const body = this.stripFrontmatter(content);
    return { frontmatter: fm, body };
  }

  isChapterFile(file: TFile): boolean {
    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.chapterFolder}/`;
    return file.path.startsWith(folder);
  }

  isChapterPath(path: string): boolean {
      const root = this.resolvedProjectPath();
      if (!root) return false;
      const folder = `${root}/${this.settings.chapterFolder}/`;
      return path.startsWith(folder);
  }

  isTemplateFile(file: TFile): boolean {
    const root = this.resolvedProjectPath();
    const folder = `${root}/Templates/`;
    return file.path.startsWith(folder);
  }

  isCharacterFile(file: TFile): boolean {
    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.characterFolder}/`;
    if (file.path.startsWith(folder) && file.extension === 'md') return true;
    const wb = this.resolvedWorldBiblePath();
    if (wb) {
      const wbFolder = `${wb}/${this.settings.characterFolder}/`;
      if (file.path.startsWith(wbFolder) && file.extension === 'md') return true;
    }
    return false;
  }

  isLocationFile(file: TFile): boolean {
    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.locationFolder}/`;
    if (file.path.startsWith(folder) && file.extension === 'md') return true;
    const wb = this.resolvedWorldBiblePath();
    if (wb) {
      const wbFolder = `${wb}/${this.settings.locationFolder}/`;
      if (file.path.startsWith(wbFolder) && file.extension === 'md') return true;
    }
    return false;
  }

  isItemFile(file: TFile): boolean {
    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.itemFolder}/`;
    if (file.path.startsWith(folder) && file.extension === 'md') return true;
    const wb = this.resolvedWorldBiblePath();
    if (wb) {
      const wbFolder = `${wb}/${this.settings.itemFolder}/`;
      if (file.path.startsWith(wbFolder) && file.extension === 'md') return true;
    }
    return false;
  }

  isLoreFile(file: TFile): boolean {
    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.loreFolder}/`;
    if (file.path.startsWith(folder) && file.extension === 'md') return true;
    const wb = this.resolvedWorldBiblePath();
    if (wb) {
      const wbFolder = `${wb}/${this.settings.loreFolder}/`;
      if (file.path.startsWith(wbFolder) && file.extension === 'md') return true;
    }
    return false;
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

  async openItemSheet(file: TFile, targetLeaf?: WorkspaceLeaf): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(ITEM_SHEET_VIEW_TYPE)
      .find((leaf) => leaf.view instanceof ItemSheetView && leaf.view.file?.path === file.path);

    if (existingLeaf) {
      void this.app.workspace.revealLeaf(existingLeaf);
      return;
    }

    const leaf = targetLeaf ?? this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: ITEM_SHEET_VIEW_TYPE,
      state: { file: file.path }
    });
    void this.app.workspace.revealLeaf(leaf);
  }

  async openLoreSheet(file: TFile, targetLeaf?: WorkspaceLeaf): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(LORE_SHEET_VIEW_TYPE)
      .find((leaf) => leaf.view instanceof LoreSheetView && leaf.view.file?.path === file.path);

    if (existingLeaf) {
      void this.app.workspace.revealLeaf(existingLeaf);
      return;
    }

    const leaf = targetLeaf ?? this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: LORE_SHEET_VIEW_TYPE,
      state: { file: file.path }
    });
    void this.app.workspace.revealLeaf(leaf);
  }

  async activateImageGalleryView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(IMAGE_GALLERY_VIEW_TYPE);
    if (existing.length > 0) {
      void this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: IMAGE_GALLERY_VIEW_TYPE,
      active: true
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
        let entityType: 'character' | 'location' | 'item' | 'lore' = 'location';
        if (info.path.includes(`/${this.settings.characterFolder}/`)) entityType = 'character';
        else if (info.path.includes(`/${this.settings.itemFolder}/`)) entityType = 'item';
        else if (info.path.includes(`/${this.settings.loreFolder}/`)) entityType = 'lore';
        return { display: info.display, type: entityType };
      },
      getEntityPeekData: async (name: string): Promise<EntityPeekData | null> => {
        const info = this.entityIndex.get(name);
        if (!info) return null;
        const file = this.app.vault.getAbstractFileByPath(info.path);
        if (!(file instanceof TFile)) return null;
        let entityType: 'character' | 'location' | 'item' | 'lore' = 'location';
        if (info.path.includes(`/${this.settings.characterFolder}/`)) entityType = 'character';
        else if (info.path.includes(`/${this.settings.itemFolder}/`)) entityType = 'item';
        else if (info.path.includes(`/${this.settings.loreFolder}/`)) entityType = 'lore';

        const content = await this.app.vault.cachedRead(file);

        if (entityType === 'character') {
          const sheet = this.parseCharacterSheetForSidebar(content);
          if (!sheet) return null;

          // Determine active chapter context
          const activeFile = this.app.workspace.getActiveFile();
          const inChapter = activeFile && this.isChapterFile(activeFile);
          const chapterId = inChapter ? this.getChapterIdForFile(activeFile) : '';
          const chapterName = inChapter ? this.getChapterNameForFile(activeFile) : '';

          // Determine active scene context
          let currentScene: string | null = null;
          if (inChapter) {
            const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (mdView?.editor) {
              const cursorLine = mdView.editor.getCursor().line;
              currentScene = this.getCurrentSceneForLine(activeFile, cursorLine);
            }
          }

          // Determine active act context
          const currentAct = inChapter ? this.getActForFileSync(activeFile) : '';

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
            // Scene > Chapter > Act cascade
            let match = currentScene
              ? overrides.find(o => (o.chapter === chapterId || o.chapter === chapterName) && o.scene === currentScene)
              : undefined;
            if (!match) {
              match = overrides.find(
                o => (o.chapter === chapterId || o.chapter === chapterName) && !o.scene && !o.act
              );
            }
            if (!match && currentAct) {
              match = overrides.find(
                o => o.act === currentAct && !o.chapter && !o.scene
              );
            }
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

          // Compute age from birthdate when template uses date mode
          {
            const charTemplate = this.getCharacterTemplate(sheet.templateId);
            if (charTemplate.ageMode === 'date' && displayAge && inChapter) {
              const chapterDate = this.getDateForChapterScene(chapterId, currentScene);
              if (chapterDate) {
                const interval = computeInterval(displayAge, chapterDate, charTemplate.ageIntervalUnit ?? 'years');
                if (interval !== null && interval >= 0) {
                  displayAge = String(interval);
                }
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

          // Resolve physical attributes with chapter/scene/act overrides
          // Try both chapter name and chapter ID since overrides may be stored by either
          let effectiveSheet = charSheet;
          if (inChapter) {
            // Scene > Chapter > Act cascade
            let hasOverride = currentScene
              ? charSheet.chapterOverrides.find(
                  o => (o.chapter === chapterName || o.chapter === chapterId) && o.scene === currentScene
                )
              : undefined;
            if (!hasOverride) {
              hasOverride = charSheet.chapterOverrides.find(
                o => (o.chapter === chapterName || o.chapter === chapterId) && !o.scene && !o.act
              );
            }
            if (!hasOverride && currentAct) {
              hasOverride = charSheet.chapterOverrides.find(
                o => o.act === currentAct && !o.chapter && !o.scene
              );
            }
            if (hasOverride) {
              effectiveSheet = applyChapterOverride(charSheet, hasOverride.chapter, hasOverride.scene, undefined, hasOverride.act);
            }
          }

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
            eyeColor: effectiveSheet.eyeColor,
            hairColor: effectiveSheet.hairColor,
            hairLength: effectiveSheet.hairLength,
            height: effectiveSheet.height,
            build: effectiveSheet.build,
            skinTone: effectiveSheet.skinTone,
            distinguishingFeatures: effectiveSheet.distinguishingFeatures,
            sections: charSheet.sections.map(s => ({ title: s.title, content: s.content }))
          };
        } else if (entityType === 'item') {
          const itemSheet = parseItemSheet(content);

          return {
            type: 'item',
            name: itemSheet.name || file.basename,
            entityFilePath: file.path,
            images: itemSheet.images.map(i => ({ name: i.name, path: i.path })),
            itemType: itemSheet.type,
            origin: itemSheet.origin,
            description: itemSheet.description,
            customProperties: itemSheet.customProperties,
            sections: itemSheet.sections.map(s => ({ title: s.title, content: s.content }))
          };
        } else if (entityType === 'lore') {
          const loreSheet = parseLoreSheet(content);

          return {
            type: 'lore',
            name: loreSheet.name || file.basename,
            entityFilePath: file.path,
            images: loreSheet.images.map(i => ({ name: i.name, path: i.path })),
            loreCategory: loreSheet.category,
            description: loreSheet.description,
            customProperties: loreSheet.customProperties,
            sections: loreSheet.sections.map(s => ({ title: s.title, content: s.content }))
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
    const charFolder = `${this.resolvedProjectPath()}/${this.settings.characterFolder}/`;
    const wb = this.resolvedWorldBiblePath();
    const wbCharFolder = wb ? `${wb}/${this.settings.characterFolder}/` : '';
    const characterCount = this.app.vault.getFiles()
      .filter(f => (f.path.startsWith(charFolder) || (wbCharFolder && f.path.startsWith(wbCharFolder))) && f.extension === 'md')
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

        // Calculate per-scene word counts
        const scenes: SceneOverviewStat[] = [];
        const h2Regex = /^##\s+(.+)$/gm;
        let h2Match: RegExpExecArray | null;
        const h2Positions: Array<{ name: string; start: number }> = [];
        while ((h2Match = h2Regex.exec(content)) !== null) {
          h2Positions.push({ name: h2Match[1], start: h2Match.index });
        }
        if (h2Positions.length > 0) {
          for (let i = 0; i < h2Positions.length; i++) {
            const start = h2Positions[i].start;
            const end = i + 1 < h2Positions.length ? h2Positions[i + 1].start : content.length;
            const sceneContent = content.slice(start, end);
            scenes.push({ name: h2Positions[i].name, words: countWords(sceneContent) });
          }
        }

        chapterStats.push({
          name: ch.name,
          words,
          readability: readability.score > 0 ? readability : null,
          scenes: scenes.length > 0 ? scenes : undefined
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
    new Notice(t('notice.commentAdded'));
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

  // ─── Property Filter (Explorer) ──────────────────────────────────

  /**
   * Search characters whose built-in or custom properties match a key:value filter.
   * Returns the subset of CharacterListData items that match.
   */
  async filterCharactersByProperty(filterKey: string, filterValue: string): Promise<Set<string>> {
    const matchingPaths = new Set<string>();
    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.characterFolder}/`;
    const wb = this.resolvedWorldBiblePath();
    const wbFolder = wb ? `${wb}/${this.settings.characterFolder}/` : '';
    const files = this.app.vault.getFiles().filter((f) =>
      (f.path.startsWith(folder) || (wbFolder && f.path.startsWith(wbFolder))) && f.extension === 'md'
    );

    const keyLower = filterKey.toLowerCase().trim();
    const valueLower = filterValue.toLowerCase().trim();

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const sheetData = this.parseCharacterSheetForSidebar(content);
      if (!sheetData) continue;

      // Check built-in fields
      const builtInMap: Record<string, string> = {
        name: sheetData.name,
        surname: sheetData.surname,
        gender: sheetData.gender,
        age: sheetData.age,
        role: sheetData.role,
      };

      // Also check physical attributes from the full sheet
      const fullSheet = parseCharacterSheet(content);
      if (fullSheet) {
        builtInMap['eyecolor'] = fullSheet.eyeColor;
        builtInMap['eye color'] = fullSheet.eyeColor;
        builtInMap['haircolor'] = fullSheet.hairColor;
        builtInMap['hair color'] = fullSheet.hairColor;
        builtInMap['hairlength'] = fullSheet.hairLength;
        builtInMap['hair length'] = fullSheet.hairLength;
        builtInMap['height'] = fullSheet.height;
        builtInMap['build'] = fullSheet.build;
        builtInMap['skintone'] = fullSheet.skinTone;
        builtInMap['skin tone'] = fullSheet.skinTone;
        builtInMap['distinguishingfeatures'] = fullSheet.distinguishingFeatures;
        builtInMap['distinguishing features'] = fullSheet.distinguishingFeatures;

        // Merge custom properties from full sheet
        if (fullSheet.customProperties) {
          for (const [k, v] of Object.entries(fullSheet.customProperties)) {
            builtInMap[k.toLowerCase()] = v;
          }
        }
      }

      // Also merge custom properties from sidebar parsing
      if (sheetData.customProperties) {
        for (const [k, v] of Object.entries(sheetData.customProperties)) {
          builtInMap[k.toLowerCase()] = v;
        }
      }

      // Match: if value is empty, match any entity that has the key non-empty
      // If value is provided, match case-insensitively
      const fieldVal = builtInMap[keyLower];
      if (fieldVal !== undefined) {
        if (!valueLower || fieldVal.toLowerCase().includes(valueLower)) {
          matchingPaths.add(file.path);
        }
      }
    }

    return matchingPaths;
  }

  /**
   * Collect all known property keys and their distinct non-empty values for
   * character files.  Used to power the Explorer filter auto-suggestions.
   */
  async collectCharacterPropertyIndex(): Promise<Map<string, Set<string>>> {
    const index = new Map<string, Set<string>>();
    const addEntry = (key: string, value: string) => {
      if (!value) return;
      const display = key; // preserve original casing for display
      let set = index.get(display);
      if (!set) { set = new Set(); index.set(display, set); }
      set.add(value);
    };

    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.characterFolder}/`;
    const wb = this.resolvedWorldBiblePath();
    const wbFolder = wb ? `${wb}/${this.settings.characterFolder}/` : '';
    const files = this.app.vault.getFiles().filter(f =>
      (f.path.startsWith(folder) || (wbFolder && f.path.startsWith(wbFolder))) && f.extension === 'md'
    );

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const sheetData = this.parseCharacterSheetForSidebar(content);
      if (!sheetData) continue;

      addEntry('Name', sheetData.name);
      addEntry('Surname', sheetData.surname);
      addEntry('Gender', sheetData.gender);
      addEntry('Age', sheetData.age);
      addEntry('Role', sheetData.role);

      const fullSheet = parseCharacterSheet(content);
      if (fullSheet) {
        addEntry('Eye Color', fullSheet.eyeColor);
        addEntry('Hair Color', fullSheet.hairColor);
        addEntry('Hair Length', fullSheet.hairLength);
        addEntry('Height', fullSheet.height);
        addEntry('Build', fullSheet.build);
        addEntry('Skin Tone', fullSheet.skinTone);
        addEntry('Distinguishing Features', fullSheet.distinguishingFeatures);
        if (fullSheet.customProperties) {
          for (const [k, v] of Object.entries(fullSheet.customProperties)) addEntry(k, v);
        }
      }
      if (sheetData.customProperties) {
        for (const [k, v] of Object.entries(sheetData.customProperties)) addEntry(k, v);
      }
    }
    return index;
  }

  /**
   * Collect all known property keys and their distinct non-empty values for
   * location files.
   */
  async collectLocationPropertyIndex(): Promise<Map<string, Set<string>>> {
    const index = new Map<string, Set<string>>();
    const addEntry = (key: string, value: string) => {
      if (!value) return;
      let set = index.get(key);
      if (!set) { set = new Set(); index.set(key, set); }
      set.add(value);
    };

    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.locationFolder}/`;
    const wb = this.resolvedWorldBiblePath();
    const wbFolder = wb ? `${wb}/${this.settings.locationFolder}/` : '';
    const files = this.app.vault.getFiles().filter(f =>
      (f.path.startsWith(folder) || (wbFolder && f.path.startsWith(wbFolder))) && f.extension === 'md'
    );

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const sheetData = parseLocationSheet(content);
      addEntry('Name', sheetData.name);
      addEntry('Type', sheetData.type);
      addEntry('Description', sheetData.description);
      if (sheetData.customProperties) {
        for (const [k, v] of Object.entries(sheetData.customProperties)) addEntry(k, v);
      }
    }
    return index;
  }

  /**
   * Search locations whose built-in or custom properties match a key:value filter.
   */
  async filterLocationsByProperty(filterKey: string, filterValue: string): Promise<Set<string>> {
    const matchingPaths = new Set<string>();
    const root = this.resolvedProjectPath();
    const folder = `${root}/${this.settings.locationFolder}/`;
    const wb = this.resolvedWorldBiblePath();
    const wbFolder = wb ? `${wb}/${this.settings.locationFolder}/` : '';
    const files = this.app.vault.getFiles().filter((f) =>
      (f.path.startsWith(folder) || (wbFolder && f.path.startsWith(wbFolder))) && f.extension === 'md'
    );

    const keyLower = filterKey.toLowerCase().trim();
    const valueLower = filterValue.toLowerCase().trim();

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const sheetData = parseLocationSheet(content);

      const fieldMap: Record<string, string> = {
        name: sheetData.name,
        type: sheetData.type,
        description: sheetData.description,
      };

      if (sheetData.customProperties) {
        for (const [k, v] of Object.entries(sheetData.customProperties)) {
          fieldMap[k.toLowerCase()] = v;
        }
      }

      const fieldVal = fieldMap[keyLower];
      if (fieldVal !== undefined) {
        if (!valueLower || fieldVal.toLowerCase().includes(valueLower)) {
          matchingPaths.add(file.path);
        }
      }
    }

    return matchingPaths;
  }

  // ─── Mention Frequency Analysis (Sidebar) ─────────────────────────

  /**
   * Analyse how frequently a set of characters are mentioned across all
   * chapters.  Returns an ordered list of chapters with a boolean flag
   * per tracked character.
   */
  async computeMentionFrequency(
    trackedCharacters: string[]
  ): Promise<{
    chapters: Array<{ name: string; index: number }>;
    /** characterName → array of booleans (one per chapter, true = mentioned) */
    mentions: Record<string, boolean[]>;
    /** characterName → number of consecutive chapters absent counting backwards from the latest chapter */
    currentGap: Record<string, number>;
  }> {
    const descs = await this.getChapterDescriptions();
    const sortedChapters = descs.sort((a, b) => a.order - b.order);

    const chapterList: Array<{ name: string; index: number }> = [];
    const mentions: Record<string, boolean[]> = {};
    for (const charName of trackedCharacters) {
      mentions[charName] = [];
    }

    for (let i = 0; i < sortedChapters.length; i++) {
      const ch = sortedChapters[i];
      chapterList.push({ name: ch.name, index: i + 1 });

      const content = await this.app.vault.read(ch.file);
      const body = this.stripFrontmatter(content);

      for (const charName of trackedCharacters) {
        const nameParts = charName.split(' ');
        const variations = [charName];
        if (nameParts.length > 1) variations.push(nameParts[0]);
        let found = false;
        for (const v of variations) {
          if (v.length < 2) continue;
          const regex = new RegExp(`\\b${this.escapeRegex(v)}\\b`, 'i');
          if (regex.test(body)) { found = true; break; }
        }
        mentions[charName].push(found);
      }
    }

    // Compute current gap (how many chapters since last mention, counting from the end)
    const currentGap: Record<string, number> = {};
    for (const charName of trackedCharacters) {
      const arr = mentions[charName];
      let gap = 0;
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i]) break;
        gap++;
      }
      currentGap[charName] = gap;
    }

    return { chapters: chapterList, mentions, currentGap };
  }
}
