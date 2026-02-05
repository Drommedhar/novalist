import {
  Plugin,
  TFile,
  TFolder,
  Vault,
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
  TextComponent,
  DropdownComponent
} from 'obsidian';

// ==========================================
// INTERFACES
// ==========================================

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
  'de-guillemet': 'German (Guillemets)',
  'de-low': 'German (Low-High)',
  en: 'English (Curly Quotes)',
  fr: 'French (Guillemets with spaces)',
  es: 'Spanish (Guillemets)',
  it: 'Italian (Guillemets)',
  pt: 'Portuguese (Guillemets)',
  ru: 'Russian (Guillemets)',
  pl: 'Polish (Low-High)',
  cs: 'Czech (Low-High)',
  sk: 'Slovak (Low-High)',
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

interface NovalistSettings {
  projectPath: string;
  autoReplacements: AutoReplacementPair[];
  language: LanguageKey;
  customLanguageLabel: string;
  customLanguageDefaults: AutoReplacementPair[];
  enableHoverPreview: boolean;
  enableSidebarView: boolean;
  enableMergeLog: boolean;
  characterFolder: string;
  locationFolder: string;
  chapterDescFolder: string;
  chapterFolder: string;
}

const DEFAULT_SETTINGS: NovalistSettings = {
  projectPath: 'NovelProject',
  autoReplacements: LANGUAGE_DEFAULTS['de-guillemet'],
  language: 'de-guillemet',
  customLanguageLabel: 'Custom',
  customLanguageDefaults: [],
  enableHoverPreview: true,
  enableSidebarView: true,
  enableMergeLog: false,
  characterFolder: 'Characters',
  locationFolder: 'Locations',
  chapterDescFolder: 'ChapterDescriptions',
  chapterFolder: 'Chapters'
};

// ==========================================
// VIEWS
// ==========================================

