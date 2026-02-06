import {
  Plugin,
  TFile,
  WorkspaceLeaf,
  ItemView,
  Setting,
  PluginSettingTab,
  MarkdownView,
  Editor,
  MarkdownRenderer,
  Component,
  Notice,
  Modal,
  App,
  ButtonComponent,
  DropdownComponent,
  EditorSuggest,
  EditorPosition,
  EditorSuggestContext,
  EditorSuggestTriggerInfo
} from 'obsidian';
import cytoscape from 'cytoscape';
// @ts-ignore
import dagre from 'cytoscape-dagre';

const dagreExtension = dagre as cytoscape.Ext;
cytoscape.use(dagreExtension);

// ==========================================
// INTERFACES
// ==========================================

interface NovalistSettings {
  projectPath: string;
  autoReplacements: AutoReplacementPair[];
  language: LanguageKey;
  customLanguageLabel: string;
  customLanguageDefaults: AutoReplacementPair[];
  enableMergeLog: boolean;
  enableHoverPreview: boolean;
  enableSidebarView: boolean;
  enableCustomExplorer: boolean;
  characterFolder: string;
  locationFolder: string;
  chapterDescFolder: string;
  chapterFolder: string;
  relationshipPairs: Record<string, string[]>;
}

interface AutoReplacementPair {
  start: string;
  end: string;
  startReplace: string;
  endReplace: string;
}

type LanguageKey =
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

const LANGUAGE_LABELS: Record<LanguageKey, string> = {
  'de-guillemet': 'German (guillemets)',
  'de-low': 'German (low-high)',
  en: 'English (curly quotes)',
  fr: 'French (guillemets with spaces)',
  es: 'Spanish (guillemets)',
  it: 'Italian (guillemets)',
  pt: 'Portuguese (guillemets)',
  ru: 'Russian (guillemets)',
  pl: 'Polish (low-high)',
  cs: 'Czech (low-high)',
  sk: 'Slovak (low-high)',
  custom: 'Custom'
};

const COMMON_REPLACEMENTS: AutoReplacementPair[] = [
  { start: '--', end: '--', startReplace: '—', endReplace: '—' },
  { start: '...', end: '...', startReplace: '…', endReplace: '…' }
];

const LANGUAGE_DEFAULTS: Record<Exclude<LanguageKey, 'custom'>, AutoReplacementPair[]> = {
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

const cloneAutoReplacements = (pairs: AutoReplacementPair[]): AutoReplacementPair[] =>
  pairs.map((pair) => ({ ...pair }));

type FrontmatterValue = string | string[];

type CodeMirrorLine = {
  text: string;
  from: number;
};

type CodeMirrorDoc = {
  lineAt: (pos: number) => CodeMirrorLine;
};

type CodeMirrorLike = {
  dom: HTMLElement;
  posAtCoords: (coords: { x: number; y: number }) => number | null;
  state: { doc: CodeMirrorDoc };
};

type EditorWithCodeMirror = Editor & { cm?: CodeMirrorLike };

const DEFAULT_SETTINGS: NovalistSettings = {
  projectPath: 'NovelProject',
  autoReplacements: cloneAutoReplacements(LANGUAGE_DEFAULTS['de-low']),
  language: 'de-low',
  customLanguageLabel: 'Custom',
  customLanguageDefaults: [],
  enableMergeLog: false,
  enableHoverPreview: true,
  enableSidebarView: true,
  enableCustomExplorer: false,
  characterFolder: 'Characters',
  locationFolder: 'Locations',
  chapterDescFolder: 'ChapterDescriptions',
  chapterFolder: 'Chapters',
  relationshipPairs: {}
};

// ==========================================
// VIEWS
// ==========================================

export const NOVELIST_SIDEBAR_VIEW_TYPE = 'novalist-sidebar';
export const NOVELIST_EXPLORER_VIEW_TYPE = 'novalist-explorer';

class NovalistSidebarView extends ItemView {
  plugin: NovalistPlugin;
  currentChapterFile: TFile | null = null;
  selectedEntity: { type: 'character' | 'location'; file: TFile; display: string } | null = null;
  private activeTab: 'actions' | 'context' | 'focus' = 'context';
  private lastNonFocusTab: 'actions' | 'context' = 'context';
  private lastFocusKey: string | null = null;
  private autoFocusActive = true;
  private selectedImageByPath: Map<string, string> = new Map();

  constructor(leaf: WorkspaceLeaf, plugin: NovalistPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return NOVELIST_SIDEBAR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Novalist context';
  }

  getIcon(): string {
    return 'book-open';
  }

  onOpen() {
    this.containerEl.empty();
    void this.render();
    
    // Listen for active file changes
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (file && file.extension === 'md') {
          this.currentChapterFile = file;
          void this.render();
        }
      })
    );
    
    // Listen for vault modifications (e.g. role changes)
    this.registerEvent(this.app.vault.on('modify', () => {
      void this.render();
    }));
  }

  async render() {
    const container = this.containerEl;
    container.empty();
    container.addClass('novalist-sidebar');

    container.onclick = (evt) => {
      const target = evt.target;
      if (!(target instanceof HTMLElement)) return;
      const link = target.closest('a');
      if (!link || !container.contains(link)) return;

      const href = link.getAttribute('data-href') || link.getAttribute('href') || link.textContent || '';
      if (!href) return;

      void this.plugin.focusEntityByName(href, true).then((handled) => {
        if (handled) {
          evt.preventDefault();
          evt.stopPropagation();
        }
      });
    };

    // Header
    container.createEl('h3', { text: 'Novalist context', cls: 'novalist-sidebar-header' });

    // Tabs
    const tabs = container.createDiv('novalist-tabs');
    const setTab = (tab: 'actions' | 'context' | 'focus') => {
      this.autoFocusActive = false;
      this.activeTab = tab;
      if (tab !== 'focus') this.lastNonFocusTab = tab;
      void this.render();
    };

    const tabOrder: Array<{ id: 'actions' | 'context' | 'focus'; label: string }> = [
      { id: 'actions', label: 'Actions' },
      { id: 'context', label: 'Overview' },
      { id: 'focus', label: 'Focus' }
    ];

    for (const tab of tabOrder) {
      const btn = tabs.createEl('button', {
        text: tab.label,
        cls: `novalist-tab ${this.activeTab === tab.id ? 'is-active' : ''}`
      });
      btn.addEventListener('click', () => setTab(tab.id));
    }

    if (!this.selectedEntity && this.activeTab === 'focus') {
      this.activeTab = this.lastNonFocusTab;
    }

    if (this.activeTab === 'focus') {
      const details = container.createDiv('novalist-section novalist-selected-entity');

      if (!this.selectedEntity) {
        details.createEl('p', { text: 'No focused item.', cls: 'novalist-empty' });
      } else {
        const selectedEntity = this.selectedEntity;
        const content = await this.plugin.app.vault.read(selectedEntity.file);
        let body = this.plugin.stripFrontmatter(content);
        const title = this.plugin.extractTitle(body);
        if (title) {
          details.createEl('h3', { text: title, cls: 'novalist-focus-title' });
          body = this.plugin.removeTitle(body);
        }

        const images = this.plugin.parseImagesSection(content);
        const renderImages = () => {
          if (images.length === 0) return;
          const imageRow = details.createDiv('novalist-image-row');
          imageRow.createEl('span', { text: 'Images', cls: 'novalist-image-label' });

          const dropdown = new DropdownComponent(imageRow);
          for (const img of images) {
            dropdown.addOption(img.name, img.name);
          }

          const key = selectedEntity.file.path;
          const selected = this.selectedImageByPath.get(key) || images[0].name;
          dropdown.setValue(selected);

          const imageContainer = details.createDiv('novalist-image-preview');
          const renderImage = (name: string) => {
            const img = images.find(i => i.name === name) || images[0];
            this.selectedImageByPath.set(key, img.name);
            imageContainer.empty();

            const file = this.plugin.resolveImagePath(img.path, selectedEntity.file.path);
            if (!file) {
              imageContainer.createEl('p', { text: 'Image not found.', cls: 'novalist-empty' });
              return;
            }

            const src = this.plugin.app.vault.getResourcePath(file);
            imageContainer.createEl('img', { attr: { src, alt: img.name } });
          };

          dropdown.onChange((val) => {
            renderImage(val);
          });

          renderImage(selected);
        };

        if (selectedEntity.type === 'character') {
          body = this.plugin.stripChapterRelevantSection(body);
          body = this.plugin.stripImagesSection(body);
          if (this.currentChapterFile) {
            const charData = await this.plugin.parseCharacterFile(selectedEntity.file);
            const chapterKey = await this.plugin.getChapterNameForFile(this.currentChapterFile);
            const chapterInfo = charData.chapterInfos.find(ci => ci.chapter === chapterKey);
            if (chapterInfo) {
              body = this.plugin.applyCharacterOverridesToBody(body, chapterInfo.overrides);
            }
          }
          renderImages();
        }

        if (selectedEntity.type === 'location') {
          body = this.plugin.stripImagesSection(body);
          renderImages();
        }

        if (selectedEntity.type === 'character' && this.currentChapterFile) {
          const charData = await this.plugin.parseCharacterFile(selectedEntity.file);
          const chapterKey = await this.plugin.getChapterNameForFile(this.currentChapterFile);
          const chapterInfo = charData.chapterInfos.find(ci => ci.chapter === chapterKey);
          if (chapterInfo && (chapterInfo.overrides?.further_info || chapterInfo.info)) {
            const block = details.createDiv('novalist-section');
            block.createEl('h4', { text: `Chapter notes: ${chapterKey}`, cls: 'novalist-section-title' });
            const text = [chapterInfo.overrides?.further_info, chapterInfo.info].filter(Boolean).join('\n');
            const md = block.createDiv('novalist-markdown');
            await MarkdownRenderer.render(this.app, text, md, '', this);
          }
        }

        const md = details.createDiv('novalist-markdown');
        await MarkdownRenderer.render(this.app, body, md, '', this);
      }

      return;
    }

    if (this.activeTab === 'actions') {
      const actionsSection = container.createDiv('novalist-section');
      actionsSection.createEl('h4', { text: 'Quick actions', cls: 'novalist-section-title' });

      const btnContainer = actionsSection.createDiv('novalist-actions');

      new ButtonComponent(btnContainer)
        .setButtonText('Add character')
        .onClick(() => this.plugin.openCharacterModal());

      new ButtonComponent(btnContainer)
        .setButtonText('Add location')
        .onClick(() => this.plugin.openLocationModal());

      new ButtonComponent(btnContainer)
        .setButtonText('Add chapter description')
        .onClick(() => this.plugin.openChapterDescriptionModal());

      return;
    }

    if (!this.currentChapterFile) {
      // Clear legacy content just in case
      // Actually container.empty() at the top handles this.
      // But let's ensure we are not appending to existing.
      container.createEl('p', { text: 'Open a chapter file to see context.', cls: 'novalist-empty' });
      return;
    }

    // Get chapter data
    // We should create a dedicated container for the list so we can clear it specifically if needed,
    // but container.empty() should have done it.
    // The issue is likely race condition if render() is called multiple times.
    
    const contextContent = container.createDiv('novalist-context-content');
    
    const chapterData = await this.plugin.parseChapterFile(this.currentChapterFile);
    
    // Check if the container was cleared while we were awaiting
    // If render() was called again, container.empty() would have removed contextContent.
    // But if we have a reference to contextContent, we are appending to a detached element?
    // No, contextContent is child of container. If container is emptied, contextContent is removed from DOM.
    // So appending to it won't show up.
    // BUT, if the *new* render call happens, it creates a NEW container content.
    // If the OLD render call finishes its await, it might still try to append?
    // No, because we are creating elements on `contextContent` which is now detached.
    
    // UNLESS `this.containerEl` is not what I think it is.
    
    // Let's protect against race conditions by tracking a render ID.
    
    // Characters Section
    if (chapterData.characters.length > 0) {
      const characterItems: Array<{
        data: Awaited<ReturnType<NovalistPlugin['parseCharacterFile']>>;
        chapterInfo: { chapter: string; info: string; overrides: Record<string, string> } | undefined;
      }> = [];

      const chapterKey = this.currentChapterFile ? await this.plugin.getChapterNameForFile(this.currentChapterFile) : '';

      for (const charName of chapterData.characters) {
        const charFile = await this.plugin.findCharacterFile(charName);
        if (!charFile) continue;
        const charData = await this.plugin.parseCharacterFile(charFile);
        const chapterInfo = charData.chapterInfos.find(ci => ci.chapter === chapterKey);
        characterItems.push({ data: charData, chapterInfo });
      }

      if (characterItems.length > 0) {
        const charSection = contextContent.createDiv('novalist-section');
        charSection.createEl('h4', { text: 'Characters', cls: 'novalist-section-title' });

        const charList = charSection.createDiv('novalist-list');
        for (const itemData of characterItems) {
          const { data: charData, chapterInfo } = itemData;
          const item = charList.createDiv('novalist-item');

          // Header with name
          const header = item.createDiv('novalist-item-header');
          header.createEl('strong', { text: `${charData.name} ${charData.surname}` });

          // Info
          const info = item.createDiv('novalist-item-info');
          const age = chapterInfo?.overrides?.age || charData.age;
          const relationship = chapterInfo?.overrides?.relationship || charData.relationship;
          const role = charData.role;
          if (age) info.createEl('span', { text: `Age: ${age}`, cls: 'novalist-tag' });
          if (relationship) info.createEl('span', { text: relationship, cls: 'novalist-tag' });
          if (role) info.createEl('span', { text: role, cls: 'novalist-tag' });

          // Hover/Click to open
          item.addEventListener('click', () => {
            void this.plugin.focusEntityByName(`${charData.name} ${charData.surname}`.trim(), true);
          });
        }
      }
    }

    // Locations Section
    if (chapterData.locations.length > 0) {
      const locationItems: Array<Awaited<ReturnType<NovalistPlugin['parseLocationFile']>>> = [];

      for (const locName of chapterData.locations) {
        const locFile = await this.plugin.findLocationFile(locName);
        if (!locFile) continue;
        const locData = await this.plugin.parseLocationFile(locFile);
        locationItems.push(locData);
      }

      if (locationItems.length > 0) {
        const locSection = contextContent.createDiv('novalist-section');
        locSection.createEl('h4', { text: 'Locations', cls: 'novalist-section-title' });

        const locList = locSection.createDiv('novalist-list');
        for (const locData of locationItems) {
          const item = locList.createDiv('novalist-item');
          item.createEl('strong', { text: locData.name });
          if (locData.description) {
            item.createEl('p', { text: locData.description });
          }
          item.addEventListener('click', () => {
            void this.plugin.focusEntityByName(locData.name, true);
          });
        }
      }
    }

  }

  async onClose() {
    // Cleanup
  }

  setSelectedEntity(
    entity: { type: 'character' | 'location'; file: TFile; display: string } | null,
    options?: { forceFocus?: boolean }
  ) {
    const nextKey = entity ? entity.file.path : null;
    const changed = nextKey !== this.lastFocusKey;
    this.lastFocusKey = nextKey;
    this.selectedEntity = entity;

    if (changed && nextKey) {
      this.selectedImageByPath.delete(nextKey);
    }

    if (!entity) {
      if (this.activeTab === 'focus') this.activeTab = this.lastNonFocusTab;
    } else if (changed && options?.forceFocus !== false) {
      this.autoFocusActive = true;
      this.activeTab = 'focus';
    } else if (this.autoFocusActive && this.activeTab !== 'focus' && options?.forceFocus !== false) {
      this.activeTab = 'focus';
    }

    void this.render();
  }
}

