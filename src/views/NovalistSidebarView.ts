import {
  ItemView,
  TFile,
  WorkspaceLeaf,
  DropdownComponent,
  MarkdownRenderer,
  ButtonComponent
} from 'obsidian';
import type NovalistPlugin from '../main';
import { CharacterData, CharacterChapterInfo, LocationData } from '../types';

export const NOVELIST_SIDEBAR_VIEW_TYPE = 'novalist-sidebar';

export class NovalistSidebarView extends ItemView {
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

  onOpen(): Promise<void> {
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

    return Promise.resolve();
  }

  async render(): Promise<void> {
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

      const handled = this.plugin.focusEntityByName(href, true);
      if (handled) {
        evt.preventDefault();
        evt.stopPropagation();
      }
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
            const chapterKey = this.plugin.getChapterNameForFile(this.currentChapterFile);
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
          const chapterKey = this.plugin.getChapterNameForFile(this.currentChapterFile);
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
      container.createEl('p', { text: 'Open a chapter file to see context.', cls: 'novalist-empty' });
      return;
    }

    const contextContent = container.createDiv('novalist-context-content');
    const chapterData = await this.plugin.parseChapterFile(this.currentChapterFile);
    
    // Characters Section
    if (chapterData.characters.length > 0) {
      const characterItems: Array<{
        data: CharacterData;
        chapterInfo: CharacterChapterInfo | undefined;
      }> = [];

      const chapterKey = this.currentChapterFile ? this.plugin.getChapterNameForFileSync(this.currentChapterFile) : '';

      for (const charName of chapterData.characters) {
        const charFile = this.plugin.findCharacterFile(charName);
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
      const locationItems: Array<LocationData> = [];

      for (const locName of chapterData.locations) {
        const locFile = this.plugin.findLocationFile(locName);
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

  onClose(): Promise<void> {
    // Cleanup
    return Promise.resolve();
  }

  setSelectedEntity(
    entity: { type: 'character' | 'location'; file: TFile; display: string } | null,
    options?: { forceFocus?: boolean }
  ): void {
    const nextKey = entity ? entity.file.path : null;
    const changed = nextKey !== this.lastFocusKey;
    this.lastFocusKey = nextKey;
    this.selectedEntity = entity;

    if (entity && this.autoFocusActive) {
      this.activeTab = 'focus';
    }

    if (options?.forceFocus) {
      this.activeTab = 'focus';
    }

    if (changed || options?.forceFocus) {
      void this.render();
    }
  }
}