export const NOVELIST_SIDEBAR_VIEW_TYPE = 'novalist-sidebar';

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
    return 'Novalist Context';
  }

  getIcon(): string {
    return 'book-open';
  }

  async onOpen() {
    this.containerEl.empty();
    this.render();
    
    // Listen for active file changes
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (file && file.extension === 'md') {
          this.currentChapterFile = file;
          this.render();
        }
      })
    );
  }

  async render() {
    const container = this.containerEl;
    container.empty();
    container.addClass('novalist-sidebar');

    container.onclick = (evt) => {
      const target = evt.target as HTMLElement | null;
      if (!target) return;
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
    container.createEl('h3', { text: 'Novalist Context', cls: 'novalist-sidebar-header' });

    // Tabs
    const tabs = container.createDiv('novalist-tabs');
    const setTab = (tab: 'actions' | 'context' | 'focus') => {
      this.autoFocusActive = false;
      this.activeTab = tab;
      if (tab !== 'focus') this.lastNonFocusTab = tab;
      this.render();
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
        const content = await this.plugin.app.vault.read(this.selectedEntity.file);
        let body = this.plugin.stripFrontmatter(content);
        const title = this.plugin.extractTitle(body);
        if (title) {
          details.createEl('h3', { text: title, cls: 'novalist-focus-title' });
          body = this.plugin.removeTitle(body);
        }

        if (this.selectedEntity.type === 'character') {
          body = this.plugin.stripChapterRelevantSection(body);
          body = this.plugin.stripImagesSection(body);
          const baseImages = this.plugin.parseImagesSection(content);
          if (this.currentChapterFile) {
            const charData = await this.plugin.parseCharacterFile(this.selectedEntity.file);
            const chapterKey = await this.plugin.getChapterNameForFile(this.currentChapterFile);
            const chapterInfo = charData.chapterInfos.find(ci => ci.chapter === chapterKey);
            if (chapterInfo) {
              void this.plugin.logMerge(`Focus merge start. Character: ${this.selectedEntity.file.path}, Chapter: ${this.currentChapterFile.path}, ChapterKey: ${chapterKey}`);
              void this.plugin.logMerge(`Chapter overrides input: ${JSON.stringify(chapterInfo.overrides)} | Info: ${chapterInfo.info}`);
              body = this.plugin.applyCharacterOverridesToBody(body, chapterInfo.overrides);
              void this.plugin.logMerge(`Focus merge complete. Body length: ${body.length}`);
            }
          }

          const chapterOverrideImages = this.currentChapterFile
            ? await this.plugin.getChapterOverrideImages(this.selectedEntity.file, this.currentChapterFile)
            : null;
          const images = chapterOverrideImages ?? baseImages;
          if (images.length > 0) {
            const imageRow = details.createDiv('novalist-image-row');
            imageRow.createEl('span', { text: 'Images', cls: 'novalist-image-label' });

            const dropdown = new DropdownComponent(imageRow);
            for (const img of images) {
              dropdown.addOption(img.name, img.name);
            }

            const key = this.selectedEntity.file.path;
            const selected = this.selectedImageByPath.get(key) || images[0].name;
            dropdown.setValue(selected);

            const imageContainer = details.createDiv('novalist-image-preview');
            const renderImage = async (name: string) => {
              const img = images.find(i => i.name === name) || images[0];
              this.selectedImageByPath.set(key, img.name);
              imageContainer.empty();

              const file = this.plugin.resolveImagePath(img.path, this.selectedEntity!.file.path);
              if (!file) {
                imageContainer.createEl('p', { text: 'Image not found.', cls: 'novalist-empty' });
                return;
              }

              const src = this.plugin.app.vault.getResourcePath(file);
              const imgEl = imageContainer.createEl('img', {
                attr: { src, alt: img.name },
                cls: 'novalist-image'
              });
              imgEl.addEventListener('click', () => {
                const leaf = this.plugin.app.workspace.getLeaf(true);
                void leaf.openFile(file);
              });
            };

            dropdown.onChange((val) => {
              void renderImage(val);
            });

            await renderImage(selected);
          }
        }

        if (this.selectedEntity.type === 'character' && this.currentChapterFile) {
          const charData = await this.plugin.parseCharacterFile(this.selectedEntity.file);
          const chapterKey = await this.plugin.getChapterNameForFile(this.currentChapterFile);
          const chapterInfo = charData.chapterInfos.find(ci => ci.chapter === chapterKey);
          if (chapterInfo && (chapterInfo.overrides?.further_info || chapterInfo.info)) {
            const block = details.createDiv('novalist-section');
            block.createEl('h4', { text: `Chapter Notes: ${chapterKey}`, cls: 'novalist-section-title' });
            const text = [chapterInfo.overrides?.further_info, chapterInfo.info].filter(Boolean).join('\n');
            const md = block.createDiv('novalist-markdown');
            await MarkdownRenderer.renderMarkdown(text, md, '', this);
            this.plugin.linkifyElement(md);
          }
        }

        const md = details.createDiv('novalist-markdown');
        await MarkdownRenderer.renderMarkdown(body, md, '', this);
        this.plugin.linkifyElement(md);

        const logSnapshot = this.plugin.getMergeLogSnapshot();
        if (this.plugin.settings.enableMergeLog && logSnapshot) {
          const logSection = details.createDiv('novalist-section');
          logSection.createEl('h4', { text: 'Merge Log (latest)', cls: 'novalist-section-title' });
          const logActions = logSection.createDiv('novalist-merge-log-actions');
          new ButtonComponent(logActions)
            .setButtonText('Copy Log')
            .onClick(() => {
              void navigator.clipboard?.writeText(logSnapshot);
              new Notice('Merge log copied.');
            });
          const logArea = logSection.createEl('textarea', { cls: 'novalist-merge-log' });
          logArea.value = logSnapshot;
          logArea.setAttr('readonly', 'true');
          logArea.setAttr('rows', '10');
          logArea.setAttr('wrap', 'off');
        }
      }

      return;
    }

    if (this.activeTab === 'actions') {
      const actionsSection = container.createDiv('novalist-section');
      actionsSection.createEl('h4', { text: '⚡ Quick Actions', cls: 'novalist-section-title' });

      const btnContainer = actionsSection.createDiv('novalist-actions');

      new ButtonComponent(btnContainer)
        .setButtonText('Add Character')
        .onClick(() => this.plugin.openCharacterModal());

      new ButtonComponent(btnContainer)
        .setButtonText('Add Location')
        .onClick(() => this.plugin.openLocationModal());

      new ButtonComponent(btnContainer)
        .setButtonText('Add Chapter Description')
        .onClick(() => this.plugin.openChapterDescriptionModal());

      return;
    }

    if (!this.currentChapterFile) {
      container.createEl('p', { text: 'Open a chapter file to see context.', cls: 'novalist-empty' });
      return;
    }

    // Get chapter data
    const chapterData = await this.plugin.parseChapterFile(this.currentChapterFile);
    
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
        const charSection = container.createDiv('novalist-section');
        charSection.createEl('h4', { text: '👤 Characters', cls: 'novalist-section-title' });

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
          if (age) info.createEl('span', { text: `Age: ${age}`, cls: 'novalist-tag' });
          if (relationship) info.createEl('span', { text: relationship, cls: 'novalist-tag' });

          // Hover/Click to open
          item.addEventListener('click', () => {
            this.plugin.focusEntityByName(`${charData.name} ${charData.surname}`.trim(), true);
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
        const locSection = container.createDiv('novalist-section');
        locSection.createEl('h4', { text: '📍 Locations', cls: 'novalist-section-title' });

        const locList = locSection.createDiv('novalist-list');
        for (const locData of locationItems) {
          const item = locList.createDiv('novalist-item');
          item.createEl('strong', { text: locData.name });
          if (locData.description) {
            item.createEl('p', { text: locData.description });
          }
          item.addEventListener('click', () => {
            this.plugin.focusEntityByName(locData.name, true);
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

    this.render();
  }
}

// ==========================================
// MODALS
// ==========================================

class CharacterModal extends Modal {
  plugin: NovalistPlugin;
  name: string = '';
  surname: string = '';
  age: string = '';
  relationship: string = '';
  furtherInfo: string = '';
  private previewEl: HTMLElement | null = null;

  constructor(app: App, plugin: NovalistPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl('h2', { text: 'Create New Character' });
    
    // Name
    new Setting(contentEl)
      .setName('Name')
      .addText(text => text.onChange(value => this.name = value));
    
    // Surname
    new Setting(contentEl)
      .setName('Surname')
      .addText(text => text.onChange(value => this.surname = value));
    
    // Age
    new Setting(contentEl)
      .setName('Age')
      .addText(text => text.onChange(value => this.age = value));
    
    // Relationship
    new Setting(contentEl)
      .setName('Relationship')
      .addText(text => text.onChange(value => this.relationship = value));
    
    // Further Info
    new Setting(contentEl)
      .setName('Further Information')
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
        await this.plugin.createCharacter(this.name, this.surname, this.age, this.relationship, this.furtherInfo);
        this.close();
      });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private async renderPreview() {
    if (!this.previewEl) return;
    this.previewEl.empty();
    this.previewEl.createEl('small', { text: 'Preview' });
    const container = this.previewEl.createDiv();
    await MarkdownRenderer.renderMarkdown(this.furtherInfo || '', container, '', this.plugin);
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
    
    contentEl.createEl('h2', { text: 'Create New Location' });
    
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

    contentEl.createEl('h2', { text: 'Create Chapter Description' });

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

    containerEl.createEl('h2', { text: 'Novalist Settings' });

    const projectSection = containerEl.createDiv('novalist-settings-section');

    new Setting(projectSection)
      .setName('Project Path')
      .setDesc('Root folder for your novel project')
      .addText(text => text
        .setPlaceholder('NovelProject')
        .setValue(this.plugin.settings.projectPath)
        .onChange(async (value) => {
          this.plugin.settings.projectPath = value;
          await this.plugin.saveSettings();
        }));

    // Auto Replacements
    const replacementsSection = containerEl.createDiv('novalist-settings-section');
    replacementsSection.createEl('h3', { text: 'Auto Replacements' });
    replacementsSection.createEl('p', { text: 'Configure text shortcuts that will be auto-replaced while typing.' });

    new Setting(replacementsSection)
      .setName('Language')
      .setDesc('Select the typographic language rules used for defaults')
      .addDropdown(dropdown => {
        const customLabel = this.plugin.settings.customLanguageLabel || LANGUAGE_LABELS.custom;
        const options = {
          ...LANGUAGE_LABELS,
          custom: customLabel
        } as Record<string, string>;

        dropdown
          .addOptions(Object.fromEntries(Object.entries(options)))
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            if (!(value in options)) return;
            this.plugin.settings.language = value as LanguageKey;
            this.plugin.applyLanguageDefaults(value as LanguageKey);
            await this.plugin.saveSettings();
            this.display();
          });
      });

    if (this.plugin.settings.language === 'custom') {
      new Setting(replacementsSection)
        .setName('Custom Language Name')
        .setDesc('Display name for your custom language')
        .addText(text => text
          .setPlaceholder('Custom')
          .setValue(this.plugin.settings.customLanguageLabel)
          .onChange(async (value) => {
            this.plugin.settings.customLanguageLabel = value || 'Custom';
            await this.plugin.saveSettings();
            this.display();
          }));

      new Setting(replacementsSection)
        .setName('Save current replacements as custom defaults')
        .setDesc('Sets the custom language defaults to the current replacement pairs')
        .addButton(btn => btn
          .setButtonText('Save as Custom Defaults')
          .onClick(async () => {
            this.plugin.settings.customLanguageDefaults = this.plugin.clonePairs(this.plugin.settings.autoReplacements);
            await this.plugin.saveSettings();
            this.display();
          }));
    }

    const replacementContainer = replacementsSection.createDiv('novalist-replacements');
    const headerRow = replacementContainer.createDiv('novalist-replacement-header');
    headerRow.createEl('div', { text: 'Start' });
    headerRow.createEl('div', { text: 'End' });
    headerRow.createEl('div', { text: 'Start Replace' });
    headerRow.createEl('div', { text: 'End Replace' });
    headerRow.createEl('div');
    
    this.plugin.settings.autoReplacements.forEach((pair) => {
      this.addReplacementSetting(replacementContainer, pair);
    });

    const replacementActions = replacementsSection.createDiv('novalist-replacement-actions');

    new ButtonComponent(replacementActions)
      .setButtonText('Add Replacement')
      .onClick(() => {
        this.plugin.settings.autoReplacements.push({ start: '', end: '', startReplace: '', endReplace: '' });
        void this.plugin.saveSettings();
        this.display();
      });

    new ButtonComponent(replacementActions)
      .setButtonText('Reset to Language Defaults')
      .onClick(async () => {
        this.plugin.applyLanguageDefaults(this.plugin.settings.language);
        await this.plugin.saveSettings();
        this.display();
      });

    const behaviorSection = containerEl.createDiv('novalist-settings-section');

    new Setting(behaviorSection)
      .setName('Enable Hover Preview')
      .setDesc('Show character/location info on hover')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableHoverPreview)
        .onChange(async (value) => {
          this.plugin.settings.enableHoverPreview = value;
          await this.plugin.saveSettings();
        }));

    new Setting(behaviorSection)
      .setName('Enable Sidebar View')
      .setDesc('Show the Novalist context sidebar')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableSidebarView)
        .onChange(async (value) => {
          this.plugin.settings.enableSidebarView = value;
          await this.plugin.saveSettings();
        }));

    new Setting(behaviorSection)
      .setName('Show Merge Log')
      .setDesc('Display merge logs in the Focus sidebar')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableMergeLog)
        .onChange(async (value) => {
          this.plugin.settings.enableMergeLog = value;
          await this.plugin.saveSettings();
        }));
  }

  addReplacementSetting(container: HTMLElement, pair: AutoReplacementPair) {
    const row = container.createDiv('novalist-replacement-row');
    const updateVisibility = () => {
      const hasStart = pair.start.length > 0 && pair.startReplace.length > 0;
      const emptyEnd = pair.end.length === 0 && pair.endReplace.length === 0;
      const sameAsStart = pair.end === pair.start && pair.endReplace === pair.startReplace;
      const isSingle = hasStart && (emptyEnd || sameAsStart);
      endInput.inputEl.style.visibility = isSingle ? 'hidden' : 'visible';
      endInput.inputEl.style.pointerEvents = isSingle ? 'none' : 'auto';
      endReplaceInput.inputEl.style.visibility = isSingle ? 'hidden' : 'visible';
      endReplaceInput.inputEl.style.pointerEvents = isSingle ? 'none' : 'auto';
    };

    const startInput = new TextComponent(row)
      .setPlaceholder('Start')
      .setValue(pair.start)
      .onChange(async (value) => {
        pair.start = value;
        await this.plugin.saveSettings();
        updateVisibility();
      });

    const endInput = new TextComponent(row)
      .setPlaceholder('End')
      .setValue(pair.end)
      .onChange(async (value) => {
        pair.end = value;
        await this.plugin.saveSettings();
        updateVisibility();
      });

    const startReplaceInput = new TextComponent(row)
      .setPlaceholder('Start Replace')
      .setValue(pair.startReplace)
      .onChange(async (value) => {
        pair.startReplace = value;
        await this.plugin.saveSettings();
        updateVisibility();
      });

    const endReplaceInput = new TextComponent(row)
      .setPlaceholder('End Replace')
      .setValue(pair.endReplace)
      .onChange(async (value) => {
        pair.endReplace = value;
        await this.plugin.saveSettings();
        updateVisibility();
      });

    new ButtonComponent(row)
      .setIcon('trash')
      .setTooltip('Remove')
      .onClick(async () => {
        const index = this.plugin.settings.autoReplacements.indexOf(pair);
        if (index >= 0) this.plugin.settings.autoReplacements.splice(index, 1);
        await this.plugin.saveSettings();
        this.display();
      });

      updateVisibility();
  }
}