class NovalistExplorerView extends ItemView {
  plugin: NovalistPlugin;
  private activeTab: 'chapters' | 'characters' | 'locations' = 'chapters';
  private dragChapterIndex: number | null = null;
  private dragCharacterPath: string | null = null;
  private selectedFiles: Set<string> = new Set();
  private lastSelectedPath: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: NovalistPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return NOVELIST_EXPLORER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Novalist explorer';
  }

  getIcon(): string {
    return 'folder';
  }

  onOpen() {
    this.containerEl.empty();
    void this.render();

    this.registerEvent(this.app.vault.on('create', () => {
      void this.render();
    }));
    this.registerEvent(this.app.vault.on('delete', () => {
      void this.render();
    }));
    this.registerEvent(this.app.vault.on('rename', () => {
      void this.render();
    }));
    this.registerEvent(this.app.vault.on('modify', () => {
      void this.render();
    }));
  }

  async render() {
    const container = this.containerEl;
    container.empty();
    container.addClass('novalist-explorer');

    container.createEl('h3', { text: 'Novalist explorer', cls: 'novalist-explorer-header' });

    const tabs = container.createDiv('novalist-explorer-tabs');
    const tabOrder: Array<{ id: 'chapters' | 'characters' | 'locations'; label: string }> = [
      { id: 'chapters', label: 'Chapters' },
      { id: 'characters', label: 'Characters' },
      { id: 'locations', label: 'Locations' }
    ];

    const setTab = (tab: 'chapters' | 'characters' | 'locations') => {
      this.activeTab = tab;
      void this.render();
    };

    for (const tab of tabOrder) {
      const btn = tabs.createEl('button', {
        text: tab.label,
        cls: `novalist-explorer-tab ${this.activeTab === tab.id ? 'is-active' : ''}`
      });
      btn.addEventListener('click', () => setTab(tab.id));
    }

    const list = container.createDiv('novalist-explorer-list');

    if (this.activeTab === 'chapters') {
      const chapters = await this.plugin.getChapterList();
      this.renderChapterList(list, chapters, 'No chapters found.');
      return;
    }

    if (this.activeTab === 'characters') {
      const characters = await this.plugin.getCharacterList();
      this.renderCharacterGroupedList(list, characters, 'No characters found.');
      return;
    }

    const locations = await this.plugin.getLocationList();
    this.renderList(list, locations, 'No locations found.');
  }

  private renderChapterList(
    list: HTMLElement,
    items: Array<{ name: string; file: TFile; descFile: TFile }>,
    emptyMessage: string
  ) {
    if (items.length === 0) {
      list.createEl('p', { text: emptyMessage, cls: 'novalist-empty' });
      return;
    }

    items.forEach((item, index) => {
      const row = list.createDiv('novalist-explorer-item');
      row.setAttribute('draggable', 'true');
      row.createEl('span', { text: `${index + 1}. ${item.name}`, cls: 'novalist-explorer-label' });

      row.addEventListener('click', () => {
        void this.openFileInExplorer(item.file);
      });

      row.addEventListener('dragstart', (evt) => {
        this.dragChapterIndex = index;
        row.addClass('is-dragging');
        if (evt.dataTransfer) {
          evt.dataTransfer.effectAllowed = 'move';
          evt.dataTransfer.setData('text/plain', String(index));
        }
      });

      row.addEventListener('dragend', () => {
        this.dragChapterIndex = null;
        row.removeClass('is-dragging');
        list.querySelectorAll('.is-drop-target').forEach((el) => el.removeClass('is-drop-target'));
      });

      row.addEventListener('dragover', (evt) => {
        evt.preventDefault();
        row.addClass('is-drop-target');
      });

      row.addEventListener('dragleave', () => {
        row.removeClass('is-drop-target');
      });

      row.addEventListener('drop', (evt) => {
        evt.preventDefault();
        row.removeClass('is-drop-target');
        const fallback = evt.dataTransfer?.getData('text/plain');
        const sourceIndex = this.dragChapterIndex ?? (fallback ? Number(fallback) : NaN);
        if (Number.isNaN(sourceIndex)) return;
        if (sourceIndex === index) return;

        const reordered = [...items];
        const [moved] = reordered.splice(sourceIndex, 1);
        reordered.splice(index, 0, moved);
        this.dragChapterIndex = null;

        void this.plugin.updateChapterOrder(reordered.map((entry) => entry.descFile));
        void this.render();
      });
    });
  }

  private renderCharacterGroupedList(
    list: HTMLElement,
    items: Array<{ name: string; file: TFile; role: string; gender: string }>,
    emptyMessage: string
  ) {
    if (items.length === 0) {
      list.createEl('p', { text: emptyMessage, cls: 'novalist-empty' });
      return;
    }

    const groups: Record<string, Array<{ name: string; file: TFile; role: string; gender: string }>> = {};
    
    // Initialize standard groups to ensure ordering
    const standardGroups = [
      CHARACTER_ROLE_LABELS.main,
      CHARACTER_ROLE_LABELS.side,
      CHARACTER_ROLE_LABELS.background
    ];
    
    // Distribute items
    for (const item of items) {
      const roleLabel = item.role || CHARACTER_ROLE_LABELS.side; // Default to Side if missing
      
      if (!groups[roleLabel]) {
        groups[roleLabel] = [];
      }
      groups[roleLabel].push(item);
    }

    // Determine render order: Standard groups first, then others alphabetically
    const existingRoles = Object.keys(groups);
    const otherRoles = existingRoles.filter(r => !standardGroups.includes(r)).sort();
    
    // Only include standard groups if they exist in 'groups' (i.e., have items)
    const rolesToRender = [
      ...standardGroups.filter(r => groups[r]), 
      ...otherRoles
    ];

    // Create a flattened visual order list for range selection logic
    const visualOrder: Array<{ file: TFile }> = [];
    for (const roleLabel of rolesToRender) {
         if (groups[roleLabel]) {
             visualOrder.push(...groups[roleLabel]);
         }
    }

    for (const roleLabel of rolesToRender) {
      const groupItems = groups[roleLabel];
      if (!groupItems || groupItems.length === 0) continue;


      // Group Header
      const headerObj = list.createDiv('novalist-group-header');
      headerObj.createEl('span', { text: roleLabel }); 

      // Header drop target
      headerObj.addEventListener('dragover', (evt) => {
        evt.preventDefault();
        headerObj.addClass('is-drop-target');
      });
      headerObj.addEventListener('dragleave', () => {
        headerObj.removeClass('is-drop-target');
      });
      headerObj.addEventListener('drop', (evt) => {
        evt.preventDefault();
        headerObj.removeClass('is-drop-target');
        
        let paths: string[] = [];
        try {
            const json = evt.dataTransfer?.getData('application/json');
            if (json) paths = JSON.parse(json) as string[];
        } catch {
          // ignore invalid json
        }

        if (paths.length === 0) {
            const txt = evt.dataTransfer?.getData('text/plain');
            if (txt) paths = [txt];
        }
        
        for (const path of paths) {
             const sourceItem = items.find(i => i.file.path === path);
             if (sourceItem && sourceItem.role !== roleLabel) {
                 void this.plugin.updateCharacterRole(sourceItem.file, roleLabel).then(() => {
                     // Auto-refresh via file modify event
                 });
             }
        }
      });

      const groupContainer = list.createDiv('novalist-group-container');
      
      for (const item of groupItems) {
        const row = groupContainer.createDiv('novalist-explorer-item');
        row.setAttribute('draggable', 'true');
        row.dataset.path = item.file.path;
        row.createEl('span', { text: item.name, cls: 'novalist-explorer-label' });
        
        if (item.gender) {
            row.createEl('span', { 
                text: item.gender, 
                cls: 'novalist-explorer-badge novalist-gender-badge', 
                attr: { title: `Gender: ${item.gender}` }
            });
        }

        if (this.selectedFiles.has(item.file.path)) {
            row.addClass('is-selected');
        }

        row.addEventListener('click', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (this.selectedFiles.has(item.file.path)) {
                    this.selectedFiles.delete(item.file.path);
                } else {
                    this.selectedFiles.add(item.file.path);
                    this.lastSelectedPath = item.file.path;
                }
            } else if (e.shiftKey && this.lastSelectedPath) {
                const startIdx = visualOrder.findIndex(i => i.file.path === this.lastSelectedPath);
                const endIdx = visualOrder.findIndex(i => i.file.path === item.file.path);
                
                if (startIdx !== -1 && endIdx !== -1) {
                    const low = Math.min(startIdx, endIdx);
                    const high = Math.max(startIdx, endIdx);
                    this.selectedFiles.clear();
                    for(let k = low; k <= high; k++) {
                        this.selectedFiles.add(visualOrder[k].file.path);
                    }
                } else {
                     this.selectedFiles.add(item.file.path);
                }
            } else {
                this.selectedFiles.clear();
                this.selectedFiles.add(item.file.path);
                this.lastSelectedPath = item.file.path;
                void this.openFileInExplorer(item.file);
            }
            
            // Update UI without full re-render
            const allRows = list.querySelectorAll('.novalist-explorer-item');
            allRows.forEach((r) => {
                const el = r as HTMLElement;
                const p = el.dataset.path;
                if (p && this.selectedFiles.has(p)) {
                   el.addClass('is-selected');
                } else {
                   el.removeClass('is-selected');
                }
            });
            
            e.stopPropagation();
        });

        // Drag Start
        row.addEventListener('dragstart', (evt) => {
           let dragPaths: string[] = [];
           if (this.selectedFiles.has(item.file.path)) {
               dragPaths = Array.from(this.selectedFiles);
           } else {
               this.selectedFiles.clear();
               this.selectedFiles.add(item.file.path);
               this.lastSelectedPath = item.file.path;
               list.querySelectorAll('.is-selected').forEach(el => el.removeClass('is-selected'));
               row.addClass('is-selected');
               dragPaths = [item.file.path];
           }
        
           this.dragCharacterPath = item.file.path; 
           row.addClass('is-dragging');
           if (evt.dataTransfer) {
             evt.dataTransfer.effectAllowed = 'move';
             evt.dataTransfer.setData('application/json', JSON.stringify(dragPaths));
             evt.dataTransfer.setData('text/plain', item.file.path);
           }
        });

        // Drag End
        row.addEventListener('dragend', () => {
           this.dragCharacterPath = null;
           row.removeClass('is-dragging');
           list.querySelectorAll('.is-drop-target').forEach(el => el.removeClass('is-drop-target'));
        });

        // Drop on Item (to put into this group)
        row.addEventListener('dragover', (evt) => {
          evt.preventDefault();
          row.addClass('is-drop-target'); 
        });

        row.addEventListener('dragleave', () => {
          row.removeClass('is-drop-target');
        });

        row.addEventListener('drop', (evt) => {
          evt.preventDefault();
          row.removeClass('is-drop-target');
          
          let paths: string[] = [];
          try {
             const json = evt.dataTransfer?.getData('application/json');
             if (json) paths = JSON.parse(json) as string[];
          } catch {
            // ignore invalid json
          }
 
          if (paths.length === 0) {
             const txt = evt.dataTransfer?.getData('text/plain');
             if (txt) paths = [txt];
          }

          for (const path of paths) {
              const sourceItem = items.find(i => i.file.path === path);
              if (sourceItem && sourceItem.role !== roleLabel) {
                   void this.plugin.updateCharacterRole(sourceItem.file, roleLabel);
              }
          }
        });
      }
    }
  }

  private renderList(
    list: HTMLElement,
    items: Array<{ name: string; file: TFile }>,
    emptyMessage: string
  ) {
    if (items.length === 0) {
      list.createEl('p', { text: emptyMessage, cls: 'novalist-empty' });
      return;
    }

    for (const item of items) {
      const row = list.createDiv('novalist-explorer-item');
      row.createEl('span', { text: item.name, cls: 'novalist-explorer-label' });
      row.addEventListener('click', () => {
        void this.openFileInExplorer(item.file);
      });
    }
  }

  private async openFileInExplorer(file: TFile): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType('markdown')
      .find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);

    const leaf = existingLeaf ?? this.app.workspace.getLeaf(true);
    await leaf.openFile(file);
    await this.app.workspace.revealLeaf(leaf);
  }
}

// ==========================================
// SUGGESTERS
// ==========================================

class RelationshipKeySuggester extends EditorSuggest<string> {
  plugin: NovalistPlugin;

  constructor(plugin: NovalistPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _: TFile): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line);
    // Trigger if we are in a bullet point that looks like open metadata: "- **Key"
    const match = line.match(/^(\s*[-*]\s*\*\*)([^*]*)$/);
    if (!match) return null;

    const prefix = match[1];
    const query = match[2];

    return {
      start: { line: cursor.line, ch: prefix.length },
      end: cursor,
      query: query
    };
  }

  getSuggestions(context: EditorSuggestContext): string[] {
    const query = context.query.toLowerCase();
    return Array.from(this.plugin.knownRelationshipKeys)
       .filter(key => key.toLowerCase().includes(query))
       .sort((a,b) => a.localeCompare(b));
  }

  renderSuggestion(key: string, el: HTMLElement): void {
    el.createEl("div", { text: key });
  }

  selectSuggestion(key: string, _: MouseEvent | KeyboardEvent): void {
     if (!this.context) return;
     const editor = this.context.editor;
     const completion = `${key}**: `;
     const range = { start: this.context.start, end: this.context.end };
     editor.replaceRange(completion, range.start, range.end);
     // Move cursor to end
     const newCursor = { 
         line: range.start.line, 
         ch: range.start.ch + completion.length 
     };
     editor.setCursor(newCursor);
  }
}

class CharacterSuggester extends EditorSuggest<TFile> {
  plugin: NovalistPlugin;

