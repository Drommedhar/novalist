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
import { parseCharacterSheet } from '../utils/characterSheetUtils';
import { parseLocationSheet } from '../utils/locationSheetUtils';

export const NOVELIST_SIDEBAR_VIEW_TYPE = 'novalist-sidebar';

export class NovalistSidebarView extends ItemView {
  plugin: NovalistPlugin;
  currentChapterFile: TFile | null = null;
  selectedEntity: { type: 'character' | 'location'; file: TFile; display: string } | null = null;
  private activeTab: 'actions' | 'context' | 'focus' = 'context';
  private lastNonFocusTab: 'actions' | 'context' = 'context';
  private lastFocusKey: string | null = null;
  private autoFocusActive = true;
  private focusPinned = false;
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
      this.autoFocusActive = true;
      this.activeTab = tab;
      this.focusPinned = tab === 'focus';
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
      this.focusPinned = false;
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

        let images: Array<{ name: string; path: string }> = [];
        let characterSheet = null as ReturnType<typeof parseCharacterSheet> | null;
        let locationSheet = null as ReturnType<typeof parseLocationSheet> | null;
        
        // Check for chapter-specific image overrides
        let chapterImages: Array<{ name: string; path: string }> | null = null;
        if (this.currentChapterFile) {
          const chapterId = this.plugin.getChapterIdForFile(this.currentChapterFile);
          const chapterName = this.plugin.getChapterNameForFile(this.currentChapterFile);
          chapterImages = this.plugin.parseCharacterSheetChapterImages(content, chapterId, chapterName);
        }
        