// ==========================================
// MAIN PLUGIN CLASS
// ==========================================

export default class NovalistPlugin extends Plugin {
  settings: NovalistSettings;
  sidebarView: NovalistSidebarView | null = null;
  private entityIndex: Map<string, { path: string; display: string }> = new Map();
  private entityRegex: RegExp | null = null;
  private lastHoverEntity: string | null = null;
  private hoverTimer: number | null = null;
  private caretTimer: number | null = null;
  private mergeLogPath: string | null = null;
  private mergeLogBuffer: string[] = [];
  private mergeLogBufferLimit = 200;

  async onload() {
    await this.loadSettings();

    this.mergeLogPath = this.getMergeLogPath();
    if (this.mergeLogPath) {
      void this.logMerge('Merge logging initialized.');
    }

    await this.refreshEntityIndex();
    await this.syncAllCharactersChapterInfos();
    this.app.workspace.onLayoutReady(() => {
      void this.syncAllCharactersChapterInfos();
    });

    // Register sidebar view
    this.registerView(
      NOVELIST_SIDEBAR_VIEW_TYPE,
      (leaf) => {
        this.sidebarView = new NovalistSidebarView(leaf, this);
        return this.sidebarView;
      }
    );

    // Add ribbon icon
    this.addRibbonIcon('book-open', 'Novalist', () => {
      this.activateView();
    });

    // Initialize project structure command
    this.addCommand({
      id: 'initialize-novel-project',
      name: 'Initialize Novel Project Structure',
      callback: () => this.initializeProjectStructure()
    });

    // Open sidebar command
    this.addCommand({
      id: 'open-novalist-sidebar',
      name: 'Open Context Sidebar',
      callback: () => this.activateView()
    });

    // Open focused entity in sidebar (edit mode)
    this.addCommand({
      id: 'open-entity-in-sidebar',
      name: 'Open Entity In Sidebar',
      callback: () => this.openEntityFromEditor()
    });

    // Add new character command
    this.addCommand({
      id: 'add-character',
      name: 'Add New Character',
      callback: () => this.openCharacterModal()
    });

    // Add new location command
    this.addCommand({
      id: 'add-location',
      name: 'Add New Location',
      callback: () => this.openLocationModal()
    });

    // Add new chapter description command
    this.addCommand({
      id: 'add-chapter-description',
      name: 'Add Chapter Description',
      callback: () => this.openChapterDescriptionModal()
    });

    // Sync character chapter info command
    this.addCommand({
      id: 'sync-character-chapter-info',
      name: 'Sync Character Chapter Info',
      callback: () => this.syncAllCharactersChapterInfos()
    });

    // Settings tab
    this.addSettingTab(new NovalistSettingTab(this.app, this));

    // Auto-replacement on typing
    this.registerDomEvent(document, 'keyup', (evt: KeyboardEvent) => {
      if (evt.key.length === 1 || evt.key === 'Space' || evt.key === 'Enter') {
        this.handleAutoReplacement();
      }
    });

    // Hover preview handler
    if (this.settings.enableHoverPreview) {
      this.registerHoverLinkSource('novalist', {
        display: 'Novalist',
        defaultMod: true,
      });
    }

    // Auto-link character/location names in reading view for hover previews
    this.registerMarkdownPostProcessor((el, ctx) => {
      if (!this.settings.enableHoverPreview) return;
      if (!ctx?.sourcePath) return;
      if (!this.isChapterPath(ctx.sourcePath) && !this.isCharacterPath(ctx.sourcePath) && !this.isLocationPath(ctx.sourcePath)) return;
      this.linkifyElement(el);
    });

    // Edit-mode hover and click handling
    this.registerDomEvent(document, 'mousemove', (evt: MouseEvent) => {
      if (!this.settings.enableHoverPreview) return;
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) return;
      if (!view.file || !this.isChapterFile(view.file)) return;
      const editor = view.editor;
      const cm = (editor as any)?.cm;
      if (!cm || !(evt.target instanceof Node) || !cm.dom?.contains(evt.target)) return;

      if (this.hoverTimer) window.clearTimeout(this.hoverTimer);
      this.hoverTimer = window.setTimeout(() => {
        const name = this.getEntityAtCoords(editor, evt.clientX, evt.clientY);
        if (!name) {
          if (!this.getEntityAtCursor(editor)) {
            this.clearFocus();
          }
          return;
        }
        if (name === this.lastHoverEntity) return;
        this.lastHoverEntity = name;
        this.openEntityInSidebar(name, { reveal: false });
      }, 120);
    });