  constructor(plugin: NovalistPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _: TFile): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line);
    // Trigger if we are in a bullet point that looks like metadata: "- **Key**: Value" or "- **Key:** Value"
    const match = line.match(/^(\s*[-*]\s*\*\*(.+?)\*\*([:]?)\s*)(.*)$/);
    if (!match) return null;

    const prefix = match[1];
    let key = match[2];
    const colonOutside = match[3];
    const valueStr = match[4];

    // Check for colon presence either inside or outside
    if (!colonOutside && !key.trim().endsWith(':')) return null;

    // Clean key (remove trailing colon if inside)
    if (key.trim().endsWith(':')) key = key.trim().slice(0, -1);

    // Check if cursor is in the value part
    if (cursor.ch < prefix.length) return null;

    // Check for "General Information" context if possible, but line regex is strong enough.
    // Also support comma separation: "Value1, Value2"
    // We want the current partial term.
    const subCursor = cursor.ch - prefix.length;
    const valueBeforeCursor = valueStr.substring(0, subCursor);
    const lastComma = valueBeforeCursor.lastIndexOf(',');
    
    const query = lastComma === -1 ? valueBeforeCursor.trim() : valueBeforeCursor.substring(lastComma + 1).trim();

    // Start index for replacement
    // const startCh = prefix.length + (lastComma === -1 ? 0 : lastComma + 1) + (valueBeforeCursor.match(/,\s*$/) ? valueBeforeCursor.match(/,\s*$/)![0].length : 0);
    
    // Calculate start based on query position in valueBeforeCursor
    let extraOffset = 0;
    if (lastComma !== -1) {
        // Find non-whitespace start after comma
        const afterComma = valueBeforeCursor.substring(lastComma + 1);
        const leadingSpaceMatch = afterComma.match(/^\s*/);
        extraOffset = (lastComma + 1) + (leadingSpaceMatch ? leadingSpaceMatch[0].length : 0);
    }

    return {
      start: { line: cursor.line, ch: prefix.length + extraOffset },
      end: cursor,
      query: query
    };
  }

  async getSuggestions(context: EditorSuggestContext): Promise<TFile[]> {
    const chars = await this.plugin.getCharacterList();
    const query = context.query.toLowerCase().replace(/^\[\[/, '');
    const activeFile = this.plugin.app.workspace.getActiveFile();
    
    return chars
      .map(c => c.file)
      .filter(f => {
         if (activeFile && f.path === activeFile.path) return false;
         return f.basename.toLowerCase().includes(query) || f.path.toLowerCase().includes(query);
      });
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.createEl("div", { text: file.basename });
    // el.createEl("small", { text: file.path });
  }

  selectSuggestion(file: TFile, _: MouseEvent | KeyboardEvent): void {
     if (!this.context) return;
     const editor = this.context.editor;
     const range = { start: this.context.start, end: this.context.end };
     
     // Insert the wikilink
     const link = `[[${file.basename}]]`;
     editor.replaceRange(link, range.start, range.end);
     const newCursor = { line: range.start.line, ch: range.start.ch + link.length };
     editor.setCursor(newCursor);
     
     // Trigger reciprocal update
     const activeFile = this.plugin.app.workspace.getActiveFile();
     
     // Re-extract key from line
     const lineNum = this.context.start.line;
     const line = editor.getLine(lineNum);
     const match = line.match(/^(\s*[-*]\s*\*\*(.+?)\*\*([:]?)\s*)/);
     
     let key = '';
     if (match) {
        key = match[2];
        if (key.trim().endsWith(':')) key = key.trim().slice(0, -1);
     }
     
     if (activeFile && key) {
         void (async () => {
             // Attempt to deduce inverse key from siblings
             let deducedKey: string | null = null;
             
             // Extract all wikilinks from the line
             const linkRegex = /\[\[(.*?)\]\]/g;
             let linkMatch: RegExpExecArray | null;
             while ((linkMatch = linkRegex.exec(line)) !== null) {
                 if (!linkMatch[1]) continue;
                 const rawName = linkMatch[1];
                 const name = rawName.split('|')[0]; // Handle aliases if any
                 if (name === file.basename) continue; // Skip the one we just added

                 // Find the file for this name
                 const siblingFile = this.plugin.app.metadataCache.getFirstLinkpathDest(name, activeFile.path);
                 if (siblingFile && siblingFile instanceof TFile) {
                      // Check sibling file for reference to activeFile
                      const content = await this.plugin.app.vault.read(siblingFile);
                      // Look for: - **Role**: ... [[ActiveFile]] ...
                      const escapeName = activeFile.basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                      // Matches: - **KEY**: [[Active]] or - **KEY**: [[Other]], [[Active]]
                      const siblingRegex = new RegExp(`^\\s*[-*]\\s*\\*\\*(.+?)\\*\\*[:]?:.*?\\[\\[${escapeName}(?:\\|.*?)?\\]\\]`, 'm');
                      const siblingMatch = content.match(siblingRegex);
                      if (siblingMatch) {
                          deducedKey = siblingMatch[1].trim();
                          // Cleanup trailing colon if captured
                          if (deducedKey.endsWith(':')) deducedKey = deducedKey.slice(0, -1).trim();
                          break; 
                      }
                 }
             }

             if (deducedKey) {
                 new Notice(`Auto-linked relationship as "${deducedKey}" based on existing siblings.`);
                 void this.plugin.addRelationshipToFile(file, deducedKey, activeFile.basename);
             } else {
                 new InverseRelationshipModal(
                     this.plugin.app, 
                     this.plugin, 
                     activeFile, 
                     file, 
                     key, 
                     (inverseKey) => {
                         void this.plugin.addRelationshipToFile(file, inverseKey, activeFile.basename);
                         void this.plugin.learnRelationshipPair(key, inverseKey);
                     }
                 ).open();
             }
         })();
     }
  }
} 
// ==========================================
// MODALS
// ==========================================

class InverseRelationshipModal extends Modal {
  private targetFile: TFile;
  private sourceFile: TFile;
  private relationshipKey: string;
  private inverseKey: string = '';
  private plugin: NovalistPlugin;
  onSubmit: (inverseKey: string) => void;

  constructor(app: App, plugin: NovalistPlugin, sourceFile: TFile, targetFile: TFile, relationshipKey: string, onSubmit: (k: string) => void) {
    super(app);
    this.plugin = plugin;
    this.sourceFile = sourceFile;
    this.targetFile = targetFile;
    this.relationshipKey = relationshipKey;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Define inverse relationship' });
    contentEl.createEl('p', { 
        text: `You defined ${this.targetFile.basename} as "**${this.relationshipKey}**" of ${this.sourceFile.basename}.` 
    });
    contentEl.createEl('p', { 
        text: `How is ${this.sourceFile.basename} related to ${this.targetFile.basename}?` 
    });

    const inputDiv = contentEl.createDiv('novalist-input-group');
    const input = inputDiv.createEl('input', { type: 'text', placeholder: 'e.g. Child, Sibling...' });

    // Suggestion bubbles
    const suggestionsDiv = contentEl.createDiv('novalist-suggestions');

    const renderSuggestions = () => {
       suggestionsDiv.empty();
       const currentInput = input.value.toLowerCase();
       
       // 1. Priortize known inverses for this key
       const knownInverses = this.plugin.settings.relationshipPairs[this.relationshipKey] || [];
       const allKeys = Array.from(this.plugin.knownRelationshipKeys);

       // Filter and combine
       const suggestions = new Set<string>();
       
       // Always show known inverses first
       knownInverses.forEach(k => suggestions.add(k));
       
       // Add matching keys from vault
       allKeys
         .filter(k => k.toLowerCase().includes(currentInput) && !suggestions.has(k))
         .sort()
         .slice(0, 5) // Limit generic suggestions
         .forEach(k => suggestions.add(k));

       suggestions.forEach(key => {
          const chip = suggestionsDiv.createEl('button', { text: key, cls: 'novalist-chip' });
          
          chip.addEventListener('click', () => {
             this.submit(key);
          });
       });
    };

    input.addEventListener('input', renderSuggestions);
    // Initial render
    renderSuggestions();

    input.focus();
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            this.submit(input.value);
        }
    });

    new ButtonComponent(contentEl)
        .setButtonText('Update')
        .setCta()
        .onClick(() => this.submit(input.value));
  }

  submit(value: string) {
      if (!value.trim()) {
          new Notice('Please enter a relationship label.');
          return;
      }
      this.onSubmit(value.trim());
      this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

class CharacterModal extends Modal {
  plugin: NovalistPlugin;
  name: string = '';
  surname: string = '';
  gender: string = '';
  age: string = '';
  relationship: string = '';
  role: CharacterRole = 'main';
  furtherInfo: string = '';
  private previewEl: HTMLElement | null = null;
  private previewComponent = new Component();

  constructor(app: App, plugin: NovalistPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.previewComponent.load();
    
    contentEl.createEl('h2', { text: 'Create new character' });
    
    // Name
    new Setting(contentEl)
      .setName('Name')
      .addText(text => text.onChange(value => this.name = value));
    
    // Surname
    new Setting(contentEl)
      .setName('Surname')
      .addText(text => text.onChange(value => this.surname = value));
    
    // Gender
    new Setting(contentEl)
      .setName('Gender')
      .addText(text => text.onChange(value => this.gender = value));

    // Age
    new Setting(contentEl)
      .setName('Age')
      .addText(text => text.onChange(value => this.age = value));
    
    // Relationship
    new Setting(contentEl)
      .setName('Relationship')
      .addText(text => text.onChange(value => this.relationship = value));

    new Setting(contentEl)
      .setName('Character role')
      .addDropdown((dropdown) => {
        for (const [key, label] of Object.entries(CHARACTER_ROLE_LABELS)) {
          dropdown.addOption(key, label);
        }
        dropdown.setValue(this.role);
        dropdown.onChange((value) => {
          if (value in CHARACTER_ROLE_LABELS) {
            this.role = value as CharacterRole;
          }
        });
      });
    
    // Further Info
    new Setting(contentEl)
      .setName('Further information')
      .addTextArea(text => text
        .setPlaceholder('Supports Markdown')
        .onChange(async (value) => {
          this.furtherInfo = value;
          await this.renderPreview();
        }));

    // Markdown preview
    this.previewEl = contentEl.createDiv('novalist-markdown-preview');
    this.previewEl.createEl('small', { text: 'Preview' });
    await this.renderPreview();
    
    // Buttons
    const buttonDiv = contentEl.createDiv('modal-button-container');
    
    new ButtonComponent(buttonDiv)
      .setButtonText('Cancel')
      .onClick(() => this.close());
    
    new ButtonComponent(buttonDiv)
      .setButtonText('Create')
      .setCta()
      .onClick(async () => {
        await this.plugin.createCharacter(
          this.name,
          this.surname,
          this.age,
          this.gender,
          this.relationship,
          this.role,
          this.furtherInfo
        );
        this.close();
      });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
    this.previewComponent.unload();
  }

  private async renderPreview() {
    if (!this.previewEl) return;
    this.previewEl.empty();
    this.previewEl.createEl('small', { text: 'Preview' });
    const container = this.previewEl.createDiv();
    await MarkdownRenderer.render(this.app, this.furtherInfo || '', container, '', this.previewComponent);
  }
}

class LocationModal extends Modal {
  plugin: NovalistPlugin;
  name: string = '';
  description: string = '';

  constructor(app: App, plugin: NovalistPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl('h2', { text: 'Create new location' });
    
    new Setting(contentEl)
      .setName('Name')
      .addText(text => text.onChange(value => this.name = value));
    
    new Setting(contentEl)
      .setName('Description')
      .addTextArea(text => text.onChange(value => this.description = value));
    
    const buttonDiv = contentEl.createDiv('modal-button-container');
    
    new ButtonComponent(buttonDiv)
      .setButtonText('Cancel')
      .onClick(() => this.close());
    
    new ButtonComponent(buttonDiv)
      .setButtonText('Create')
      .setCta()
      .onClick(async () => {
        await this.plugin.createLocation(this.name, this.description);
        this.close();
      });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

class ChapterDescriptionModal extends Modal {
  plugin: NovalistPlugin;
  name: string = '';
  order: string = '';
  outline: string = '';

  constructor(app: App, plugin: NovalistPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Create chapter description' });

    new Setting(contentEl)
      .setName('Name')
      .addText(text => text.onChange(value => this.name = value));

    new Setting(contentEl)
      .setName('Order')
      .addText(text => text.onChange(value => this.order = value));

    new Setting(contentEl)
      .setName('Outline')
      .addTextArea(text => text
        .setPlaceholder('Supports Markdown')
        .onChange(value => this.outline = value));

    const buttonDiv = contentEl.createDiv('modal-button-container');

    new ButtonComponent(buttonDiv)
      .setButtonText('Cancel')
      .onClick(() => this.close());

    new ButtonComponent(buttonDiv)
      .setButtonText('Create')
      .setCta()
      .onClick(async () => {
        await this.plugin.createChapterDescription(this.name, this.order, this.outline);
        this.close();
      });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// ==========================================
// SETTINGS TAB
// ==========================================

class NovalistSettingTab extends PluginSettingTab {
  plugin: NovalistPlugin;

  constructor(app: App, plugin: NovalistPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Preferences')
      .setHeading();

    new Setting(containerEl)
      .setName('Project path')
      .setDesc('Root folder for your novel project')
      .addText(text => text
        .setPlaceholder('Novel project')
        .setValue(this.plugin.settings.projectPath)
        .onChange(async (value) => {
          this.plugin.settings.projectPath = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Language')
      .setDesc('Choose default replacements for quotes and punctuation.')
      .addDropdown((dropdown) => {
        for (const [key, label] of Object.entries(LANGUAGE_LABELS)) {
          dropdown.addOption(key, label);
        }
        dropdown.setValue(this.plugin.settings.language);
        dropdown.onChange(async (value) => {
          if (!(value in LANGUAGE_LABELS)) return;
          const nextLanguage = value as LanguageKey;
          this.plugin.settings.language = nextLanguage;
          if (nextLanguage !== 'custom') {
            const defaults = LANGUAGE_DEFAULTS[nextLanguage];
            this.plugin.settings.autoReplacements = cloneAutoReplacements(defaults);
          }
          await this.plugin.saveSettings();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName('Auto replacements')
      .setHeading();
    containerEl.createEl('p', { text: 'Configure text shortcuts that will be auto-replaced while typing.' });

    const isCustomLanguage = this.plugin.settings.language === 'custom';
    if (!isCustomLanguage) {
      containerEl.createEl('p', { text: 'Switch language to custom to edit replacements.' });
    }

    const replacementContainer = containerEl.createDiv('novalist-replacements');
    const header = replacementContainer.createDiv('novalist-replacement-header');
    header.createEl('span', { text: 'Start token' });
    header.createEl('span', { text: 'End token' });
    header.createEl('span', { text: 'Start replacement' });
    header.createEl('span', { text: 'End replacement' });
    header.createEl('span', { text: '' });

    const updatePair = async () => {
      await this.plugin.saveSettings();
    };

    for (const pair of this.plugin.settings.autoReplacements) {
      const row = replacementContainer.createDiv('novalist-replacement-row');

      const startInput = row.createEl('input', { type: 'text', value: pair.start });
      startInput.placeholder = "For example: '";
      startInput.disabled = !isCustomLanguage;
      startInput.addEventListener('input', () => {
        pair.start = startInput.value;
        void updatePair();
      });

      const endInput = row.createEl('input', { type: 'text', value: pair.end });
      endInput.placeholder = 'Optional';
      endInput.disabled = !isCustomLanguage;
      endInput.addEventListener('input', () => {
        pair.end = endInput.value;
        void updatePair();
      });

      const startReplaceInput = row.createEl('input', { type: 'text', value: pair.startReplace });
      startReplaceInput.placeholder = 'For example: „';
      startReplaceInput.disabled = !isCustomLanguage;
      startReplaceInput.addEventListener('input', () => {
        pair.startReplace = startReplaceInput.value;
        void updatePair();
      });

      const endReplaceInput = row.createEl('input', { type: 'text', value: pair.endReplace });
      endReplaceInput.placeholder = 'Optional';
      endReplaceInput.disabled = !isCustomLanguage;
      endReplaceInput.addEventListener('input', () => {
        pair.endReplace = endReplaceInput.value;
        void updatePair();
      });

      const actions = row.createDiv();
      const deleteButton = new ButtonComponent(actions)
        .setIcon('trash')
        .setTooltip('Remove replacement');
      deleteButton.setDisabled(!isCustomLanguage);
      deleteButton.onClick(async () => {
        const index = this.plugin.settings.autoReplacements.indexOf(pair);
        if (index >= 0) this.plugin.settings.autoReplacements.splice(index, 1);
        await this.plugin.saveSettings();
        this.display();
      });
    }

    const actionsRow = containerEl.createDiv('novalist-replacement-actions');
    new ButtonComponent(actionsRow)
      .setButtonText('Add replacement')
      .setDisabled(!isCustomLanguage)
      .onClick(async () => {
        this.plugin.settings.autoReplacements.push({
          start: '',
          end: '',
          startReplace: '',
          endReplace: ''
        });
        await this.plugin.saveSettings();
        this.display();
      });

    new Setting(containerEl)
      .setName('Enable hover preview')
      .setDesc('Show character/location info on hover')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableHoverPreview)
        .onChange(async (value) => {
          this.plugin.settings.enableHoverPreview = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Enable sidebar view')
      .setDesc('Show the context sidebar')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableSidebarView)
        .onChange(async (value) => {
          this.plugin.settings.enableSidebarView = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Enable custom explorer')
      .setDesc('Replace the file explorer with a custom view')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableCustomExplorer)
        .onChange(async (value) => {
          this.plugin.settings.enableCustomExplorer = value;
          await this.plugin.saveSettings();
          if (value) {
            void this.plugin.activateExplorerView(true);
          }
        }));
  }

  
}

// ==========================================
// MAIN PLUGIN CLASS
// ==========================================

export default class NovalistPlugin extends Plugin {
  settings: NovalistSettings;
  private entityIndex: Map<string, { path: string; display: string }> = new Map();
  private entityRegex: RegExp | null = null;
  private lastHoverEntity: string | null = null;
  private hoverTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private caretTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private mergeLogPath: string | null = null;
  public knownRelationshipKeys: Set<string> = new Set();

  async onload() {
    await this.loadSettings();

    this.mergeLogPath = this.getMergeLogPath();
    if (this.mergeLogPath) {
      void this.logMerge('Merge logging initialized.');
    }

    await this.refreshEntityIndex();
    await this.syncAllCharactersChapterInfos();
    await this.migrateCharacterRoles();
    this.app.workspace.onLayoutReady(() => {
      void this.syncAllCharactersChapterInfos();
    });
    
    // Register Editor Suggester
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
        void this.initializeProjectStructure();
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
      name: 'Add chapter description',
      callback: () => {
        this.openChapterDescriptionModal();
      }
    });

    // Sync character chapter info command
    this.addCommand({
      id: 'sync-character-chapter-info',
      name: 'Sync character chapter info',
      callback: () => {
        void this.syncAllCharactersChapterInfos();
      }
    });

    this.addCommand({
      id: 'migrate-character-roles',
      name: 'Migrate character roles',
      callback: () => {
        void this.migrateCharacterRoles();
      }
    });

    // Settings tab
    this.addSettingTab(new NovalistSettingTab(this.app, this));

    const doc = globalThis.document;
    if (doc) {
      // Auto-replacement on typing
      this.registerDomEvent(doc, 'keyup', (evt: KeyboardEvent) => {
        if (evt.key.length === 1 || evt.key === 'Space' || evt.key === 'Enter') {
          this.handleAutoReplacement();
        }
      });
    }

    // Hover preview handler
    if (this.settings.enableHoverPreview) {
      this.registerHoverLinkSource('novalist', {
        display: 'Novalist',
        defaultMod: true,
      });
    }

    // Auto-link character/location names in reading view for hover previews (chapters only)
    this.registerMarkdownPostProcessor((el, ctx) => {
      if (!this.settings.enableHoverPreview) return;
      if (!ctx?.sourcePath || !this.isChapterPath(ctx.sourcePath)) return;
      this.linkifyElement(el);
    });

    // Edit-mode hover and click handling
    if (doc) {
      this.registerDomEvent(doc, 'mousemove', (evt: MouseEvent) => {
      if (!this.settings.enableHoverPreview) return;
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) return;
      if (!view.file || !this.isChapterFile(view.file)) return;
      const editor = view.editor;
      const cm = (editor as EditorWithCodeMirror).cm;
      if (!cm || !(evt.target instanceof Node) || !cm.dom?.contains(evt.target)) return;

      if (this.hoverTimer) globalThis.clearTimeout(this.hoverTimer);
      this.hoverTimer = globalThis.setTimeout(() => {
        const name = this.getEntityAtCoords(editor, evt.clientX, evt.clientY);
        if (!name) {
          if (!this.getEntityAtCursor(editor)) {
            this.clearFocus();
          }
          return;
        }
        if (name === this.lastHoverEntity) return;
        this.lastHoverEntity = name;
        void this.openEntityInSidebar(name, { reveal: false });
      }, 120);
      });
    }

    const handleEntityClick = (evt: MouseEvent) => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) return;
      if (!view.file || !this.isChapterFile(view.file)) return;
      const editor = view.editor;
      const cm = (editor as EditorWithCodeMirror).cm;
      if (!cm || !(evt.target instanceof Node) || !cm.dom?.contains(evt.target)) return;
      if (!evt.ctrlKey && !evt.metaKey) return;

      const name = this.getEntityAtCoords(editor, evt.clientX, evt.clientY);
      if (name) void this.openEntityInSidebar(name, { reveal: true });
    };
    if (doc) {
      this.registerDomEvent(doc, 'mousedown', handleEntityClick);
      this.registerDomEvent(doc, 'click', handleEntityClick);
    }

    // Caret-driven focus update (edit mode)
    const handleCaret = () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) return;
      if (!view.file || !this.isChapterFile(view.file)) {
        this.clearFocus();
        return;
      }
      const editor = view.editor;
      const name = this.getEntityAtCursor(editor);
      if (name) {
        void this.openEntityInSidebar(name, { reveal: false });
      } else {
        this.clearFocus();
      }
    };

    if (doc) {
      this.registerDomEvent(doc, 'selectionchange', () => {
        if (this.caretTimer) globalThis.clearTimeout(this.caretTimer);
        this.caretTimer = globalThis.setTimeout(handleCaret, 120);
      });
      this.registerDomEvent(doc, 'keyup', () => {
        if (this.caretTimer) globalThis.clearTimeout(this.caretTimer);
        this.caretTimer = globalThis.setTimeout(handleCaret, 120);
      });
    }

    // Keep index up to date
    this.registerEvent(this.app.vault.on('create', () => {
      void this.refreshEntityIndex();
    }));
    this.registerEvent(this.app.vault.on('delete', () => {
      void this.refreshEntityIndex();
    }));
    this.registerEvent(this.app.vault.on('modify', () => {
      void this.refreshEntityIndex();
    }));
    this.registerEvent(this.app.vault.on('rename', () => {
      void this.refreshEntityIndex();
    }));

    // Auto-create chapter files when chapter descriptions appear
    this.registerEvent(this.app.vault.on('create', (file) => {
      if (file instanceof TFile) void this.ensureChapterFileForDesc(file);
    }));
    this.registerEvent(this.app.vault.on('rename', (file) => {
      if (file instanceof TFile) void this.ensureChapterFileForDesc(file);
    }));

    // Sync character/location references into chapter descriptions
    this.registerEvent(this.app.vault.on('modify', (file) => {
      if (file instanceof TFile) void this.syncChapterDescriptionFromChapter(file);
    }));
    this.registerEvent(this.app.vault.on('rename', (file) => {
      if (file instanceof TFile) void this.syncChapterDescriptionFromChapter(file);
    }));

    // Ensure character chapter info sections stay in sync with chapter descriptions
    this.registerEvent(this.app.vault.on('create', (file) => {
      if (file instanceof TFile) void this.syncCharacterChapterInfos(file);
    }));
    this.registerEvent(this.app.vault.on('rename', (file) => {
      if (file instanceof TFile) void this.syncCharacterChapterInfos(file);
    }));

    // Auto-activate sidebar if enabled
    if (this.settings.enableSidebarView) {
      void this.activateView();
    }

    if (this.settings.enableCustomExplorer) {
      void this.activateExplorerView(true);
    }
  }

  onunload() {
    return;
  }

  async loadSettings() {
    const data: unknown = await this.loadData();
    const stored = this.isSettingsData(data) ? data : {};
    const language = this.isLanguageKey(stored.language) ? stored.language : DEFAULT_SETTINGS.language;
    const customLanguageLabel = typeof stored.customLanguageLabel === 'string' && stored.customLanguageLabel.trim().length > 0
      ? stored.customLanguageLabel.trim()
      : DEFAULT_SETTINGS.customLanguageLabel;
    const customLanguageDefaults = this.normalizeAutoReplacementPairs(stored.customLanguageDefaults);
    const normalized = {
      ...stored,
      language,
      customLanguageLabel,
      customLanguageDefaults,
      autoReplacements: this.normalizeAutoReplacements(stored.autoReplacements, language, customLanguageDefaults),
      relationshipPairs: stored.relationshipPairs || {}
    };
    this.settings = { ...DEFAULT_SETTINGS, ...normalized };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async addRelationshipToFile(file: TFile, relationshipKey: string, sourceName: string) {
    
    // Logic 1: Update persistent memory
    // If this call came from an inverse operation (keyA -> keyB), we should learn it.
    // However, this function is generic. We can just ensure we track the key.
    if (!this.knownRelationshipKeys.has(relationshipKey)) {
        this.knownRelationshipKeys.add(relationshipKey);
    }
    
    // We can try to infer the pair source.
    // If the source file has a relationship pointing to 'file' with key 'X', then X <-> relationshipKey is a pair.
    // This is expensive to check every time.
    // Better: Update the function signature or rely on the caller to update settings.
    
    // Wait, the caller (submit) knows the pair!
    
    const content = await this.app.vault.read(file);
    const lines = content.split('\n');
    const headerRegex = /^##\s+General Information\s*$/i;
    let headerIndex = -1;
    let generalInfoEnd = lines.length;

    for (let i = 0; i < lines.length; i++) {
        if (headerRegex.test(lines[i])) {
            headerIndex = i;
            // Find end of section
            for (let j = i + 1; j < lines.length; j++) {
                if (lines[j].trim().startsWith('## ')) {
                    generalInfoEnd = j;
                    break;
                }
            }
            break;
        }
    }

    // Try to find existing key in General Information section
    if (headerIndex !== -1) {
        for (let i = headerIndex + 1; i < generalInfoEnd; i++) {
            const line = lines[i];
            const match = line.match(/^(\s*[-*]\s*\*\*(.+?)\*\*([:]?)\s*)(.*)$/);
            if (match) {
                let key = match[2];
                // remove trailing colon if inside
                if (key.trim().endsWith(':')) key = key.trim().slice(0, -1);
                
                if (key.trim().toLowerCase() === relationshipKey.trim().toLowerCase()) {
                    // Found existing key! Append.
                    const existingValues = match[4];
                    // Clean up existing values, check if already exists
                    if (!existingValues.includes(`[[${sourceName}]]`)) {
                        // Append with comma if not empty
                        const separator = existingValues.trim().length > 0 ? ', ' : '';
                        lines[i] = `${match[1]}${existingValues.trimEnd()}${separator}[[${sourceName}]]`;
                        await this.app.vault.modify(file, lines.join('\n'));
                        new Notice(`Updated "${relationshipKey}" in ${file.basename}`);
                    }
                    return;
                }
            }
        }
    }

    const newLine = `- **${relationshipKey}**: [[${sourceName}]]`;

    if (headerIndex !== -1) {
        // Insert at end of General Information
        lines.splice(generalInfoEnd, 0, newLine);
    } else {
        if (lines[lines.length - 1].trim() !== '') {
            lines.push('');
        }
        lines.push('## General Information');
        lines.push(newLine);
    }

    await this.app.vault.modify(file, lines.join('\n'));
    new Notice(`Added "${relationshipKey}: [[${sourceName}]]" to ${file.basename}`);
  }

  async learnRelationshipPair(keyA: string, keyB: string) {
      let changed = false;
      
      // keyA -> keyB
      if (!this.settings.relationshipPairs[keyA]) {
          this.settings.relationshipPairs[keyA] = [keyB];
          changed = true;
      } else if (!this.settings.relationshipPairs[keyA].includes(keyB)) {
          this.settings.relationshipPairs[keyA].push(keyB);
          changed = true;
      }
      
      // keyB -> keyA
      if (!this.settings.relationshipPairs[keyB]) {
          this.settings.relationshipPairs[keyB] = [keyA];
          changed = true;
      } else if (!this.settings.relationshipPairs[keyB].includes(keyA)) {
          this.settings.relationshipPairs[keyB].push(keyA);
          changed = true;
      }
      
      if (changed) {
          await this.saveSettings();
      }
  }

  private isSettingsData(value: unknown): value is Partial<NovalistSettings> {
    return this.isRecord(value);
  }

  private normalizeAutoReplacements(
    value: unknown,
    language: LanguageKey,
    customDefaults: AutoReplacementPair[]
  ): AutoReplacementPair[] {
    if (language !== 'custom') {
      return cloneAutoReplacements(LANGUAGE_DEFAULTS[language]);
    }

    const fromValue = this.normalizeAutoReplacementPairs(value);
    if (fromValue.length > 0) return fromValue;

    if (customDefaults.length > 0) return cloneAutoReplacements(customDefaults);

    return cloneAutoReplacements(DEFAULT_SETTINGS.autoReplacements);
  }

  private normalizeAutoReplacementPairs(value: unknown): AutoReplacementPair[] {
    if (!value) return [];

    if (Array.isArray(value)) {
      const normalized: AutoReplacementPair[] = [];
      for (const entry of value as unknown[]) {
        if (!this.isRecord(entry)) continue;
        const start = this.getReplacementField(entry, 'start');
        const end = this.getReplacementField(entry, 'end');
        const startReplace = this.getReplacementField(entry, 'startReplace');
        const endReplace = this.getReplacementField(entry, 'endReplace');
        if (!start || !startReplace) continue;
        normalized.push({
          start,
          end: end || start,
          startReplace,
          endReplace: endReplace || startReplace
        });
      }
      return normalized;
    }

    if (this.isRecord(value)) {
      const normalized: AutoReplacementPair[] = [];
      for (const [key, replacement] of Object.entries(value)) {
        if (typeof key !== 'string') continue;
        if (typeof replacement !== 'string') continue;
        const start = key.trim();
        const startReplace = replacement.trim();
        if (!start || !startReplace) continue;
        normalized.push({ start, end: start, startReplace, endReplace: startReplace });
      }
      return normalized;
    }

    return [];
  }

  private getReplacementField(entry: Record<string, unknown>, key: string): string {
    const value = entry[key];
    return typeof value === 'string' ? value.trim() : '';
  }

  private isLanguageKey(value: unknown): value is LanguageKey {
    return typeof value === 'string' && value in LANGUAGE_LABELS;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private getMergeLogPath(): string | null {
    try {
      const configDir = this.app.vault.configDir;
      if (!configDir || !this.manifest?.id) return null;
      return `${configDir}/plugins/${this.manifest.id}/merge-log.txt`;
    } catch {
      return null;
    }
  }

  private async logMerge(message: string): Promise<void> {
    // Disabled
  }

  async activateView(): Promise<WorkspaceLeaf> {
    const { workspace } = this.app;
    
    let leaf = workspace.getLeavesOfType(NOVELIST_SIDEBAR_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: NOVELIST_SIDEBAR_VIEW_TYPE, active: true });
    }

    await workspace.revealLeaf(leaf);
    return leaf;
  }

  async activateExplorerView(replaceFileExplorer: boolean): Promise<WorkspaceLeaf> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;

    if (replaceFileExplorer) {
      leaf = workspace.getLeavesOfType('file-explorer')[0] ?? null;
    }

    if (!leaf) {
      leaf = workspace.getLeftLeaf(false);
    }

    await leaf.setViewState({ type: NOVELIST_EXPLORER_VIEW_TYPE, active: true });
    if (leaf) await workspace.revealLeaf(leaf);
    return leaf;
  }

  async activateCharacterMapView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(CHARACTER_MAP_VIEW_TYPE);
    
    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: CHARACTER_MAP_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  private getSidebarView(): NovalistSidebarView | null {
    const leaf = this.app.workspace.getLeavesOfType(NOVELIST_SIDEBAR_VIEW_TYPE)[0];
    if (!leaf) return null;
    return leaf.view instanceof NovalistSidebarView ? leaf.view : null;
  }

  private async ensureSidebarView(): Promise<NovalistSidebarView | null> {
    const leaf = await this.activateView();
    return leaf.view instanceof NovalistSidebarView ? leaf.view : null;
  }

  // ==========================================
  // PROJECT STRUCTURE
  // ==========================================

  async initializeProjectStructure() {
    const vault = this.app.vault;
    const root = this.settings.projectPath;

    // Create main folders
    const folders = [
      `${root}/${this.settings.characterFolder}`,
      `${root}/${this.settings.locationFolder}`,
      `${root}/${this.settings.chapterDescFolder}`,
      `${root}/${this.settings.chapterFolder}`
    ];

    for (const folder of folders) {
      try {
        await vault.createFolder(folder);
      } catch {
        // Folder might already exist
      }
    }

    // Create template files
    await this.createTemplateFiles();

    new Notice('Novel project structure initialized!');
  }

  async createTemplateFiles() {
    const vault = this.app.vault;
    const root = this.settings.projectPath;

    // Character Template
    const charTemplate = `# Character Name Surname

  ## General Information
  - **Age:** 
  - **Relationship:** 
  - **Character role:** Main character

## Further Information

## Images

- Portrait: path/to/image.png
- Action Shot: path/to/another-image.jpg

## Chapter Relevant Information
- **Chapter 1**:
  - age: 
  - relationship: 
  - further_info: 
  - info: 
<!-- This section is auto-populated by the plugin -->
`;
    
    // Location Template
    const locTemplate = `---
name: 
images: []
---

# Location Info

## Description

## Images

## Appearances
<!-- Auto-populated list of chapters -->
`;
    
    // Chapter Description Template
    const chapDescTemplate = `---
name: 
order: 
outline: 
character_refs: []
location_refs: []
---

# Chapter Description

## Outline

## Character References
<!-- Auto-filled from chapter content -->

## Location References
<!-- Auto-filled from chapter content -->
`;
    
    // Chapter Template
    const chapterTemplate = `---
title: 
chapter_number: 
description: 
characters: []
locations: []
---

# Chapter Title

<!-- Write your chapter here -->
`;

    const templates = [
      { path: `${root}/Templates/Character Template.md`, content: charTemplate },
      { path: `${root}/Templates/Location Template.md`, content: locTemplate },
      { path: `${root}/Templates/Chapter Description Template.md`, content: chapDescTemplate },
      { path: `${root}/Templates/Chapter Template.md`, content: chapterTemplate },
      { path: `${root}/${this.settings.characterFolder}/_Character Template.md`, content: charTemplate },
      { path: `${root}/${this.settings.locationFolder}/_Location Template.md`, content: locTemplate },
      { path: `${root}/${this.settings.chapterDescFolder}/_Chapter Description Template.md`, content: chapDescTemplate },
      { path: `${root}/${this.settings.chapterFolder}/_Chapter Template.md`, content: chapterTemplate }
    ];

    try {
      await vault.createFolder(`${root}/Templates`);
    } catch {
      // Folder might already exist
    }

    for (const tmpl of templates) {
      try {
        await vault.create(tmpl.path, tmpl.content);
      } catch {
        // File might exist
      }
    }
  }

  // ==========================================
  // FILE CREATION
  // ==========================================

  async createCharacter(
    name: string,
    surname: string,
    age: string,
    gender: string,
    relationship: string,
    role: CharacterRole,
    furtherInfo: string
  ) {
    const vault = this.app.vault;
    const folder = `${this.settings.projectPath}/${this.settings.characterFolder}`;
    const filename = `${name.trim() || 'Unnamed'}_${surname.trim()}.md`.replace(/_{2,}/g, '_').replace(/^_|_$/g, '');
    // Sanitize
    
    // Fallback if empty
    const fileBase = filename || 'New Character.md';
    const filepath = `${folder}/${fileBase}`;

    const content = `# ${name} ${surname}

  ## General Information
  - **Gender**: ${gender}
  - **Age**: ${age}
  - **Relationship**: ${relationship}
  - **Character role**: ${CHARACTER_ROLE_LABELS[role]}

  ## Further Information
  ${furtherInfo}

  ## Images

  - Portrait: path/to/image.png

  ## Chapter Relevant Information
  <!-- This section is auto-populated by the plugin -->
  `;

    try {
      await vault.create(filepath, content);
      new Notice(`Character ${name} ${surname} created!`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Error creating character: ${message}`);
    }
  }

  async createLocation(name: string, description: string) {
    const vault = this.app.vault;
    const folder = `${this.settings.projectPath}/${this.settings.locationFolder}`;
    const filename = `${name}.md`;
    const filepath = `${folder}/${filename}`;

    const content = `---
name: ${name}
images: []
---

# ${name}

## Description
${description}

## Images

## Appearances
`;

    try {
      await vault.create(filepath, content);
      new Notice(`Location ${name} created!`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Error creating location: ${message}`);
    }
  }

  async createChapterDescription(name: string, order: string, outline: string) {
    const vault = this.app.vault;
    const folder = `${this.settings.projectPath}/${this.settings.chapterDescFolder}`;
    const filename = `${name}.md`;
    const filepath = `${folder}/${filename}`;

    const content = `---
name: ${name}
order: ${order}
outline: ${outline}
character_refs: []
location_refs: []
---

# ${name}

## Outline
${outline}

## Character References
<!-- Auto-filled from chapter content -->

## Location References
<!-- Auto-filled from chapter content -->
`;

    try {
      await vault.create(filepath, content);
      new Notice(`Chapter description ${name} created!`);
      const file = this.app.vault.getAbstractFileByPath(filepath);
      if (file instanceof TFile) {
        await this.ensureChapterFileForDesc(file);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Error creating chapter description: ${message}`);
    }
  }

  openCharacterModal() {
    new CharacterModal(this.app, this).open();
  }

  openLocationModal() {
    new LocationModal(this.app, this).open();
  }

  openChapterDescriptionModal() {
    new ChapterDescriptionModal(this.app, this).open();
  }

  // ==========================================
  // PARSING LOGIC
  // ==========================================

  async parseCharacterFile(file: TFile): Promise<{
    name: string;
    surname: string;
    age: string;
    gender: string;
    relationship: string;
    role: string;
    furtherInfo: string;
    chapterInfos: Array<{chapter: string, info: string, overrides: Record<string, string>}>;
    customRelationships: Record<string, string[]>;
  }> {
    const content = await this.app.vault.read(file);
    const textData = this.parseCharacterText(content);
    
    const chapterInfos = this.parseChapterOverrides(content);

    return {
      name: textData.name || '',
      surname: textData.surname || '',
      age: textData.age || '',
      gender: textData.gender || '',
      relationship: textData.relationship || '',
      role: textData.role || '',
      furtherInfo: textData.furtherInfo || '',
      chapterInfos,
      customRelationships: textData.customRelationships
    };
  }

  async parseLocationFile(file: TFile): Promise<{
    name: string;
    description: string;
  }> {
    const content = await this.app.vault.read(file);
    const frontmatter = this.parseFrontmatter(content);
    
    const descMatch = content.match(/## Description\s+([\s\S]*?)(?=##|$)/);
    const description = descMatch ? descMatch[1].trim() : '';
    const name = this.getFrontmatterText(frontmatter.name);

    return {
      name,
      description
    };
  }

  parseImagesSection(content: string): Array<{ name: string; path: string }> {
    const match = content.match(/## Images\s+([\s\S]*?)(?=##|$)/);
    if (!match) return [];

    const lines = match[1].split('\n').map(l => l.trim()).filter(l => l.startsWith('-'));
    const images: Array<{ name: string; path: string }> = [];

    for (const line of lines) {
      const cleaned = line.replace(/^[-*]\s*/, '').trim();
      if (!cleaned) continue;

      const parts = cleaned.split(':');
      if (parts.length >= 2) {
        const first = parts.shift();
        if (!first) continue;
        const name = first.trim();
        const path = parts.join(':').trim();
        if (name && path) images.push({ name, path });
      } else {
        images.push({ name: cleaned, path: cleaned });
      }
    }

    return images;
  }

  private parseCharacterText(content: string): { 
      name: string; 
      surname: string; 
      age: string; 
      gender: string; 
      relationship: string; 
      role: string; 
      furtherInfo: string;
      customRelationships: Record<string, string[]>;
  } {
    const body = this.stripFrontmatter(content);
    let name = '';
    let surname = '';
    let age = '';
    let gender = '';
    let relationship = '';
    let role = CHARACTER_ROLE_LABELS.side;
    let roleSet = false;
    let furtherInfo = '';
    const customRelationships: Record<string, string[]> = {};

    const titleMatch = body.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      const fullName = titleMatch[1].trim();
      const parts = fullName.split(' ');
      name = parts.shift() || '';
      surname = parts.join(' ');
    }

    const generalLines = this.getSectionLines(body, 'General Information');
    if (generalLines) {
      for (const line of generalLines) {
        const trimmedLine = line.trim();
        // Relaxed regex to support both **Key**: and **Key:**
        const ageMatch = trimmedLine.match(/^[-*]\s*\*\*Age(?:[:])?\*\*(?:[:])?\s*(.+)$/i);
        if (ageMatch) {
          age = ageMatch[1].trim();
          continue;
        }
        const genderMatch = trimmedLine.match(/^[-*]\s*\*\*Gender(?:[:])?\*\*(?:[:])?\s*(.+)$/i);
        if (genderMatch) {
          gender = genderMatch[1].trim();
          continue;
        }
        const relMatch = trimmedLine.match(/^[-*]\s*\*\*Relationship\*\*:\s*(.+)$/i);
        if (relMatch) {
          relationship = relMatch[1].trim();
          // Check for wikilinks here too? Usually 'Single', but maybe 'Dating [[Bob]]'
          // We will treat it as a custom relationship if it has links
        }
        const roleMatch = trimmedLine.match(/^[-*]\s*\*\*(?:Character\s+)?role(?:[:\s]*\*\*[:\s]*|\*\*[:\s]*)(.+)$/i);
        if (roleMatch && !roleSet) {
          role = normalizeCharacterRole(roleMatch[1]);
          roleSet = true;
          continue;
        }

        // Catch-all for relationships
        const genericMatch = trimmedLine.match(/^[-*]\s*\*\*(.+?)\*\*(?:[:])?\s*(.*)$/);
        if (genericMatch) {
            const key = genericMatch[1].trim();
            // removing any trailing colon in key
            const cleanKey = key.replace(/:$/, '').trim();
            const value = genericMatch[2].trim();
            
            // Extract links
            const links = value.match(/\[\[(.*?)\]\]/g);
            if (links) {
                const targets = links.map(l => l.replace(/^\[\[|\]\]$/g, '').split('|')[0]);
                if (!customRelationships[cleanKey]) {
                    customRelationships[cleanKey] = [];
                }
                customRelationships[cleanKey].push(...targets);
            }
        }
      }
    }

    const furtherMatch = body.match(/## Further Information\s+([\s\S]*?)(?=##|$)/);
    if (furtherMatch) {
      furtherInfo = furtherMatch[1].trim();
    }

    return { name, surname, age, gender, relationship, role, furtherInfo, customRelationships };
  }

  private getSectionLines(content: string, heading: string): string[] | null {
    const lines = content.split(/\r?\n/);
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const headerRegex = new RegExp(`^##\\s+${escaped}\\s*$`, 'i');

    const headerIndex = lines.findIndex((line) => headerRegex.test(line.trim()));
    if (headerIndex === -1) return null;

    let endIndex = lines.length;
    for (let i = headerIndex + 1; i < lines.length; i += 1) {
      if (/^##\s+/.test(lines[i].trim())) {
        endIndex = i;
        break;
      }
    }

    return lines.slice(headerIndex + 1, endIndex);
  }

  parseChapterOverrides(content: string): Array<{ chapter: string; info: string; overrides: Record<string, string> }> {
    const section = content.match(/## Chapter Relevant Information\s+([\s\S]*?)(?=##|$)/);
    if (!section) return [];

    const lines = section[1].split('\n');
    const results: Array<{ chapter: string; info: string; overrides: Record<string, string> }> = [];

    let current: { chapter: string; info: string; overrides: Record<string, string> } | null = null;
    let currentKey: string | null = null;

    for (const raw of lines) {
      const line = raw.trim();
      const chapterMatch = line.match(/^[-*]\s*\*\*([^*]+)\*\*(?:\s*\([^)]*\))?\s*:?\s*$/);
      if (chapterMatch) {
        if (current) results.push(current);
        current = { chapter: chapterMatch[1].trim(), info: '', overrides: {} };
        currentKey = null;
        continue;
      }

      if (!current) continue;

      const kvMatch = line.match(/^[-*]\s*([^:]+):\s*(.*)$/);
      if (kvMatch) {
        const key = kvMatch[1].trim();
        const value = kvMatch[2].trim();
        currentKey = key.toLowerCase();
        if (currentKey === 'info') {
          current.info = value;
        } else {
          current.overrides[currentKey] = value;
        }
      } else if (/^\s{2,}\S/.test(raw) && currentKey) {
        const continuation = raw.trimEnd();
        if (currentKey === 'info') {
          current.info = current.info ? `${current.info}\n${continuation.trim()}` : continuation.trim();
        } else {
          const prev = current.overrides[currentKey] || '';
          current.overrides[currentKey] = prev ? `${prev}\n${continuation.trim()}` : continuation.trim();
        }
      } else if (line.length > 0) {
        current.info = current.info ? `${current.info}\n${line}` : line;
      }
    }

    if (current) results.push(current);
    return results;
  }

  resolveImagePath(imagePath: string, sourcePath: string): TFile | null {
    const linkpath = imagePath.replace(/^!\[\[|\]\]$/g, '').trim();
    const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    if (dest && dest instanceof TFile) return dest;

    const direct = this.app.vault.getAbstractFileByPath(linkpath);
    return direct instanceof TFile ? direct : null;
  }

  private async syncAllCharactersChapterInfos() {
    const folder = `${this.settings.projectPath}/${this.settings.characterFolder}`;
    const files = this.app.vault.getFiles().filter(f => f.path.startsWith(folder) && !this.isTemplateFile(f));
    for (const file of files) {
      await this.ensureCharacterChapterInfos(file);
    }
  }

  private async syncCharacterChapterInfos(file: TFile) {
    const descFolder = `${this.settings.projectPath}/${this.settings.chapterDescFolder}`;
    if (!file.path.startsWith(descFolder)) return;
    await this.syncAllCharactersChapterInfos();
  }

  private async migrateCharacterRoles(): Promise<void> {
    const folder = `${this.settings.projectPath}/${this.settings.characterFolder}`;
    const files = this.app.vault.getFiles().filter(f => f.path.startsWith(folder) && !this.isTemplateFile(f));

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const updated = this.ensureCharacterRoleLine(content);
      if (updated !== content) {
        await this.app.vault.modify(file, updated);
      }
    }
  }

  private ensureCharacterRoleLine(content: string): string {
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);
    const headerIndex = lines.findIndex((line) => /^##\s+General Information\s*$/i.test(line.trim()));
    if (headerIndex === -1) return content;

    let endIndex = lines.length;
    for (let i = headerIndex + 1; i < lines.length; i += 1) {
      if (/^##\s+/.test(lines[i].trim())) {
        endIndex = i;
        break;
      }
    }

    const sectionLines = lines.slice(headerIndex + 1, endIndex);
    let roleValue: string | null = null;
    const cleanedLines: string[] = [];
    let removedRole = false;

    for (const line of sectionLines) {
      const trimmedLine = line.trim();
      const roleMatch = trimmedLine.match(/^[-*]\s*\*\*(?:Character\s+)?role(?:[:\s]*\*\*[:\s]*|\*\*[:\s]*)(.+)$/i);

      if (roleMatch) {
        if (!roleValue) {
          roleValue = normalizeCharacterRole(roleMatch[1]);
        }
        removedRole = true;
        if (cleanedLines[cleanedLines.length - 1]?.trim() === '') {
          cleanedLines.pop();
        }
        continue;
      }

      if (removedRole && trimmedLine === '') {
        removedRole = false;
        continue;
      }

      removedRole = false;
      cleanedLines.push(line);
    }

    // Collapse consecutive blank lines in General Information
    for (let i = cleanedLines.length - 1; i > 0; i -= 1) {
      if (cleanedLines[i].trim() === '' && cleanedLines[i - 1].trim() === '') {
        cleanedLines.splice(i, 1);
      }
    }

    const resolvedRole = roleValue ?? CHARACTER_ROLE_LABELS.side;
    const roleLine = `- **Character role:** ${resolvedRole}`;
    const relIndex = cleanedLines.findIndex((line) => /\*\*Relationship\*\*/i.test(line.trim()));
    const ageIndex = cleanedLines.findIndex((line) => /\*\*Age\*\*/i.test(line.trim()));
    const blankIndex = cleanedLines.findIndex((line) => line.trim() === '');

    if (relIndex >= 0 && cleanedLines[relIndex + 1]?.trim() === '') {
      cleanedLines.splice(relIndex + 1, 1);
    }

    let insertAt = relIndex >= 0
      ? relIndex + 1
      : (ageIndex >= 0 ? ageIndex + 1 : (blankIndex >= 0 ? blankIndex : cleanedLines.length));
    if (insertAt < cleanedLines.length && cleanedLines[insertAt].trim() === '') {
      insertAt = Math.max(insertAt - 1, 0);
    }
    cleanedLines.splice(insertAt, 0, roleLine);

    const updated = [...lines.slice(0, headerIndex + 1), ...cleanedLines, ...lines.slice(endIndex)].join(newline);
    return updated;
  }

  private async ensureCharacterChapterInfos(charFile: TFile) {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile.path === charFile.path) return;

    const content = await this.app.vault.read(charFile);
    const chapters = await this.getChapterDescriptions();
    if (chapters.length === 0) return;

    const existing = this.parseChapterOverrides(content);
    const existingMap = new Map(existing.map(c => [c.chapter, c]));

    const formatValue = (value: string) => {
      if (!value) return '';
      if (!value.includes('\n')) return ` ${value}`;
      const lines = value.split('\n').map(l => l.trim());
      return `\n    ${lines.join('\n    ')}`;
    };

    const entries = chapters
      .map(c => {
        const prev = existingMap.get(c.name);
        const age = prev?.overrides?.age ?? '';
        const relationship = prev?.overrides?.relationship ?? '';
        const furtherInfo = prev?.overrides?.further_info ?? '';
        const info = prev?.info ?? '';

        return `- **${c.name}**${c.order ? ` (Order: ${c.order})` : ''}:\n` +
          `  - age:${formatValue(age)}\n` +
          `  - relationship:${formatValue(relationship)}\n` +
          `  - further_info:${formatValue(furtherInfo)}\n` +
          `  - info:${formatValue(info)}`;
      })
      .join('\n');

    const section = content.match(/## Chapter Relevant Information\s+([\s\S]*?)(?=##|$)/);
    const newSection = `## Chapter Relevant Information\n${entries}\n`;

    if (!section) {
      const append = `\n${newSection}`;
      const updated = `${content.trim()}\n\n${append}`;
      if (updated !== content) {
        await this.app.vault.modify(charFile, updated);
      }
      return;
    }

    if (section[0] === newSection) return;

    const updated = content.replace(section[0], newSection);
    if (updated !== content) {
      await this.app.vault.modify(charFile, updated);
    }
  }

  private async getChapterDescriptions(): Promise<Array<{ name: string; order?: string; file: TFile }>> {
    const folder = `${this.settings.projectPath}/${this.settings.chapterDescFolder}`;
    const files = this.app.vault.getFiles().filter(f => f.path.startsWith(folder) && f.extension === 'md' && !f.basename.startsWith('_'));
    const chapters: Array<{ name: string; order?: string; file: TFile }> = [];

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const fm = this.parseFrontmatter(content);
      const name = this.getFrontmatterText(fm.name) || file.basename || '';
      const orderText = this.getFrontmatterText(fm.order);
      const order = orderText.length > 0 ? orderText : undefined;
      if (name) chapters.push({ name, order, file });
    }

    chapters.sort((a, b) => {
      const ao = a.order ? Number(a.order) : NaN;
      const bo = b.order ? Number(b.order) : NaN;
      if (!Number.isNaN(ao) && !Number.isNaN(bo) && ao !== bo) return ao - bo;
      if (!Number.isNaN(ao) && Number.isNaN(bo)) return -1;
      if (Number.isNaN(ao) && !Number.isNaN(bo)) return 1;
      return a.name.localeCompare(b.name);
    });

    return chapters;
  }

  async getChapterList(): Promise<Array<{ name: string; file: TFile; descFile: TFile }>> {
    const chapters = await this.getChapterDescriptions();
    const results: Array<{ name: string; file: TFile; descFile: TFile }> = [];
    const chapterFolder = `${this.settings.projectPath}/${this.settings.chapterFolder}`;

    for (const chapter of chapters) {
      const chapterPath = `${chapterFolder}/${chapter.file.basename}.md`;
      const chapterFile = this.app.vault.getAbstractFileByPath(chapterPath);
      const file = chapterFile instanceof TFile ? chapterFile : chapter.file;
      results.push({ name: chapter.name, file, descFile: chapter.file });
    }

    return results;
  }

  async updateChapterOrder(descFiles: TFile[]): Promise<void> {
    for (let index = 0; index < descFiles.length; index += 1) {
      const file = descFiles[index];
      const content = await this.app.vault.read(file);
      const fm = this.parseFrontmatter(content);
      fm.order = String(index + 1);

      const fmLines = Object.entries(fm)
        .map(([key, value]) => {
          if (Array.isArray(value)) return `${key}: [${value.join(', ')}]`;
          return `${key}: ${value}`;
        })
        .join('\n');

      const newFrontmatter = `---\n${fmLines}\n---`;
      const body = this.stripFrontmatter(content);
      const updated = `${newFrontmatter}\n\n${body.trim()}\n`;

      if (updated !== content) {
        await this.app.vault.modify(file, updated);
      }
    }
  }

  async getCharacterList(): Promise<Array<{ name: string; file: TFile; role: string; gender: string }>> {
    const folder = `${this.settings.projectPath}/${this.settings.characterFolder}`;
    const files = this.app.vault.getFiles().filter(f => f.path.startsWith(folder) && !this.isTemplateFile(f));
    const results: Array<{ name: string; file: TFile; surname: string; firstName: string; role: string; gender: string }> = [];

    for (const file of files) {
      const data = await this.parseCharacterFile(file);
      const display = `${data.name} ${data.surname}`.trim();
      const surname = data.surname || data.name;
      results.push({ name: display || file.basename, file, surname, firstName: data.name, role: data.role, gender: data.gender });
    }

    results.sort((a, b) => {
      const surnameCompare = a.surname.localeCompare(b.surname);
      if (surnameCompare !== 0) return surnameCompare;
      const nameCompare = a.firstName.localeCompare(b.firstName);
      if (nameCompare !== 0) return nameCompare;
      return a.name.localeCompare(b.name);
    });

    return results.map(({ name, file, role, gender }) => ({ name, file, role, gender }));
  }

  async updateCharacterRole(file: TFile, roleLabel: string): Promise<void> {
    let content = await this.app.vault.read(file);
    content = this.ensureCharacterRoleLine(content);
    
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);
    const roleRegex = /^([-*]\s*\*\*(?:Character\s+)?role(?:[:\s]*\*\*[:\s]*|\*\*[:\s]*))(.+)$/i;
    
    let modified = false;
    const updatedLines = lines.map(line => {
        if (roleRegex.test(line.trim())) {
            modified = true;
            return `- **Character role:** ${roleLabel}`;
        }
        return line;
    });

    if (modified) {
        await this.app.vault.modify(file, updatedLines.join(newline));
    }
  }

  async getLocationList(): Promise<Array<{ name: string; file: TFile }>> {
    const folder = `${this.settings.projectPath}/${this.settings.locationFolder}`;
    const files = this.app.vault.getFiles().filter(f => f.path.startsWith(folder) && !this.isTemplateFile(f));
    const results: Array<{ name: string; file: TFile }> = [];

    for (const file of files) {
      const data = await this.parseLocationFile(file);
      const name = data.name || file.basename;
      results.push({ name, file });
    }

    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
  }

  async getChapterNameForFile(file: TFile): Promise<string> {
    const descFolder = `${this.settings.projectPath}/${this.settings.chapterDescFolder}`;
    const descPath = `${descFolder}/${file.basename}.md`;
    const descFile = this.app.vault.getAbstractFileByPath(descPath);
    if (descFile instanceof TFile) {
      const descContent = await this.app.vault.read(descFile);
      const fm = this.parseFrontmatter(descContent);
      const name = this.getFrontmatterText(fm.name) || descFile.basename || '';
      if (name) return name;
    }

    const content = await this.app.vault.read(file);
    const fm = this.parseFrontmatter(content);
    const title = this.getFrontmatterText(fm.title) || file.basename || '';
    return title || file.basename;
  }

  async parseChapterFile(file: TFile): Promise<{
    characters: string[];
    locations: string[];
  }> {
    const content = await this.app.vault.read(file);
    const frontmatter = this.parseFrontmatter(content);
    
    // Also scan content for character/location mentions
    const textContent = content.replace(/---[\s\S]*?---/, ''); // Remove frontmatter
    
    const characters = Array.isArray(frontmatter.characters) ? [...frontmatter.characters] : [];
    const locations = Array.isArray(frontmatter.locations) ? [...frontmatter.locations] : [];

    // Scan for mentions and link them
    const charFolder = `${this.settings.projectPath}/${this.settings.characterFolder}`;
    const locFolder = `${this.settings.projectPath}/${this.settings.locationFolder}`;

    // Get all character files to check for mentions
    const charFiles = this.app.vault.getFiles().filter(f => f.path.startsWith(charFolder) && !this.isTemplateFile(f));
    const locFiles = this.app.vault.getFiles().filter(f => f.path.startsWith(locFolder) && !this.isTemplateFile(f));

    for (const charFile of charFiles) {
      const charData = await this.parseCharacterFile(charFile);
      const fullName = `${charData.name} ${charData.surname}`;
      const searchName = charData.name;
      const searchSurname = charData.surname;
      
      if ((textContent.includes(fullName) || textContent.includes(searchName) || textContent.includes(searchSurname)) 
          && !characters.includes(fullName)) {
        characters.push(fullName);
      }
    }

    for (const locFile of locFiles) {
      const locData = await this.parseLocationFile(locFile);
      if (textContent.includes(locData.name) && !locations.includes(locData.name)) {
        locations.push(locData.name);
      }
    }

    return { characters, locations };
  }

  parseFrontmatter(content: string): Record<string, FrontmatterValue> {
    const fmBlock = this.extractFrontmatter(content);
    if (!fmBlock) return {};

    const fm: Record<string, FrontmatterValue> = {};
    const lines = fmBlock.split('\n');
    
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const rawValue = line.substring(colonIndex + 1).trim();
        let value: FrontmatterValue = rawValue;
        
        // Handle arrays
        if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
          value = rawValue.slice(1, -1).split(',').map((v) => v.trim()).filter((v) => v);
        }
        
        fm[key] = value;
      }
    }
    
    return fm;
  }

  private getFrontmatterText(value: FrontmatterValue | undefined): string {
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) {
      return value.map((entry) => entry.trim()).filter(Boolean).join(', ');
    }
    return '';
  }

  async findCharacterFile(name: string): Promise<TFile | null> {
    const folder = `${this.settings.projectPath}/${this.settings.characterFolder}`;
    const files = this.app.vault.getFiles().filter(f => f.path.startsWith(folder) && !this.isTemplateFile(f));
    
    for (const file of files) {
      const data = await this.parseCharacterFile(file);
      const fullName = `${data.name} ${data.surname}`;
      if (fullName === name || data.name === name || data.surname === name) {
        return file;
      }
    }
    return null;
  }

  async findLocationFile(name: string): Promise<TFile | null> {
    const folder = `${this.settings.projectPath}/${this.settings.locationFolder}`;
    const files = this.app.vault.getFiles().filter(f => f.path.startsWith(folder) && !this.isTemplateFile(f));
    
    for (const file of files) {
      const data = await this.parseLocationFile(file);
      if (data.name === name) {
        return file;
      }
    }
    return null;
  }

  // ==========================================
  // AUTO REPLACEMENT
  // ==========================================

  handleAutoReplacement() {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) return;

    const file = activeView.file;
    if (!file || !this.isChapterFile(file)) return;

    const editor = activeView.editor;
    if (this.isCursorInFrontmatter(editor)) return;
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    const result = this.applyAutoReplacement(line, cursor.ch);
    if (!result) return;

    editor.setLine(cursor.line, result.line);
    editor.setCursor({ line: cursor.line, ch: result.cursorCh });
  }

  private applyAutoReplacement(line: string, cursorCh: number): { line: string; cursorCh: number } | null {
    for (const pair of this.settings.autoReplacements) {
      if (!pair.start || !pair.startReplace) continue;
      const startToken = pair.start;
      const endToken = pair.end || pair.start;
      const startReplace = pair.startReplace;
      const endReplace = pair.endReplace || pair.startReplace;

      if (this.endsWithToken(line, cursorCh, startToken)) {
        if (startToken === endToken) {
          if (startReplace === endReplace) {
            return this.replaceAtCursor(line, cursorCh, startToken, startReplace);
          }
          const prefix = line.slice(0, cursorCh - startToken.length);
          const openCount = this.countOccurrences(prefix, startReplace);
          const closeCount = this.countOccurrences(prefix, endReplace);
          const useStart = openCount <= closeCount;
          const replacement = useStart ? startReplace : endReplace;
          return this.replaceAtCursor(line, cursorCh, startToken, replacement);
        }

        return this.replaceAtCursor(line, cursorCh, startToken, startReplace);
      }

      if (endToken && this.endsWithToken(line, cursorCh, endToken)) {
        return this.replaceAtCursor(line, cursorCh, endToken, endReplace);
      }
    }

    return null;
  }

  private endsWithToken(line: string, cursorCh: number, token: string): boolean {
    if (!token) return false;
    if (cursorCh < token.length) return false;
    return line.slice(cursorCh - token.length, cursorCh) === token;
  }

  private replaceAtCursor(
    line: string,
    cursorCh: number,
    token: string,
    replacement: string
  ): { line: string; cursorCh: number } {
    const startIndex = cursorCh - token.length;
    const updated = `${line.slice(0, startIndex)}${replacement}${line.slice(cursorCh)}`;
    const nextCursor = startIndex + replacement.length;
    return { line: updated, cursorCh: nextCursor };
  }

  private countOccurrences(text: string, search: string): number {
    if (!search) return 0;
    let count = 0;
    let index = 0;
    while (true) {
      const next = text.indexOf(search, index);
      if (next === -1) break;
      count += 1;
      index = next + search.length;
    }
    return count;
  }

  private isCursorInFrontmatter(editor: Editor): boolean {
    const cursor = editor.getCursor();
    let inFrontmatter = false;
    for (let i = 0; i <= cursor.line; i++) {
      const text = editor.getLine(i)?.trim() ?? '';
      if (text.length === 0) continue;
      if (/^[-—–]{3,}\s*$/.test(text)) {
        inFrontmatter = !inFrontmatter;
      }
      if (!inFrontmatter && i < cursor.line) {
        // past frontmatter
        break;
      }
    }
    return inFrontmatter;
  }

  // ==========================================
  // AUTO LINKING / HOVER SUPPORT
  // ==========================================

  private async refreshEntityIndex() {
    const index = new Map<string, { path: string; display: string }>();

    const charFolder = `${this.settings.projectPath}/${this.settings.characterFolder}`;
    const locFolder = `${this.settings.projectPath}/${this.settings.locationFolder}`;

    const charFiles = this.app.vault.getFiles().filter(f => f.path.startsWith(charFolder) && !this.isTemplateFile(f));
    const locFiles = this.app.vault.getFiles().filter(f => f.path.startsWith(locFolder) && !this.isTemplateFile(f));
    
    // Scan for relationship keys
    const relationshipKeys = new Set<string>();

    for (const charFile of charFiles) {
      try {
        const data = await this.parseCharacterFile(charFile);
        
        // Use parsing logic to find keys in General Information
        const content = await this.app.vault.read(charFile);
        const generalLines = this.getSectionLines(content, 'General Information');
        for (const line of generalLines) {
           const match = line.match(/^\s*[-*]\s*\*\*(.+?)\*\*([:]?)/);
           if (match) {
             const key = match[1].trim();
             // Clean trait key from trailing colon if present
             const cleanKey = key.endsWith(':') ? key.slice(0, -1).trim() : key;
             if (cleanKey) relationshipKeys.add(cleanKey);
           }
        }
        
        const fullName = `${data.name} ${data.surname}`.trim();
        if (fullName) index.set(fullName.toLowerCase(), { path: charFile.path, display: fullName });
        if (data.name) index.set(data.name.toLowerCase(), { path: charFile.path, display: data.name });
        if (data.surname) index.set(data.surname.toLowerCase(), { path: charFile.path, display: data.surname });
        if (charFile.basename) index.set(charFile.basename.toLowerCase(), { path: charFile.path, display: fullName || charFile.basename });
      } catch {
        // ignore parse errors
      }
    }
    
    this.knownRelationshipKeys = relationshipKeys;

    for (const locFile of locFiles) {
      try {
        const data = await this.parseLocationFile(locFile);
        if (data.name) index.set(data.name.toLowerCase(), { path: locFile.path, display: data.name });
        if (locFile.basename) index.set(locFile.basename.toLowerCase(), { path: locFile.path, display: data.name || locFile.basename });
      } catch {
        // ignore parse errors
      }
    }

    this.entityIndex = index;
    this.entityRegex = this.buildEntityRegex([...index.keys()]);
  }

  private buildEntityRegex(names: string[]): RegExp | null {
    if (names.length === 0) return null;
    const unique = Array.from(new Set(names))
      .filter(n => n.length > 0)
      .sort((a, b) => b.length - a.length)
      .map(n => this.escapeRegex(n));
    if (unique.length === 0) return null;
    return new RegExp(`(${unique.join('|')})`, 'gi');
  }

  private escapeRegex(text: string) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private isWordChar(ch: string | undefined) {
    return !!ch && /[A-Za-z0-9_]/.test(ch);
  }

  private getWordAtCursor(editor: Editor): string | null {
    const cursor = editor.getCursor();
    const lineText = editor.getLine(cursor.line);
    if (!lineText) return null;

    let start = cursor.ch;
    let end = cursor.ch;

    while (start > 0 && this.isWordChar(lineText[start - 1])) start--;
    while (end < lineText.length && this.isWordChar(lineText[end])) end++;

    const word = lineText.slice(start, end).trim();
    return word.length > 0 ? word : null;
  }

  private getEntityAtCursor(editor: Editor): string | null {
    const cursor = editor.getCursor();
    const lineText = editor.getLine(cursor.line);
    if (!lineText) return null;
    return this.findEntityAtPosition(lineText, cursor.ch);
  }

  private getWordAtCoords(editor: Editor, x: number, y: number): string | null {
    const pos = this.getPosAtCoords(editor, x, y);
    if (!pos) return null;

    const { lineText, ch } = pos;
    let start = ch;
    let end = ch;

    while (start > 0 && this.isWordChar(lineText[start - 1])) start--;
    while (end < lineText.length && this.isWordChar(lineText[end])) end++;

    const word = lineText.slice(start, end).trim();
    return word.length > 0 ? word : null;
  }

  private getEntityAtCoords(editor: Editor, x: number, y: number): string | null {
    const pos = this.getPosAtCoords(editor, x, y);
    if (!pos) return null;

    const { lineText, ch } = pos;
    return this.findEntityAtPosition(lineText, ch) ?? this.getWordAtCoords(editor, x, y);
  }

  private getPosAtCoords(editor: Editor, x: number, y: number): { lineText: string; ch: number } | null {
    const cm = (editor as EditorWithCodeMirror).cm;
    if (!cm?.posAtCoords || !cm?.state?.doc) return null;
    const pos = cm.posAtCoords({ x, y });
    if (pos == null) return null;

    const line = cm.state.doc.lineAt(pos);
    const lineText = line.text;
    const ch = pos - line.from;
    return { lineText, ch };
  }

  private findEntityAtPosition(lineText: string, ch: number): string | null {
    if (!this.entityRegex) return null;

    const regex = new RegExp(this.entityRegex.source, 'gi');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(lineText)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (ch < start || ch > end) continue;

      const before = start > 0 ? lineText[start - 1] : undefined;
      const after = end < lineText.length ? lineText[end] : undefined;
      if (this.isWordChar(before) || this.isWordChar(after)) continue;

      return match[0];
    }

    return null;
  }

  stripFrontmatter(content: string): string {
    const extracted = this.extractFrontmatterAndBody(content);
    return extracted ? extracted.body : content;
  }

  stripChapterRelevantSection(content: string): string {
    return content.replace(/## Chapter Relevant Information\s+[\s\S]*?(?=##|$)/, '').trim();
  }

  stripImagesSection(content: string): string {
    return content.replace(/## Images\s+[\s\S]*?(?=##|$)/, '').trim();
  }

  extractTitle(content: string): string | null {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
  }

  removeTitle(content: string): string {
    return content.replace(/^#\s+.+\n?/, '').trim();
  }

  applyCharacterOverridesToBody(content: string, overrides: Record<string, string>): string {
    if (!overrides || Object.keys(overrides).length === 0) {
      return content;
    }

    return content.replace(/## General Information\s+([\s\S]*?)(?=##|$)/, (_match: string, section: string) => {
      const lines = section.split('\n');
      const filtered = lines.filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return true;
        // Updated regex to handle loose formatting (colon inside or outside) same as Role
        if (/^\s*[-*]\s*\*\*Age(?:[:\s]*\*\*[:\s]*|\*\*[:\s]*)/i.test(trimmed)) {
          return overrides.age ? false : true;
        }
        if (/^\s*[-*]\s*\*\*Relationship(?:[:\s]*\*\*[:\s]*|\*\*[:\s]*)/i.test(trimmed)) {
          return overrides.relationship ? false : true;
        }
        return true;
      });

      if (overrides.age) {
        filtered.push(`- **Age:** ${overrides.age}`);
      }

      if (overrides.relationship) {
        filtered.push(`- **Relationship:** ${overrides.relationship}`);
      }

      const updated = filtered.join('\n').trim();
      return `## General Information\n${updated}\n`;
    });
  }

  private extractFrontmatter(content: string): string | null {
    const extracted = this.extractFrontmatterAndBody(content);
    return extracted ? extracted.frontmatter : null;
  }

  private extractFrontmatterAndBody(content: string): { frontmatter: string; body: string } | null {
    const lines = content.split('\n');
    if (lines.length === 0) return null;

    const isDelimiter = (line: string) => /^[-—–]{3,}\s*$/.test(line.trim());

    if (!isDelimiter(lines[0])) return null;

    let endIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if (isDelimiter(lines[i])) {
        endIndex = i;
        break;
      }
    }

    if (endIndex === -1) return null;

    const frontmatter = lines.slice(1, endIndex).join('\n');
    const body = lines.slice(endIndex + 1).join('\n');
    return { frontmatter, body };
  }

  private isChapterFile(file: TFile): boolean {
    const folder = `${this.settings.projectPath}/${this.settings.chapterFolder}`;
    if (!file.path.startsWith(folder)) return false;
    if (file.extension !== 'md') return false;
    if (file.basename.startsWith('_')) return false;
    return true;
  }

  private isChapterPath(path: string): boolean {
    const folder = `${this.settings.projectPath}/${this.settings.chapterFolder}`;
    if (!path.startsWith(folder)) return false;
    if (!path.endsWith('.md')) return false;
    const base = path.split('/').pop() || '';
    if (base.startsWith('_')) return false;
    return true;
  }

  private isTemplateFile(file: TFile): boolean {
    if (file.basename.startsWith('_')) return true;
    const templatesPath = `${this.settings.projectPath}/Templates/`;
    if (file.path.startsWith(templatesPath)) return true;
    return false;
  }

  private async syncChapterDescriptionFromChapter(chapterFile: TFile) {
    if (!this.isChapterFile(chapterFile)) return;

    const descFolder = `${this.settings.projectPath}/${this.settings.chapterDescFolder}`;
    const descPath = `${descFolder}/${chapterFile.basename}.md`;
    const descFile = this.app.vault.getAbstractFileByPath(descPath);
    if (!descFile || !(descFile instanceof TFile)) return;

    const chapterData = await this.parseChapterFile(chapterFile);
    const content = await this.app.vault.read(descFile);

    const fm = this.parseFrontmatter(content);
    fm.character_refs = chapterData.characters;
    fm.location_refs = chapterData.locations;

    const fmLines = Object.entries(fm)
      .map(([key, value]) => {
        if (Array.isArray(value)) return `${key}: [${value.join(', ')}]`;
        return `${key}: ${value}`;
      })
      .join('\n');

    const newFrontmatter = `---\n${fmLines}\n---`;
    const body = this.stripFrontmatter(content);

    const charList = chapterData.characters.length
      ? chapterData.characters.map(c => `- [[${c}]]`).join('\n')
      : '- None';
    const locList = chapterData.locations.length
      ? chapterData.locations.map(l => `- [[${l}]]`).join('\n')
      : '- None';

    let newBody = body;
    if (/## Character References\s+[\s\S]*?(?=##|$)/.test(newBody)) {
      newBody = newBody.replace(/## Character References\s+[\s\S]*?(?=##|$)/, `## Character References\n${charList}\n\n`);
    } else {
      newBody += `\n## Character References\n${charList}\n`;
    }

    if (/## Location References\s+[\s\S]*?(?=##|$)/.test(newBody)) {
      newBody = newBody.replace(/## Location References\s+[\s\S]*?(?=##|$)/, `## Location References\n${locList}\n\n`);
    } else {
      newBody += `\n## Location References\n${locList}\n`;
    }

    const updated = `${newFrontmatter}\n\n${newBody.trim()}\n`;
    await this.app.vault.modify(descFile, updated);
  }

  private isChapterDescriptionFile(file: TFile): boolean {
    const folder = `${this.settings.projectPath}/${this.settings.chapterDescFolder}`;
    if (!file.path.startsWith(folder)) return false;
    if (file.extension !== 'md') return false;
    if (file.basename.startsWith('_')) return false;
    return true;
  }

  private async ensureChapterFileForDesc(descFile: TFile) {
    if (!this.isChapterDescriptionFile(descFile)) return;

    const chapterFolder = `${this.settings.projectPath}/${this.settings.chapterFolder}`;
    const chapterPath = `${chapterFolder}/${descFile.basename}.md`;

    const existing = this.app.vault.getAbstractFileByPath(chapterPath);
    if (existing) return;

    let title = descFile.basename;
    let chapterNumber = '';
    let description = '';

    try {
      const content = await this.app.vault.read(descFile);
      const fm = this.parseFrontmatter(content);
      const nameText = this.getFrontmatterText(fm.name);
      const orderText = this.getFrontmatterText(fm.order);
      const outlineText = this.getFrontmatterText(fm.outline);
      if (nameText) title = nameText;
      if (orderText) chapterNumber = orderText;
      if (outlineText) description = outlineText;
    } catch {
      // ignore parsing errors
    }

    const chapterContent = `---
title: ${title}
chapter_number: ${chapterNumber}
description: ${description}
characters: []
locations: []
---

# ${title}

<!-- Write your chapter here -->
`;

    try {
      await this.app.vault.create(chapterPath, chapterContent);
      new Notice(`Chapter created for ${descFile.basename}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('already exists')) return;
      new Notice(`Error creating chapter file: ${message}`);
    }
  }

  private async openEntityFromEditor() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;
    const editor = view.editor;
    const selection = editor.getSelection()?.trim();
    const word = selection && selection.length > 0 ? selection : this.getWordAtCursor(editor);
    if (word) await this.openEntityInSidebar(word, { reveal: true });
  }

  async focusEntityByName(name: string, reveal = true): Promise<boolean> {
    return this.openEntityInSidebar(name, { reveal });
  }

  private clearFocus() {
    const sidebar = this.getSidebarView();
    if (!sidebar || !sidebar.selectedEntity) return;
    this.lastHoverEntity = null;
    sidebar.setSelectedEntity(null, { forceFocus: false });
  }

  private normalizeEntityName(name: string): string {
    let n = name.trim();
    if (n.startsWith('[[') && n.endsWith(']]')) n = n.slice(2, -2);
    if (n.includes('|')) n = n.split('|')[0];
    n = n.replace(/\.md$/i, '');
    if (n.includes('/')) n = n.split('/').pop() || n;
    return n.trim();
  }

  private async openEntityInSidebar(name: string, options?: { reveal?: boolean }): Promise<boolean> {
    const lookup = this.normalizeEntityName(name).toLowerCase();
    if (!lookup) return false;

    const entity = this.entityIndex.get(lookup);
    if (!entity) return false;

    const file = this.app.vault.getAbstractFileByPath(entity.path);
    if (!file || !(file instanceof TFile)) return false;

    const type = entity.path.includes(`/${this.settings.characterFolder}/`) ? 'character' : 'location';

    const sidebar = await this.ensureSidebarView();
    if (!sidebar) return false;

    sidebar.setSelectedEntity({ type, file, display: entity.display }, { forceFocus: true });

    if (options?.reveal) {
      await this.activateView();
    }

    return true;
  }

  private linkifyElement(el: HTMLElement) {
    if (!this.entityRegex || this.entityIndex.size === 0) return;

    const doc = globalThis.document;
    if (!doc) return;

    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('a, code, pre, .cm-inline-code, .cm-hmd-codeblock')) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text);
    }

    for (const node of textNodes) {
      const text = node.nodeValue || '';
      const regex = this.entityRegex;
      if (!regex.test(text)) {
        regex.lastIndex = 0;
        continue;
      }

      regex.lastIndex = 0;
      const fragment = doc.createDocumentFragment();
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const matchText = match[0];
        const start = match.index;
        const end = start + matchText.length;

        const before = start > 0 ? text[start - 1] : undefined;
        const after = end < text.length ? text[end] : undefined;

        if (this.isWordChar(before) || this.isWordChar(after)) {
          continue;
        }

        if (start > lastIndex) {
          fragment.appendChild(doc.createTextNode(text.slice(lastIndex, start)));
        }

        const key = matchText.toLowerCase();
        const entity = this.entityIndex.get(key);
        if (entity) {
          const link = doc.createElement('a');
          link.className = 'internal-link';
          link.setAttribute('data-href', entity.path);
          link.setAttribute('href', entity.path);
          link.textContent = matchText;
          fragment.appendChild(link);
        } else {
          fragment.appendChild(doc.createTextNode(matchText));
        }

        lastIndex = end;
      }

      if (lastIndex < text.length) {
        fragment.appendChild(doc.createTextNode(text.slice(lastIndex)));
      }

      node.parentNode?.replaceChild(fragment, node);
    }
  }
}

type CharacterRole = 'main' | 'side' | 'background';

const CHARACTER_ROLE_LABELS: Record<CharacterRole, string> = {
  main: 'Main character',
  side: 'Side character',
  background: 'Background character'
};

const normalizeCharacterRole = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return CHARACTER_ROLE_LABELS.side;
  if (normalized.includes('main')) return CHARACTER_ROLE_LABELS.main;
  if (normalized.includes('background')) return CHARACTER_ROLE_LABELS.background;
  if (normalized.includes('side')) return CHARACTER_ROLE_LABELS.side;
  return value.trim();
};
export const CHARACTER_MAP_VIEW_TYPE = 'novalist-character-map';

export class CharacterMapView extends ItemView {
  plugin: NovalistPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: NovalistPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return CHARACTER_MAP_VIEW_TYPE;
  }

  getDisplayText() {
    return 'Character map';
  }

  getIcon() {
    return 'git-commit';
  }

  async onOpen() {
    this.registerEvent(this.plugin.app.vault.on('modify', () => { void this.updateGraph(); }));
    await this.updateGraph();
  }

  async updateGraph() {
    const container = this.containerEl;
    container.empty();
    
    const header = container.createEl('div', { 
        cls: 'view-header',
        attr: {
             style: 'margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;'
        }
    });

    header.createEl('h4', { text: 'Character relationship map (work in progress)' });
    
    // Add WIP noticeable banner
    const wipBanner = container.createDiv();
    wipBanner.setCssStyles({
        backgroundColor: '#5c4818',
        color: '#f0ad4e',
        padding: '5px 10px',
        marginBottom: '10px',
        borderRadius: '4px',
        fontSize: '0.9em',
        border: '1px solid #8a6d3b',
        textAlign: 'center'
    });
    wipBanner.createEl('strong', { text: 'Note: ' });
    wipBanner.createSpan({ text: 'This relationship graph is currently under development. Layout and connections might be unstable.' });

    const refreshBtn = header.createEl('button', { text: 'Refresh' });
    refreshBtn.addEventListener('click', () => { void this.updateGraph(); });

    const div = container.createDiv();
    div.addClass('novalist-character-map-cy');
    div.setCssProps({ height: 'calc(100% - 40px)', width: '100%', position: 'relative', overflow: 'hidden' });
    
    // Create Legend Container (absolute positioned overlay)
    const legend = div.createDiv();
    legend.setCssProps({
        position: 'absolute',
        bottom: '10px', 
        left: '10px',
        background: 'rgba(0,0,0,0.6)',
        padding: '8px',
        borderRadius: '5px',
        zIndex: '1000',
        pointerEvents: 'none',
        color: '#ccc',
        fontSize: '0.8em',
        border: '1px solid rgba(255,255,255,0.1)'
    });
    legend.createEl('div', { text: 'Scroll to zoom • drag to pan' });
    legend.createEl('div', { text: 'Drag nodes to rearrange' });


    if (!this.plugin.settings.characterFolder) {
        div.setText('Character folder not set in settings.');
        return;
    }

    let folder = this.plugin.settings.characterFolder;
    if (this.plugin.settings.projectPath) {
        folder = `${this.plugin.settings.projectPath}/${folder}`;
    }

    const files = this.plugin.app.vault.getFiles().filter((f: TFile) => f.path.startsWith(folder));
    if (files.length === 0) {
        div.setText('No character files found in ' + folder);
        return;
    }
    
    // Data Preparation for Cytoscape
    interface ElementData {
        id?: string;
        label?: string;
        parent?: string;
        source?: string;
        target?: string;
    }
    
    interface ElementWrapper {
        data: ElementData;
        classes?: string;
    }

    const elements: ElementWrapper[] = [];
    const charIdMap = new Map<string, string>();
    
    const getId = (name: string) => {
        if (!name) return 'unknown';
        if (!charIdMap.has(name)) {
            const id = 'node_' + name.replace(/[^a-zA-Z0-9]/g, '_');
            charIdMap.set(name, id);
        }
        return charIdMap.get(name) || 'unknown';
    };

    interface CharData {
      name: string;
      surname: string;
      relationship: string;
      customRelationships: Record<string, string[]>;
      role?: string;
    }

    const charDataMap = new Map<string, CharData>();
    const fileBaseMap = new Map<string, string>();
    const activeStats = new Set<string>();

    for (const file of files) {
         try {
             // Access parseCharacterFile from plugin
             const data = await this.plugin.parseCharacterFile(file);
             if (data && data.name) {
                 charDataMap.set(data.name, data);
                 fileBaseMap.set(file.basename, data.name);
             }
         } catch (e) {
             globalThis.console.error('Failed to parse character', file.path, e);
         }
    }
    
    // Helper to resolve link target
    const resolveTarget = (targetName: string): string | null => {
        // 1. Exact Name match
        if (charDataMap.has(targetName)) return targetName;
        // 2. Exact Filename match
        if (fileBaseMap.has(targetName)) return fileBaseMap.get(targetName) || null;
        
        const lowerTarget = targetName.toLowerCase();
        // 3. Case-insensitive Name match
        const foundName = Array.from(charDataMap.keys()).find(k => k.toLowerCase() === lowerTarget);
        if (foundName) return foundName;
        
        // 4. Case-insensitive Filename match
        const foundBase = Array.from(fileBaseMap.keys()).find(k => k.toLowerCase() === lowerTarget);
        if (foundBase) return fileBaseMap.get(foundBase) || null;
        
        return null;
    };

    // Prepare Inverse Map
    const inverseMap = new Map<string, Set<string>>();
    const pairs = this.plugin.settings.relationshipPairs || {};
    for (const [k, v] of Object.entries(pairs)) {
        const lowerK = k.toLowerCase().trim();
        if (!inverseMap.has(lowerK)) inverseMap.set(lowerK, new Set());
        if (Array.isArray(v)) {
            v.forEach(val => {
                 const lowerVal = val.toLowerCase().trim();
                 inverseMap.get(lowerK)?.add(lowerVal);
                 if (!inverseMap.has(lowerVal)) inverseMap.set(lowerVal, new Set());
                 inverseMap.get(lowerVal)?.add(lowerK);
            });
        }
    }
    
    // Track edges to avoid duplicates/inverses
    const edgeTracker = new Map<string, Set<string>>();
    
    const shouldDraw = (idA: string, idB: string, roleInput: string): boolean => {
        const key = [idA, idB].sort().join('::');
        const role = roleInput.toLowerCase().trim();
        
        if (!edgeTracker.has(key)) {
            edgeTracker.set(key, new Set([role]));
            return true;
        }
        
        const existingRoles = edgeTracker.get(key) || new Set<string>();
        if (existingRoles.has(role)) return false; // Duplicate check
        
        // Strict inverse check using settings
        // We check if the current role is a known inverse of any existing role for this pair
        for (const existing of existingRoles) {
             // Check generic inverse list
             // Since we lowercased keys in inverseMap, and 'existing' is lowercase, this works
             const inverses = inverseMap.get(existing);
             if (inverses && inverses.has(role)) return false;
        }

        existingRoles.add(role);
        return true;
    };

    for (const [name, data] of charDataMap) {
        const sourceId = getId(name);
        if (!sourceId) continue;
        
        // Standard relationship field
        if (data.relationship) {
            const links = data.relationship.match(/\[\[(.*?)\]\]/g);
            if (links) {
                for (const link of links) {
                    const rawTarget = link.replace(/^\[\[|\]\]$/g, '').split('|')[0];
                    const realTargetName = resolveTarget(rawTarget);
                    
                    if (!realTargetName) continue;

                    const targetId = getId(realTargetName);
                    if (targetId && sourceId !== targetId) {
                        // Populate stats only, do not track edges yet
                        activeStats.add(name);
                        activeStats.add(realTargetName);
                    }
                }
            }
        }
        
        // Custom Relationships
        if (data.customRelationships) {
            for (const [role, targets] of Object.entries(data.customRelationships)) {
                if (role && !Array.isArray(targets)) continue;
                for (const rawTarget of targets) {
                     const realTargetName = resolveTarget(rawTarget);
                     
                     if (!realTargetName) continue;
                     
                     const targetId = getId(realTargetName);
                     if (targetId && sourceId !== targetId) {
                         activeStats.add(name);
                         activeStats.add(realTargetName);
                     }
                }
            }
        }
    }
    

    // Grouping Logic - Ported to Cytoscape Parents
    
    // 1. Analyze Families (Shared Last Names)
    const surnameCounts = new Map<string, number>();
    for (const [key, data] of charDataMap) {
        if (!activeStats.has(key)) continue;
        
        const surname = data.surname || (data.name.trim().includes(' ') ? data.name.trim().split(/\s+/).pop() : '');

        if (surname && surname.length > 1 && /^[A-Z]/.test(surname)) {
            surnameCounts.set(surname, (surnameCounts.get(surname) || 0) + 1);
        }
    }
    
    // Track assigned nodes to parents
    const parentMap = new Map<string, string>(); // childId -> parentId

    // 1. Family Groups (Surname)
    for (const [key, data] of charDataMap) {
       if (activeStats.has(key)) {
         const id = getId(key);
         
         const surname = data.surname || (data.name.trim().includes(' ') ? data.name.trim().split(/\s+/).pop() : '');

         if (surname && (surnameCounts.get(surname) || 0) >= 2) {
             const groupId = `fam_${surname.replace(/[^a-zA-Z0-9]/g, '')}`;
             
             // Add Group Node if not exists
             if (!elements.some(e => e.data.id === groupId)) {
                 elements.push({ 
                     data: { id: groupId, label: `${surname} Family` },
                     classes: 'group-node'
                 });
             }
             parentMap.set(id, groupId);
         }
       }
    }
    
    // 2. Inferred Family Groups
    const familyRelations = ['parent', 'mother', 'father', 'mom', 'dad', 'kid', 'child', 'son', 'daughter', 'sibling', 'brother', 'sister', 'spouse', 'wife', 'husband', 'partner'];
    const familyAdjacency = new Map<string, string[]>();

    const addFamilyLink = (u: string, v: string) => {
        if (!familyAdjacency.has(u)) familyAdjacency.set(u, []);
        if (!familyAdjacency.has(v)) familyAdjacency.set(v, []);
        familyAdjacency.get(u)?.push(v);
        familyAdjacency.get(v)?.push(u);
    };

    for (const [name, data] of charDataMap) {
        // Skip if already in surname family
        if (parentMap.has(getId(name)) || !activeStats.has(name)) continue;

        if (data.customRelationships) {
             for (const [role, targets] of Object.entries(data.customRelationships)) {
                 if (familyRelations.some(rel => role.toLowerCase().includes(rel)) && Array.isArray(targets)) {
                      for (const t of targets) {
                          const targetName = resolveTarget(t);
                          if (targetName && activeStats.has(targetName)) {
                              // Only group if BOTH are not in a surname family (keep it simple)
                              if (!parentMap.has(getId(name)) && !parentMap.has(getId(targetName))) {
                                  addFamilyLink(name, targetName);
                              }
                          }
                      }
                 }
            }
        }
    }
    
    const visitedFamily = new Set<string>();
    let famGroupIndex = 0;
    
    for (const [node] of familyAdjacency) {
        if (visitedFamily.has(node)) continue;
        
        const component: string[] = [];
        const queue = [node];
        visitedFamily.add(node);
        
        while (queue.length > 0) {
           const curr = queue.shift();
           if (!curr) continue;
           component.push(curr);
           
           for (const neighbor of (familyAdjacency.get(curr) || [])) {
               if (!visitedFamily.has(neighbor)) {
                   visitedFamily.add(neighbor);
                   queue.push(neighbor);
               }
           }
        }
        
        if (component.length >= 2) {
            famGroupIndex++;
            
            // Smarter Naming: Check for common surnames in the inferred group
            const counts = new Map<string, number>();
            
            for (const memberName of component) {
                const data = charDataMap.get(memberName);
                if (data) {
                    const surname = data.surname || (data.name.trim().includes(' ') ? data.name.trim().split(/\s+/).pop() : '');
                    
                    // Basic surname validation (Capitalized, length > 1)
                    if (surname && surname.length > 1 && /^[A-Z]/.test(surname)) {
                        counts.set(surname, (counts.get(surname) || 0) + 1);
                    }
                }
            }
            
            let bestSurname = "";
            let maxCount = 0;
            
            for (const [s, c] of counts) {
                if (c > maxCount) {
                    maxCount = c;
                    bestSurname = s;
                }
            }
            
            let label = `Family Group ${famGroupIndex}`;
            // If the best surname is shared by at least 2 members (or even 1 if the group is huge? No, 2 is safer)
            // Or if it covers a significant portion of the group.
            if (maxCount >= 2) {
                label = `${bestSurname} Family`;
            }

            const groupId = `fam_inferred_${famGroupIndex}`;
            elements.push({ 
                data: { id: groupId, label: label },
                classes: 'group-node'
            });
            for (const member of component) {
                parentMap.set(getId(member), groupId);
            }
        }
    }
    
    // 3. Dynamic Groups for remaining nodes
    // Build edge list for grouping analysis
    interface PotentialEdge { u: string; v: string; }
    const roleEdges = new Map<string, PotentialEdge[]>();
    
    for (const [name, data] of charDataMap) {
        if (!activeStats.has(name) || parentMap.has(getId(name))) continue;
        
        if (data.customRelationships) {
            for (const [role, targets] of Object.entries(data.customRelationships)) {
                 const cleanRole = role.trim();
                 if (!cleanRole || familyRelations.some(rel => cleanRole.toLowerCase().includes(rel))) continue;
                 
                 if (Array.isArray(targets)) {
                     for (const t of targets) {
                         const targetName = resolveTarget(t);
                         if (targetName && activeStats.has(targetName)) {
                             if (!parentMap.has(getId(name)) && !parentMap.has(getId(targetName))) {
                                 if (name === targetName) continue;
                                 if (!roleEdges.has(cleanRole)) roleEdges.set(cleanRole, []);
                                 roleEdges.get(cleanRole)?.push({ u: name, v: targetName });
                             }
                         }
                     }
                 }
            }
        }
    }
    
    const sortedRoles = Array.from(roleEdges.keys()).sort((a, b) => {
        return (roleEdges.get(b)?.length || 0) - (roleEdges.get(a)?.length || 0);
    });

    let groupCounter = 0;
    
    for (const role of sortedRoles) {
        const edges = roleEdges.get(role) || [];
        if (edges.length === 0) continue;
        
        const adjacency = new Map<string, string[]>();
        const involved = new Set<string>();
        
        for (const edge of edges) {
            if (parentMap.has(getId(edge.u)) || parentMap.has(getId(edge.v))) continue;
            if (!adjacency.has(edge.u)) adjacency.set(edge.u, []);
            if (!adjacency.has(edge.v)) adjacency.set(edge.v, []);
            adjacency.get(edge.u)?.push(edge.v);
            adjacency.get(edge.v)?.push(edge.u);
            involved.add(edge.u);
            involved.add(edge.v);
        }
        
        const visited = new Set<string>();
        for (const startNode of involved) {
            if (visited.has(startNode)) continue;
            
            const component: string[] = [];
            const queue = [startNode];
            visited.add(startNode);
            
            while (queue.length > 0) {
                 const curr = queue.shift();
                 if (!curr) continue;
                 component.push(curr);
                 
                 const neighbors = adjacency.get(curr) || [];
                 for (const n of neighbors) {
                     if (!visited.has(n)) {
                         visited.add(n);
                         queue.push(n);
                     }
                 }
            }
            
            if (component.length >= 2) {
                groupCounter++;
                const groupId = `group_${role.replace(/[^a-zA-Z0-9]/g, '')}_${groupCounter}`;
                const label = role.charAt(0).toUpperCase() + role.slice(1);
                 elements.push({ 
                    data: { id: groupId, label: label },
                    classes: 'group-node'
                });
                for (const member of component) {
                    parentMap.set(getId(member), groupId);
                }
            }
        }
    }

    // 4. Sub-grouping for Shared Roles
    // Detect if a source has multiple connections of the same role (e.g. "Parents" -> [Amy, James])
    // If so, group Amy and James into a subgroup and link to that subgroup.
    
    // Map<SourceId, Map<RoleString, SubGroupId>>
    const sourceRoleSubgroups = new Map<string, Map<string, string>>();
    
    for (const [name, data] of charDataMap) {
        if (!activeStats.has(name)) continue;
        const sourceId = getId(name);
        
        // Collect targets by role
        const roleTargets = new Map<string, string[]>();
        const addTarget = (r: string, t: string) => {
            if (!roleTargets.has(r)) roleTargets.set(r, []);
            roleTargets.get(r)?.push(t);
        };
        
        if (data.relationship) {
             const links = data.relationship.match(/\[\[(.*?)\]\]/g);
             if (links) {
                 for (const link of links) {
                    const rawTarget = link.replace(/^\[\[|\]\]$/g, '').split('|')[0];
                    const targetName = resolveTarget(rawTarget);
                    // normalize "Relationship" as per activeStats logic
                    if (targetName && activeStats.has(targetName)) {
                        addTarget('Relationship', targetName);
                    }
                 }
             }
        }
        
        if (data.customRelationships) {
             for (const [role, targets] of Object.entries(data.customRelationships)) {
                 if (!Array.isArray(targets)) continue;
                 for (const t of targets) {
                     const targetName = resolveTarget(t);
                     if (targetName && activeStats.has(targetName)) {
                         addTarget(role, targetName);
                     }
                 }
             }
        }
        
        // Process collected roles
        for (const [role, targetNames] of roleTargets) {
            // Filter unique targets for this role
            const uniqueTargets = [...new Set(targetNames)];
            
            if (uniqueTargets.length >= 2) {
                // Determine if they share a parent group
                const firstParent = parentMap.get(getId(uniqueTargets[0]));
                // All targets must share the same parent structure to be grouped tightly
                const allSameParent = uniqueTargets.every(t => parentMap.get(getId(t)) === firstParent);
                
                if (allSameParent) {
                    const safeRole = role.replace(/[^a-zA-Z0-9]/g, '');
                    // Smart Reuse: If the parent group label matches the role, reuse the parent instead of creating a subgroup
                    // This avoids "Friends" -> "Friends" double wrapping
                    let reuseParent = false;
                    if (firstParent) {
                         const parentEl = elements.find(e => e.data.id === firstParent);
                         if (parentEl && parentEl.data.label && parentEl.data.label.toLowerCase().includes(role.toLowerCase().replace(/s$/, ''))) {
                             reuseParent = true;
                         }
                    }

                    if (reuseParent && firstParent) {
                        // REUSE EXISTING GROUP
                        if (!sourceRoleSubgroups.has(sourceId)) sourceRoleSubgroups.set(sourceId, new Map());
                        sourceRoleSubgroups.get(sourceId)?.set(role, firstParent);
                        // Do NOT update parentMap for children, they are already in the right place
                    } else {
                        // CREATE NEW SUBGROUP
                        const subGroupId = `subgroup_${sourceId}_${safeRole}`;
                        
                        // Register subgroup
                        const label = role.charAt(0).toUpperCase() + role.slice(1);
                        const subEl: ElementWrapper = {
                            data: { id: subGroupId, label: label },
                            classes: 'group-node subgroup-node'
                        };
                        if (firstParent) {
                            subEl.data.parent = firstParent;
                        }
                        elements.push(subEl);
                        
                        // Update parentMap for children
                        for (const t of uniqueTargets) {
                            parentMap.set(getId(t), subGroupId);
                        }
                        
                        // Track for edge replacement
                        if (!sourceRoleSubgroups.has(sourceId)) sourceRoleSubgroups.set(sourceId, new Map());
                        sourceRoleSubgroups.get(sourceId)?.set(role, subGroupId);
                    }
                }
            }
        }
    }
    
    // Add Nodes
    for (const name of activeStats) {
        const data = charDataMap.get(name);
        const id = getId(name);
        const safeName = (data?.name || name).replace(/"/g, "'"); // Name only
        
        const nodeEntry: ElementWrapper = {
            data: { id: id, label: safeName }
        };
        
        // Add parent if exists
        const pid = parentMap.get(id);
        if (pid) {
            nodeEntry.data.parent = pid;
        }
        
        // Style class by role
        // @ts-ignore
        const role = data?.role ? normalizeCharacterRole(String(data.role)) : 'side';
        nodeEntry.classes = role;
        
        elements.push(nodeEntry);
    }
    
    // Add Edges
    for (const [name, data] of charDataMap) {
        if (!activeStats.has(name)) continue;
        const sourceId = getId(name);
        
        const drawnSubgroups = new Set<string>();
        
        // Helper to check for subgroup edge
        const handleEdge = (role: string, targetName: string): boolean => {
             // Returns true if edge was handled (either via subgroup or created normally), 
             // actually, return true if SUBGROUP handled it, false otherwise.
             if (sourceRoleSubgroups.has(sourceId) && sourceRoleSubgroups.get(sourceId)?.has(role)) {
                 const subGroupId = sourceRoleSubgroups.get(sourceId)?.get(role);
                 if (subGroupId && !drawnSubgroups.has(subGroupId)) {
                     // Draw edge to SubGroup ONCE
                     if (sourceId !== subGroupId && shouldDraw(sourceId, subGroupId, role)) {
                         elements.push({
                             data: { source: sourceId, target: subGroupId, label: '' } // Empty label
                         });
                         drawnSubgroups.add(subGroupId);
                     }
                 }
                 
                 // CRITICAL: Register the individual relationship so inverse checks work later.
                 // Even though we draw to the subgroup, logic must know this pair is "handled"
                 // effectively establishing (Source -> Target) with 'Role'.
                 const tId = getId(targetName);
                 if (tId && tId !== sourceId) {
                      // We don't check return value, just update tracker state
                      shouldDraw(sourceId, tId, role);
                 }
                 
                 // If targets match the subgroup list, we skip individual edge
                 // We verified earlier that all targets in this role list are in the subgroup.
                 return true; 
             }
             return false;
        };
        
        // Generic Relationship
        if (data.relationship) {
            const links = data.relationship.match(/\[\[(.*?)\]\]/g);
            if (links) {
                 // Check if 'Relationship' is subgrouped
                 const isSubgrouped = sourceRoleSubgroups.has(sourceId) && sourceRoleSubgroups.get(sourceId)?.has('Relationship');
                 
                 for (const link of links) {
                    const rawTarget = link.replace(/^\[\[|\]\]$/g, '').split('|')[0];
                    const targetName = resolveTarget(rawTarget);
                    if (targetName && activeStats.has(targetName)) {
                        if (isSubgrouped) {
                            handleEdge('Relationship', targetName);
                        } else {
                            const targetId = getId(targetName);
                            // REDUNDANCY CHECK: 
                            // If I am Source, and Target groups me into a subgroup relevant to this role, Skip drawing entirely.
                            // The target will interpret this as an "incoming" group connection and draw it themselves.
                            // Check if Source's parent is a subgroup owned by Target
                            const myParent = parentMap.get(sourceId);
                            if (myParent && myParent.startsWith('subgroup_' + targetId)) {
                                // Redundant edge, skip
                            } else {
                                if (sourceId !== targetId && shouldDraw(sourceId, targetId, 'Relationship')) {
                                    elements.push({
                                        data: { source: sourceId, target: targetId, label: 'Relationship' }
                                    });
                                }
                            }
                        }
                    }
                 }
            }
        }
        
        // Custom Relationships
        if (data.customRelationships) {
            for (const [role, targets] of Object.entries(data.customRelationships)) {
                 if (!Array.isArray(targets)) continue;
                 
                 const isSubgrouped = sourceRoleSubgroups.has(sourceId) && sourceRoleSubgroups.get(sourceId)?.has(role);

                 for (const t of targets) {
                     const targetName = resolveTarget(t);
                     if (targetName && activeStats.has(targetName)) {
                         if (isSubgrouped) {
                             handleEdge(role, targetName);
                         } else {
                             const targetId = getId(targetName);
                             const safeRole = role.replace(/[^a-zA-Z0-9 ]/g, '');
                             
                             // REDUNDANCY CHECK: Skip if Target owns source in a subgroup
                             const myParent = parentMap.get(sourceId);
                             // Simple check: Is my parent a subgroup created by Target?
                             if (myParent && myParent.startsWith('subgroup_' + targetId)) {
                                 // Skip
                                 // Do we need to register shouldDraw for inverse blocking? 
                                 // Probably not, because the Target's group-edge already covers us visually.
                                 // And we shouldn't draw an invisible line either.
                             } else {
                                 // Check 2: Did Target decide to REUSE a parent group to group me?
                                 // If so, Target has `sourceRoleSubgroups(targetId, role) === myParent`
                                 // We need to check if Target claims ownership of my Parent Group for this role.
                                 // This is expensive to check every time unless we have a map.
                                 // But checking `sourceRoleSubgroups` map is fast if we have access.
                                 // `sourceRoleSubgroups` is defined in scope.
                                 
                                 // Note: Roles might differ? "Friends" == "Friends".
                                 // If Target grouped me as "Friends", and I see Target as "Friends", I should skip.
                                 let targetClaimsParent = false;
                                 if (sourceRoleSubgroups.has(targetId)) {
                                     // We iterate roles of target to find if any points to myParent?
                                     // Ideally we match roles.
                                     const targetGroups = sourceRoleSubgroups.get(targetId);
                                     if (targetGroups && myParent) {
                                         // Check strict role match first? Or just if *any* role maps to my parent?
                                         // Strict role match is safer.
                                         if (targetGroups.get(role) === myParent) {
                                             targetClaimsParent = true;
                                         }
                                         // Also check inverse role if we knew it "Parent"/"Child".
                                         // For "Friends", role is same.
                                     }
                                 }

                                 if (!targetClaimsParent && sourceId !== targetId && shouldDraw(sourceId, targetId, safeRole)) {
                                     elements.push({
                                        data: { source: sourceId, target: targetId, label: safeRole }
                                     });
                                 }
                             }
                         }
                     }
                 }
            }
        }
    }

    // Post-processing: Filter redundant edge labels
    // If an edge is inside a group and its label matches the group label, hide it.
    const groupLabelMap = new Map<string, string>();
    for (const el of elements) {
        if (el.classes === 'group-node' && el.data.id && el.data.label) {
            groupLabelMap.set(el.data.id, el.data.label);
        }
    }

    for (const el of elements) {
        if (el.data.source && el.data.target && el.data.label) {
            const parent = parentMap.get(el.data.source);
            // Check if both nodes are in the same group
            if (parent && parent === parentMap.get(el.data.target)) {
                const gLabel = groupLabelMap.get(parent);
                if (gLabel && gLabel.toLowerCase() === el.data.label.toLowerCase()) {
                    el.data.label = '';
                }
            }
        }
    }

    // Classification of edges for layout
    // English + German common terms
    const verticalRoles = [
        'parent', 'mother', 'father', 'mom', 'dad', 'kid', 'child', 'son', 'daughter',
        'eltern', 'mutter', 'vater', 'kind', 'sohn', 'tochter'
    ];
    
    for (const el of elements) {
        if (el.data.source && el.data.target) {
            let isVertical = false;
            // Structural edges (subgroups) are vertical
            if (!el.data.label) isVertical = true;
            else {
                // If it HAS a parent-related label, it is vertical.
                // Otherwise it is horizontal (friends, enemies, love, etc.)
                const lower = el.data.label.toLowerCase();
                 if (verticalRoles.some(r => lower.includes(r))) isVertical = true;
            }
            
            // Layout only supports vertical edges to keep hierarchy clean
            if (isVertical) {
                el.classes = (el.classes ? el.classes + ' ' : '') + 'layout-vertical';
            } else {
                el.classes = (el.classes ? el.classes + ' ' : '') + 'layout-horizontal';
            }
        }
    }

    try {
        const cy = cytoscape({
            container: div,
            wheelSensitivity: 0.2,
            // Ensure compound nodes are drawn behind children/edges
            // @ts-ignore - zCompoundDepth is valid but might be missing in types
            zCompoundDepth: 'bottom', 
            elements: elements,
            style: [
                {
                    selector: 'node',
                    style: {
                        'label': 'data(label)',
                        'text-valign': 'center',
                        'text-halign': 'center',
                        'background-color': '#666',
                        'color': '#fff',
                        'text-outline-width': 2,
                        'text-outline-color': '#666',
                        'width': 'label',
                        'height': 'label',
                        'padding': '10px',
                        'shape': 'round-rectangle',
                        'z-index': 10
                    }
                },
                {
                    selector: 'node.main',
                    style: {
                        'background-color': '#6c4eb0', // Main Purple
                        'text-outline-color': '#6c4eb0',
                        'font-weight': 'bold',
                        'font-size': 20
                    }
                },
                {
                    selector: 'node.side',
                    style: {
                        'background-color': '#4a6f8a',
                        'text-outline-color': '#4a6f8a'
                    }
                },
                {
                    selector: '.group-node',
                    style: {
                        'color': '#aaa',
                        'text-valign': 'top',
                        'text-halign': 'center',
                        'background-color': 'rgba(255, 255, 255, 0.05)',
                        'border-width': 2,
                        'border-color': 'rgba(255, 255, 255, 0.4)',
                        'padding': '10px',
                        'z-index': 0
                    }
                },
                {
                    selector: '.subgroup-node',
                    style: {
                        'text-valign': 'top',
                        'text-halign': 'center',
                        'color': '#ccc',
                        'border-style': 'solid',
                        'border-color': '#444', // Dark border for visibility
                        'background-color': 'rgba(0, 0, 0, 0.05)', // Slight darkness to distinguish from parent
                        'border-width': 2,
                        'padding-top': '25px',
                        'padding-bottom': '10px',
                        'padding-left': '10px',
                        'padding-right': '10px',
                        'z-index': 1
                    }
                },
                {
                    selector: 'edge',
                    style: {
                        'width': 2,
                        'line-color': '#555',
                        'target-arrow-shape': 'none',
                        'curve-style': 'bezier',
                        'label': 'data(label)',
                        'font-size': 10,
                        'color': '#ccc',
                        'text-background-opacity': 1,
                        'text-background-color': '#333',
                        'text-background-shape': 'roundrectangle',
                        'text-background-padding': '3px',
                        'text-rotation': 'autorotate',
                        'z-index': 999
                    }
                },
                {
                    selector: 'edge.layout-vertical',
                    style: {
                        'curve-style': 'bezier'
                    }
                },
                {
                    selector: 'edge.layout-horizontal',
                    style: {
                        'curve-style': 'bezier',
                        'line-color': '#d4a017', // Gold/Dark Yellow for visibility
                        'line-style': 'dashed',
                        'width': 3,
                        'target-arrow-shape': 'none',
                        'opacity': 1, // Force visibility
                        'z-index': 9999
                    }
                }
            ],
            layout: { name: 'preset' }
        });
        
        // Optimize: Separate layout for groups?
        // No, Dagre handles compound graphs well if configured correctly.
        // We run dagre ONLY on the hierarchy-defining edges/nodes.
        // Other edges will just be drawn between the resulting positions.
        
        const layoutElements = cy.elements().nodes().union(cy.elements('edge.layout-vertical'));
        
        layoutElements.layout({
            name: 'dagre',
            // @ts-ignore
            rankDir: 'TB',
            // @ts-ignore
            nodeSep: 80, // Increase separation to fit horizontal arrows better
            // @ts-ignore
            rankSep: 80, 
            padding: 20,
            spacingFactor: 1.2,
            animate: false,
            // @ts-ignore
            align: 'UL', // Align up-left to keep structure tight? Default is better usually.
            stop: () => {
                cy.fit(undefined, 20); // Ensure graph is visible after layout
            }
        } as cytoscape.LayoutOptions).run();
        
    } catch (e) {
      div.setText('Error rendering cytoscape graph.');
      globalThis.console.error(e);
    }
  }
}