        const renderImages = () => {
          // Use chapter override images if available, otherwise use default images
          const displayImages = chapterImages && chapterImages.length > 0 ? chapterImages : images;
          if (displayImages.length === 0) return;
          
          const imageRow = details.createDiv('novalist-image-row');
          imageRow.createEl('span', { text: 'Images', cls: 'novalist-image-label' });

          const dropdown = new DropdownComponent(imageRow);
          for (const img of displayImages) {
            dropdown.addOption(img.name, img.name);
          }

          const key = selectedEntity.file.path;
          const selected = this.selectedImageByPath.get(key) || displayImages[0].name;
          dropdown.setValue(selected);

          const imageContainer = details.createDiv('novalist-image-preview');
          const renderImage = (name: string) => {
            const img = displayImages.find(i => i.name === name) || displayImages[0];
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

        // Helper to render a group of key-value properties as pills
        const renderProps = (
          parent: HTMLElement,
          props: Array<{ label: string; value: string }>
        ) => {
          if (props.length === 0) return;
          const row = parent.createDiv('novalist-focus-props');
          for (const p of props) {
            const pill = row.createDiv('novalist-focus-prop');
            pill.createEl('span', { text: p.label, cls: 'novalist-focus-prop-label' });
            pill.createEl('span', { text: p.value, cls: 'novalist-focus-prop-value' });
          }
        };

        // Helper to render a titled group with custom children
        const renderGroup = (parent: HTMLElement, title: string): HTMLElement => {
          const group = parent.createDiv('novalist-focus-group');
          group.createEl('div', { text: title, cls: 'novalist-focus-group-title' });
          return group;
        };

        if (selectedEntity.type === 'character') {
          characterSheet = parseCharacterSheet(content);
          images = characterSheet.images;

          const chapterId = this.currentChapterFile ? this.plugin.getChapterIdForFile(this.currentChapterFile) : '';
          const chapterName = this.currentChapterFile ? this.plugin.getChapterNameForFile(this.currentChapterFile) : '';
          const override = characterSheet.chapterOverrides.find(
            (o) => o.chapter === chapterId || o.chapter === chapterName
          );

          const displayData = {
            ...characterSheet,
            ...override,
            customProperties: override?.customProperties
              ? { ...characterSheet.customProperties, ...override.customProperties }
              : characterSheet.customProperties,
            relationships: override?.relationships ?? characterSheet.relationships,
            images: override?.images ?? characterSheet.images
          };

          renderImages();

          // Basic properties as pills
          const basicProps: Array<{ label: string; value: string }> = [];
          if (displayData.gender) basicProps.push({ label: 'Gender', value: displayData.gender });
          if (displayData.age) basicProps.push({ label: 'Age', value: displayData.age });
          if (displayData.role) basicProps.push({ label: 'Role', value: displayData.role });
          renderProps(details, basicProps);

          // Custom properties
          if (displayData.customProperties && Object.keys(displayData.customProperties).length > 0) {
            const group = renderGroup(details, 'Properties');
            const list = group.createDiv('novalist-focus-kv-list');
            for (const [key, val] of Object.entries(displayData.customProperties)) {
              if (!val) continue;
              const row = list.createDiv('novalist-focus-kv-row');
              row.createEl('span', { text: key, cls: 'novalist-focus-kv-key' });
              row.createEl('span', { text: val, cls: 'novalist-focus-kv-value' });
            }
          }

          // Relationships
          if (displayData.relationships && displayData.relationships.length > 0) {
            const group = renderGroup(details, 'Relationships');
            const list = group.createDiv('novalist-focus-rel-list');
            for (const rel of displayData.relationships) {
              const row = list.createDiv('novalist-focus-rel-row');
              row.createEl('span', { text: rel.role, cls: 'novalist-focus-rel-role' });
              const nameEl = row.createDiv('novalist-focus-rel-name');
              await MarkdownRenderer.render(this.app, rel.character, nameEl, '', this);
            }
          }

          // Free-form sections via MarkdownRenderer
          if (displayData.sections && displayData.sections.length > 0) {
            for (const section of displayData.sections) {
              const group = renderGroup(details, section.title);
              const md = group.createDiv('novalist-markdown');
              await MarkdownRenderer.render(this.app, section.content, md, '', this);
            }
          }
        }

        if (selectedEntity.type === 'location') {
          locationSheet = parseLocationSheet(content);
          images = locationSheet.images;

          renderImages();

          // Basic properties
          const basicProps: Array<{ label: string; value: string }> = [];
          if (locationSheet.type) basicProps.push({ label: 'Type', value: locationSheet.type });
          renderProps(details, basicProps);

          // Description
          if (locationSheet.description) {
            const descGroup = renderGroup(details, 'Description');
            descGroup.createEl('p', { text: locationSheet.description, cls: 'novalist-focus-description' });
          }

          // Custom properties
          if (Object.keys(locationSheet.customProperties).length > 0) {
            const group = renderGroup(details, 'Properties');
            const list = group.createDiv('novalist-focus-kv-list');
            for (const [key, val] of Object.entries(locationSheet.customProperties)) {
              if (!val) continue;
              const row = list.createDiv('novalist-focus-kv-row');
              row.createEl('span', { text: key, cls: 'novalist-focus-kv-key' });
              row.createEl('span', { text: val, cls: 'novalist-focus-kv-value' });
            }
          }

          // Free-form sections
          if (locationSheet.sections.length > 0) {
            for (const section of locationSheet.sections) {
              const group = renderGroup(details, section.title);
              const md = group.createDiv('novalist-markdown');
              await MarkdownRenderer.render(this.app, section.content, md, '', this);
            }
          }
        }
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
        .setButtonText('Add chapter')
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

      const chapterId = this.currentChapterFile ? this.plugin.getChapterIdForFileSync(this.currentChapterFile) : '';
      const chapterName = this.currentChapterFile ? this.plugin.getChapterNameForFileSync(this.currentChapterFile) : '';

      for (const charName of chapterData.characters) {
        const charFile = this.plugin.findCharacterFile(charName);
        if (!charFile) continue;
        const charData = await this.plugin.parseCharacterFile(charFile);
        const chapterInfo = charData.chapterInfos.find(
          ci => ci.chapter === chapterId || ci.chapter === chapterName
        );
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

    if (entity) {
      // Switching to an entity - go to focus tab
      if (this.autoFocusActive || options?.forceFocus) {
        if (this.activeTab !== 'focus') {
          this.lastNonFocusTab = this.activeTab;
        }
        this.activeTab = 'focus';
        if (options?.forceFocus) {
          this.focusPinned = true;
        }
      }
    } else {
      // Clearing focus - go back to last non-focus tab
      if (this.activeTab === 'focus') {
        this.activeTab = this.lastNonFocusTab;
      }
      this.focusPinned = false;
      this.selectedEntity = null;
    }

    if (changed || options?.forceFocus) {
      void this.render();
    } else if (entity === null && this.activeTab === this.lastNonFocusTab) {
      // Only re-render when clearing focus if we actually changed tabs
      void this.render();
    }
  }

  shouldKeepFocus(): boolean {
    return this.activeTab === 'focus' && this.selectedEntity !== null && this.focusPinned;
  }
}