    const handleEntityClick = (evt: MouseEvent) => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) return;
      if (!view.file || !this.isChapterFile(view.file)) return;
      const editor = view.editor;
      const cm = (editor as any)?.cm;
      if (!cm || !(evt.target instanceof Node) || !cm.dom?.contains(evt.target)) return;
      if (!evt.ctrlKey && !evt.metaKey) return;

      const name = this.getEntityAtCoords(editor, evt.clientX, evt.clientY);
      if (name) this.openEntityInSidebar(name, { reveal: true });
    };

    this.registerDomEvent(document, 'mousedown', handleEntityClick);
    this.registerDomEvent(document, 'click', handleEntityClick);

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
        this.openEntityInSidebar(name, { reveal: false });
      } else {
        this.clearFocus();
      }
    };

    this.registerDomEvent(document, 'selectionchange', () => {
      if (this.caretTimer) window.clearTimeout(this.caretTimer);
      this.caretTimer = window.setTimeout(handleCaret, 120);
    });
    this.registerDomEvent(document, 'keyup', () => {
      if (this.caretTimer) window.clearTimeout(this.caretTimer);
      this.caretTimer = window.setTimeout(handleCaret, 120);
    });

    // Keep index up to date
    this.registerEvent(this.app.vault.on('create', () => this.refreshEntityIndex()));
    this.registerEvent(this.app.vault.on('delete', () => this.refreshEntityIndex()));
    this.registerEvent(this.app.vault.on('modify', () => this.refreshEntityIndex()));
    this.registerEvent(this.app.vault.on('rename', () => this.refreshEntityIndex()));

    // Auto-create chapter files when chapter descriptions appear
    this.registerEvent(this.app.vault.on('create', (file) => {
      if (file instanceof TFile) this.ensureChapterFileForDesc(file);
    }));
    this.registerEvent(this.app.vault.on('rename', (file) => {
      if (file instanceof TFile) this.ensureChapterFileForDesc(file);
    }));

    // Sync character/location references into chapter descriptions
    this.registerEvent(this.app.vault.on('modify', (file) => {
      if (file instanceof TFile) this.syncChapterDescriptionFromChapter(file);
    }));
    this.registerEvent(this.app.vault.on('rename', (file) => {
      if (file instanceof TFile) this.syncChapterDescriptionFromChapter(file);
    }));

    // Ensure character chapter info sections stay in sync with chapter descriptions
    this.registerEvent(this.app.vault.on('create', (file) => {
      if (file instanceof TFile) this.syncCharacterChapterInfos(file);
    }));
    this.registerEvent(this.app.vault.on('rename', (file) => {
      if (file instanceof TFile) this.syncCharacterChapterInfos(file);
    }));

    // Auto-activate sidebar if enabled
    if (this.settings.enableSidebarView) {
      this.activateView();
    }

    console.log('Novalist plugin loaded');
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(NOVELIST_SIDEBAR_VIEW_TYPE);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    const legacyLanguage = this.settings.language as unknown as string;
    if (legacyLanguage === 'de') this.settings.language = 'de-guillemet';
    if (legacyLanguage === 'en') this.settings.language = 'en';
    if (legacyLanguage === 'fr') this.settings.language = 'fr';

    if (!Array.isArray(this.settings.autoReplacements)) {
      const legacy = this.settings.autoReplacements as unknown as Record<string, string>;
      const pairs: AutoReplacementPair[] = [];
      const open = legacy?.["'"];
      const close = legacy?.["''"];
      if (open || close) {
        pairs.push({ start: "'", end: "'", startReplace: open || '', endReplace: close || '' });
      }

      for (const [key, value] of Object.entries(legacy || {})) {
        if (key === "'" || key === "''") continue;
        pairs.push({ start: key, end: key, startReplace: value, endReplace: value });
      }

      this.settings.autoReplacements = pairs;
    }

    if (!this.settings.autoReplacements || this.settings.autoReplacements.length === 0) {
      this.applyLanguageDefaults(this.settings.language);
    }
    this.settings.autoReplacements = this.clonePairs(this.settings.autoReplacements || []);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  applyLanguageDefaults(language: LanguageKey) {
    this.settings.autoReplacements = this.clonePairs(this.getLanguageAutoReplacements(language));
  }

  private getLanguageAutoReplacements(language: LanguageKey): AutoReplacementPair[] {
    if (language === 'custom') {
      return this.settings.customLanguageDefaults?.length
        ? this.settings.customLanguageDefaults
        : this.settings.autoReplacements || [];
    }

    return LANGUAGE_DEFAULTS[language];
  }

  clonePairs(pairs: AutoReplacementPair[]): AutoReplacementPair[] {
    return pairs.map(pair => ({ ...pair }));
  }

  private resolveConfigPath(configDir: string, basePath: string): string {
    const normalized = configDir.replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/')) return normalized;
    return `${basePath}/${normalized}`;
  }

  private getMergeLogPath(): string | null {
    try {
      const configDir = (this.app.vault as any)?.configDir || '.obsidian';
      const adapter = this.app.vault.adapter as any;
      const basePath = typeof adapter?.getBasePath === 'function' ? adapter.getBasePath() : '';
      if (!configDir || !this.manifest?.id || !basePath) return null;
      const configPath = this.resolveConfigPath(configDir, basePath);
      return `${configPath}/plugins/${this.manifest.id}/merge-log.txt`;
    } catch {
      return null;
    }
  }

  async logMerge(message: string): Promise<void> {
    const stamp = new Date().toISOString();
    const entry = `[${stamp}] ${message}`;
    this.mergeLogBuffer.push(entry);
    if (this.mergeLogBuffer.length > this.mergeLogBufferLimit) {
      this.mergeLogBuffer = this.mergeLogBuffer.slice(-this.mergeLogBufferLimit);
    }
    if (!this.mergeLogPath) return;
    try {
      const adapter = this.app.vault.adapter;
      const entryWithNewline = `${entry}\n`;

      const writeToPath = async (path: string | null) => {
        if (!path) return;
        const dir = path.split('/').slice(0, -1).join('/');
        try {
          const exists = await adapter.exists(dir);
          if (!exists) {
            await adapter.mkdir(dir);
          }
        } catch {
          // ignore dir creation errors
        }
        let existing = '';
        try {
          existing = await adapter.read(path);
        } catch {
          existing = '';
        }
        await adapter.write(path, existing + entryWithNewline);
      };

      await writeToPath(this.mergeLogPath);
    } catch {
      // ignore logging errors
    }
  }

  getMergeLogSnapshot(): string {
    return this.mergeLogBuffer.join('\n');
  }

  async activateView() {
    const { workspace } = this.app;
    
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(NOVELIST_SIDEBAR_VIEW_TYPE);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: NOVELIST_SIDEBAR_VIEW_TYPE, active: true });
    }

    workspace.revealLeaf(leaf);
  }

  private async ensureSidebarView(): Promise<NovalistSidebarView | null> {
    await this.activateView();
    return this.sidebarView;
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
      } catch (e) {
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
    } catch (e) {}

    for (const tmpl of templates) {
      try {
        await vault.create(tmpl.path, tmpl.content);
      } catch (e) {
        // File might exist
      }
    }
  }

  // ==========================================
  // FILE CREATION
  // ==========================================

  async createCharacter(name: string, surname: string, age: string, relationship: string, furtherInfo: string) {
    const vault = this.app.vault;
    const folder = `${this.settings.projectPath}/${this.settings.characterFolder}`;
    const filename = `${name}_${surname}.md`;
    const filepath = `${folder}/${filename}`;

    const content = `# ${name} ${surname}

  ## General Information
  - **Age:** ${age}
  - **Relationship:** ${relationship}

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
    } catch (e) {
      new Notice('Error creating character: ' + e.message);
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
    } catch (e) {
      new Notice('Error creating location: ' + e.message);
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
    } catch (e) {
      new Notice('Error creating chapter description: ' + e.message);
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
    relationship: string;
    furtherInfo: string;
    chapterInfos: Array<{chapter: string, info: string, overrides: Record<string, string>}>;
  }> {
    const content = await this.app.vault.read(file);
    const textData = this.parseCharacterText(content);
    
    const chapterInfos = this.parseChapterOverrides(content);

    return {
      name: textData.name || '',
      surname: textData.surname || '',
      age: textData.age || '',
      relationship: textData.relationship || '',
      furtherInfo: textData.furtherInfo || '',
      chapterInfos
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

    return {
      name: frontmatter.name || '',
      description
    };
  }

  parseImagesSection(content: string): Array<{ name: string; path: string }> {
    const match = content.match(/\s*## Images\s+([\s\S]*?)(?=##|$)/);
    if (!match) return [];

    const lines = match[1].split('\n').map(l => l.trim()).filter(l => l.startsWith('-'));
    const images: Array<{ name: string; path: string }> = [];

    for (const line of lines) {
      const cleaned = line.replace(/^[-*]\s*/, '').trim();
      if (!cleaned) continue;

      const parts = cleaned.split(':');
      if (parts.length >= 2) {
        const name = parts.shift()!.trim();
        let path = parts.join(':').trim();
        path = path.replace(/^!\[\[/, '').replace(/\]\]$/, '').trim();
        if (name) images.push({ name, path });
      } else {
        const nameOnly = cleaned.replace(/^!\[\[/, '').replace(/\]\]$/, '').trim();
        images.push({ name: nameOnly, path: '' });
      }
    }

    return images;
  }

  private parseImageOverrideValue(value: string): Array<{ name: string; path: string }> {
    const lines = value
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    const images: Array<{ name: string; path: string }> = [];

    for (const line of lines) {
      const cleaned = line.replace(/^[-*]\s*/, '').trim();
      if (!cleaned) continue;

      const parts = cleaned.split(':');
      if (parts.length >= 2) {
        const name = parts.shift()!.trim();
        let path = parts.join(':').trim();
        path = path.replace(/^!\[\[/, '').replace(/\]\]$/, '').trim();
        if (name) images.push({ name, path });
      } else {
        const nameOnly = cleaned.replace(/^!\[\[/, '').replace(/\]\]$/, '').trim();
        images.push({ name: nameOnly, path: '' });
      }
    }

    return images;
  }

  private parseCharacterText(content: string): { name: string; surname: string; age: string; relationship: string; furtherInfo: string } {
    const body = this.stripFrontmatter(content);
    let name = '';
    let surname = '';
    let age = '';
    let relationship = '';
    let furtherInfo = '';

    const titleMatch = body.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      const fullName = titleMatch[1].trim();
      const parts = fullName.split(' ');
      name = parts.shift() || '';
      surname = parts.join(' ');
    }

    const generalMatch = body.match(/## General Information\s+([\s\S]*?)(?=##|$)/);
    if (generalMatch) {
      const lines = generalMatch[1].split('\n').map(l => l.trim());
      for (const line of lines) {
        const ageMatch = line.match(/^[-*]\s*\*\*Age\*\*:\s*(.+)$/i);
        if (ageMatch) {
          age = ageMatch[1].trim();
          continue;
        }
        const relMatch = line.match(/^[-*]\s*\*\*Relationship\*\*:\s*(.+)$/i);
        if (relMatch) {
          relationship = relMatch[1].trim();
        }
      }
    }

    const furtherMatch = body.match(/## Further Information\s+([\s\S]*?)(?=##|$)/);
    if (furtherMatch) {
      furtherInfo = furtherMatch[1].trim();
    }

    return { name, surname, age, relationship, furtherInfo };
  }

  parseChapterOverrides(content: string): Array<{ chapter: string; info: string; overrides: Record<string, string> }> {
    const section = content.match(/(?:^|\n)[\t ]*[-*]?\s*## Chapter Relevant Information\s+([\s\S]*?)(?=##|$)/);
    if (!section) return [];

    const lines = section[1].split('\n');
    const results: Array<{ chapter: string; info: string; overrides: Record<string, string> }> = [];

    let current: { chapter: string; info: string; overrides: Record<string, string> } | null = null;
    let currentKey: string | null = null;
    let currentIndent: number | null = null;

    for (const raw of lines) {
      const line = raw.trim();
      const chapterMatch = line.match(/^[-*]\s*\*\*([^*]+)\*\*(?:\s*\([^)]*\))?\s*:?\s*$/);
      if (chapterMatch) {
        if (current) results.push(current);
        current = { chapter: chapterMatch[1].trim(), info: '', overrides: {} };
        currentKey = null;
        currentIndent = null;
        continue;
      }

      if (!current) continue;

      const rawIndent = raw.length - raw.trimStart().length;
      if (currentKey && currentIndent != null && rawIndent > currentIndent) {
        const continuation = raw.trimEnd();
        if (currentKey === 'info') {
          current.info = current.info ? `${current.info}\n${continuation.trim()}` : continuation.trim();
        } else {
          const prev = current.overrides[currentKey] || '';
          current.overrides[currentKey] = prev ? `${prev}\n${continuation.trim()}` : continuation.trim();
        }
        continue;
      }

      const kvMatch = line.match(/^[-*]\s*([^:]+):\s*(.*)$/);
      if (kvMatch) {
        const key = kvMatch[1].trim();
        const value = kvMatch[2].trim();
        currentKey = key.toLowerCase();
        currentIndent = rawIndent;
        if (currentKey === 'info') {
          current.info = value;
        } else {
          current.overrides[currentKey] = value;
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

  async getChapterOverrideImages(charFile: TFile, chapterFile: TFile): Promise<Array<{ name: string; path: string }> | null> {
    const charData = await this.parseCharacterFile(charFile);
    const chapterKey = await this.getChapterNameForFile(chapterFile);
    const chapterInfo = charData.chapterInfos.find(ci => ci.chapter === chapterKey);
    const raw = chapterInfo?.overrides?.images;
    if (!raw || raw.trim().length === 0) return null;

    const content = await this.app.vault.read(charFile);
    const baseImages = this.parseImagesSection(content);
    const baseByName = new Map(baseImages.map(img => [img.name.toLowerCase(), img]));

    const overrides = this.parseImageOverrideValue(raw);
    const used = new Set<string>();
    const merged: Array<{ name: string; path: string }> = [];

    for (const item of overrides) {
      const key = item.name.toLowerCase();
      const base = baseByName.get(key);
      const overridePath = item.path?.trim() ?? '';
      if (!overridePath && base) {
        merged.push({ name: base.name, path: base.path });
      } else {
        merged.push({ name: item.name, path: overridePath });
      }
      used.add(key);
    }

    for (const base of baseImages) {
      const key = base.name.toLowerCase();
      if (!used.has(key)) merged.push(base);
    }

    return merged.length ? merged : null;
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

  private async ensureCharacterChapterInfos(charFile: TFile) {
    const content = await this.app.vault.read(charFile);
    const baseImages = this.parseImagesSection(content);
    const baseImageTags = baseImages.length
      ? baseImages.map(img => `- ${img.name}:`).join('\n')
      : '';
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
        const imagesRaw = prev?.overrides?.images ?? '';
        const images = imagesRaw.trim().length > 0 ? imagesRaw : baseImageTags;
        const info = prev?.info ?? '';

        const knownKeys = new Set(['age', 'relationship', 'further_info', 'images']);
        const extraOverrides = Object.entries(prev?.overrides ?? {})
          .filter(([key]) => !knownKeys.has(key))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => `  - ${key}:${formatValue(value)}`)
          .join('\n');

        const baseBlock = `- **${c.name}**${c.order ? ` (Order: ${c.order})` : ''}:\n` +
          `  - age:${formatValue(age)}\n` +
          `  - relationship:${formatValue(relationship)}\n` +
          `  - further_info:${formatValue(furtherInfo)}\n` +
          `  - images:${formatValue(images)}\n` +
          `  - info:${formatValue(info)}`;

        return extraOverrides ? `${baseBlock}\n${extraOverrides}` : baseBlock;
      })
      .join('\n');

    const section = content.match(/(?:^|\n)[\t ]*[-*]?\s*## Chapter Relevant Information\s+([\s\S]*?)(?=##|$)/);
    const newSection = `## Chapter Relevant Information\n${entries}\n`;

    const normalized = content.replace(/(\S)\s*## Chapter Relevant Information/g, '$1\n\n## Chapter Relevant Information');

    if (!section) {
      const append = `\n${newSection}`;
      const updated = `${normalized.trim()}\n\n${append}`;
      if (updated !== content) {
        await this.app.vault.modify(charFile, updated);
      }
      return;
    }

    if (section[0] === newSection) return;

    const updated = normalized.replace(section[0], `\n\n${newSection}`);
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
      const name = (fm.name || file.basename || '').toString().trim();
      const order = fm.order ? fm.order.toString().trim() : undefined;
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

  async getChapterNameForFile(file: TFile): Promise<string> {
    const descFolder = `${this.settings.projectPath}/${this.settings.chapterDescFolder}`;
    const descPath = `${descFolder}/${file.basename}.md`;
    const descFile = this.app.vault.getAbstractFileByPath(descPath);
    if (descFile instanceof TFile) {
      const descContent = await this.app.vault.read(descFile);
      const fm = this.parseFrontmatter(descContent);
      const name = (fm.name || descFile.basename || '').toString().trim();
      if (name) return name;
    }

    const content = await this.app.vault.read(file);
    const fm = this.parseFrontmatter(content);
    const title = (fm.title || file.basename || '').toString().trim();
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
    
    const characters = frontmatter.characters || [];
    const locations = frontmatter.locations || [];

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

  parseFrontmatter(content: string): Record<string, any> {
    const fmBlock = this.extractFrontmatter(content);
    if (!fmBlock) return {};

    const fm: Record<string, any> = {};
    const lines = fmBlock.split('\n');
    
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        let value: any = line.substring(colonIndex + 1).trim();
        
        // Handle arrays
        if (value.startsWith('[') && value.endsWith(']')) {
          value = value.slice(1, -1).split(',').map((v: string) => v.trim()).filter((v: string) => v);
        }
        
        fm[key] = value;
      }
    }
    
    return fm;
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
    
    let modified = false;
    let newLine = line;
    let cursorAdjustment = 0;

    for (const pair of this.settings.autoReplacements) {
      if (!pair.start) continue;

      if (pair.start === pair.end && this.isSmartQuoteToken(pair.start)) {
        const skip = this.skipOverExistingCloser(newLine, cursor.ch + (newLine.length - line.length) + cursorAdjustment, pair);
        if (skip.handled) {
          newLine = skip.line;
          cursorAdjustment += skip.cursorAdjustment;
          modified = true;
          continue;
        }

        const smartQuotedLine = this.applySmartQuotePair(newLine, pair);
        if (smartQuotedLine !== newLine) {
          newLine = smartQuotedLine;
          modified = true;
        }

        const close = pair.endReplace;
        if (close) {
          const collapse = this.collapseDuplicateCloser(newLine, cursor.ch + (newLine.length - line.length) + cursorAdjustment, close);
          if (collapse.changed) {
            newLine = collapse.line;
            cursorAdjustment += collapse.cursorAdjustment;
            modified = true;
          }
        }
        continue;
      }

      if (pair.start === pair.end) {
        if (newLine.includes(pair.start)) {
          const replacement = pair.startReplace || pair.endReplace;
          if (replacement) {
            newLine = newLine.split(pair.start).join(replacement);
            modified = true;
          }
        }
        continue;
      }

      if (pair.start && pair.startReplace && newLine.includes(pair.start)) {
        newLine = newLine.split(pair.start).join(pair.startReplace);
        modified = true;
      }

      if (pair.end && pair.endReplace && newLine.includes(pair.end)) {
        newLine = newLine.split(pair.end).join(pair.endReplace);
        modified = true;
      }
    }

    if (modified) {
      editor.setLine(cursor.line, newLine);
      // Restore cursor position
      const diff = newLine.length - line.length;
      editor.setCursor({ line: cursor.line, ch: cursor.ch + diff + cursorAdjustment });
    }
  }

  private applySmartQuotePair(line: string, pair: AutoReplacementPair): string {
    if (pair.start !== pair.end || pair.start.length !== 1) return line;
    const token = pair.start;
    const openQuote = pair.startReplace;
    const closeQuote = pair.endReplace;
    if (!openQuote || !closeQuote || !line.includes(token)) return line;

    let result = '';
    let expectingOpen = true;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch !== token) {
        result += ch;
        continue;
      }

      const prev = i > 0 ? line[i - 1] : '';
      const next = i + 1 < line.length ? line[i + 1] : '';
      const prevIsWord = this.isWordChar(prev);
      const nextIsWord = this.isWordChar(next);

      // Keep apostrophes inside words unchanged
      if (prevIsWord && nextIsWord) {
        result += ch;
        continue;
      }

      const prevIsSpace = prev === '' || /\s/.test(prev);
      const nextIsSpace = next === '' || /\s/.test(next);
      const prevIsOpenPunct = /[([{«„‚›<]/.test(prev) || prevIsSpace;
      const nextIsClosePunct = /[)\]}»“’›>,.:;!?]/.test(next) || nextIsSpace;
      const prevIsDash = /[—–-]/.test(prev);

      let useOpen: boolean | null = null;

      if ((prevIsOpenPunct || prevIsDash) && nextIsWord) {
        useOpen = true;
      } else if (prevIsWord && nextIsClosePunct) {
        useOpen = false;
      } else if (!prevIsWord && nextIsWord) {
        useOpen = true;
      } else if (prevIsWord && !nextIsWord) {
        useOpen = false;
      }

      if (useOpen === null) {
        useOpen = expectingOpen;
      }

      result += useOpen ? openQuote : closeQuote;
      expectingOpen = !useOpen;
    }

    return result;
  }

  private isSmartQuoteToken(token: string): boolean {
    return token === "'" || token === '"';
  }

  private collapseDuplicateCloser(
    line: string,
    cursorCh: number,
    close: string
  ): { line: string; cursorAdjustment: number; changed: boolean } {
    const len = close.length;
    if (len === 0) return { line, cursorAdjustment: 0, changed: false };
    if (cursorCh < len || cursorCh + len > line.length) return { line, cursorAdjustment: 0, changed: false };

    const before = line.slice(cursorCh - len, cursorCh);
    const after = line.slice(cursorCh, cursorCh + len);
    if (before !== close || after !== close) return { line, cursorAdjustment: 0, changed: false };

    const updated = line.slice(0, cursorCh - len) + line.slice(cursorCh);
    return { line: updated, cursorAdjustment: len, changed: true };
  }

  private skipOverExistingCloser(
    line: string,
    cursorCh: number,
    pair: AutoReplacementPair
  ): { line: string; cursorAdjustment: number; handled: boolean } {
    const token = pair.start;
    const close = pair.endReplace;
    if (!token || !close) return { line, cursorAdjustment: 0, handled: false };
    if (cursorCh <= 0) return { line, cursorAdjustment: 0, handled: false };

    const typed = line.slice(cursorCh - token.length, cursorCh);
    const ahead = line.slice(cursorCh, cursorCh + close.length);
    if (typed !== token || ahead !== close) return { line, cursorAdjustment: 0, handled: false };

    const updated = line.slice(0, cursorCh - token.length) + line.slice(cursorCh);
    return { line: updated, cursorAdjustment: close.length, handled: true };
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

    for (const charFile of charFiles) {
      try {
        const data = await this.parseCharacterFile(charFile);
        const fullName = `${data.name} ${data.surname}`.trim();
        if (fullName) index.set(fullName.toLowerCase(), { path: charFile.path, display: fullName });
        if (data.name) index.set(data.name.toLowerCase(), { path: charFile.path, display: data.name });
        if (data.surname) index.set(data.surname.toLowerCase(), { path: charFile.path, display: data.surname });
        if (charFile.basename) index.set(charFile.basename.toLowerCase(), { path: charFile.path, display: fullName || charFile.basename });
      } catch (e) {
        // ignore parse errors
      }
    }

    for (const locFile of locFiles) {
      try {
        const data = await this.parseLocationFile(locFile);
        if (data.name) index.set(data.name.toLowerCase(), { path: locFile.path, display: data.name });
        if (locFile.basename) index.set(locFile.basename.toLowerCase(), { path: locFile.path, display: data.name || locFile.basename });
      } catch (e) {
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
    return !!ch && /[\p{L}\p{N}_]/u.test(ch);
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
    const cm = (editor as any)?.cm;
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
    return content.replace(/(?:^|\n)[\t ]*[-*]?\s*## Chapter Relevant Information\s+[\s\S]*?(?=##|$)/, '').trim();
  }

  stripImagesSection(content: string): string {
    return content.replace(/\s*## Images\s+[\s\S]*?(?=##|$)/, '').trim();
  }

  extractTitle(content: string): string | null {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
  }

  removeTitle(content: string): string {
    return content.replace(/^#\s+.+\n?/, '').trim();
  }

  applyCharacterOverridesToBody(content: string, overrides: Record<string, string>): string {
    const filteredOverrides = Object.fromEntries(
      Object.entries(overrides || {}).filter(([key]) => !['images', 'info', 'further_info'].includes(key))
    );

    if (!filteredOverrides || Object.keys(filteredOverrides).length === 0) {
      void this.logMerge('No chapter overrides found; skipping merge.');
      return content;
    }

    void this.logMerge(
      `Merging chapter overrides into character body. Overrides: ${JSON.stringify(filteredOverrides)}`
    );

    return content.replace(/## General Information\s+([\s\S]*?)(?=##|$)/, (match, section) => {
      void this.logMerge(`Input General Information section:\n${section.trim()}`);
      const lines = section.split('\n');
      const output: string[] = [];
      const seenKeys = new Set<string>();

      const normalizeKey = (raw: string) =>
        raw
          .trim()
          .toLowerCase()
          .replace(/\*\*/g, '')
          .replace(/__/g, '')
          .replace(/\s+/g, '_')
          .replace(/[^a-z0-9_]/g, '');

      const propPattern = /^(?:[-*+•–—]\s*)?(?:\*\*|__)?(.+?)(?:\*\*|__)?\s*:\s*(.*)$/;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          output.push(line);
          continue;
        }

        const matchProp = trimmed.match(propPattern);
        if (matchProp) {
          const rawKey = matchProp[1];
          let baseValue = matchProp[2]?.trim() ?? '';
          baseValue = baseValue.replace(/^\*+\s*/, '').replace(/\s*\*+$/, '').trim();
          const key = normalizeKey(rawKey);
          if (!key) {
            output.push(line);
            continue;
          }
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          const overrideValueRaw = filteredOverrides[key];
          const overrideValue = overrideValueRaw != null ? overrideValueRaw.trim() : '';
          const value = overrideValue.length > 0 ? overrideValue : baseValue;
          if (value) {
            output.push(`- **${rawKey.trim()}**: ${value}`);
          }
          continue;
        }

        output.push(line);
      }

      for (const [rawKey, rawValue] of Object.entries(filteredOverrides)) {
        const key = normalizeKey(rawKey);
        if (seenKeys.has(key)) continue;
        const value = rawValue != null ? rawValue.trim() : '';
        if (value) {
          output.push(`- **${rawKey}**: ${value}`);
        }
      }

      const updated = output.join('\n').trim();
      void this.logMerge(`Output General Information section:\n${updated}`);
      void this.logMerge(`General Information section merged. Result length: ${updated.length}`);
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

  private isCharacterPath(path: string): boolean {
    const folder = `${this.settings.projectPath}/${this.settings.characterFolder}`;
    if (!path.startsWith(folder)) return false;
    if (!path.endsWith('.md')) return false;
    const base = path.split('/').pop() || '';
    if (base.startsWith('_')) return false;
    return true;
  }

  private isLocationPath(path: string): boolean {
    const folder = `${this.settings.projectPath}/${this.settings.locationFolder}`;
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
      if (fm.name) title = fm.name;
      if (fm.order) chapterNumber = fm.order;
      if (fm.outline) description = fm.outline;
    } catch (e) {
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
    } catch (e) {
      const message = (e && e.message) ? e.message.toString() : '';
      if (message.toLowerCase().includes('already exists')) return;
      new Notice('Error creating chapter file: ' + message);
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
    if (!this.sidebarView) return;
    if (!this.sidebarView.selectedEntity) return;
    this.lastHoverEntity = null;
    this.sidebarView.setSelectedEntity(null, { forceFocus: false });
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

  linkifyElement(el: HTMLElement) {
    if (!this.entityRegex || this.entityIndex.size === 0) return;

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
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
      const fragment = document.createDocumentFragment();
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
          fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
        }

        const key = matchText.toLowerCase();
        const entity = this.entityIndex.get(key);
        if (entity) {
          const link = document.createElement('a');
          link.className = 'internal-link';
          link.setAttribute('data-href', entity.path);
          link.setAttribute('href', entity.path);
          link.textContent = matchText;
          fragment.appendChild(link);
        } else {
          fragment.appendChild(document.createTextNode(matchText));
        }

        lastIndex = end;
      }

      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      node.parentNode?.replaceChild(fragment, node);
    }
  }
}