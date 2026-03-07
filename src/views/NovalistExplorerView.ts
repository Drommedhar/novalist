import {
  App,
  FuzzySuggestModal,
  ItemView,
  Modal,
  Notice,
  Setting,
  TFile,
  WorkspaceLeaf,
  MarkdownView,
  Menu
} from 'obsidian';
import type NovalistPlugin from '../main';
import { normalizeCharacterRole } from '../utils/characterUtils';
import { ChapterListData, CharacterListData, LocationListData, CHAPTER_STATUSES, ChapterStatus } from '../types';
import { ChapterEditData } from '../modals/ChapterDescriptionModal';
import { SceneNameModal } from '../modals/SceneNameModal';
import { SnapshotNameModal, SnapshotListModal } from '../modals/SnapshotModal';
import { t } from '../i18n';

export const NOVELIST_EXPLORER_VIEW_TYPE = 'novalist-explorer';

export class NovalistExplorerView extends ItemView {
  plugin: NovalistPlugin;
  private activeTab: 'chapters' | 'characters' | 'locations' | 'items' | 'lore' = 'chapters';
  private dragChapterIndex: number | null = null;
  private selectedFiles: Set<string> = new Set();
  private lastSelectedPath: string | null = null;
  private propertyFilter = '';
  private filteredPaths: Set<string> | null = null;
  private filterDebounceTimer: number | null = null;
  private propertyIndex: Map<string, Set<string>> | null = null;
  private filterBarEl: HTMLElement | null = null;
  private filterInputEl: HTMLInputElement | null = null;
  private suggestionsEl: HTMLElement | null = null;
  private characterGroupMode: 'role' | 'group' = 'role';
  private draggingLocationPath: string | null = null;
  private locationTreeCollapsed: Set<string> = new Set();

  constructor(leaf: WorkspaceLeaf, plugin: NovalistPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return NOVELIST_EXPLORER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t('explorer.displayName');
  }

  getIcon(): string {
    return 'folder';
  }

  onOpen(): Promise<void> {
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

    return Promise.resolve();
  }

  async render(): Promise<void> {
    const container = this.containerEl;
    container.empty();
    container.addClass('novalist-explorer');

    // Reset filter bar references since DOM was cleared
    this.filterBarEl = null;
    this.filterInputEl = null;
    this.suggestionsEl = null;

    container.createEl('h3', { text: t('explorer.displayName'), cls: 'novalist-explorer-header' });

    const tabs = container.createDiv('novalist-explorer-tabs');
    const tabOrder: Array<{ id: 'chapters' | 'characters' | 'locations' | 'items' | 'lore'; label: string }> = [
      { id: 'chapters', label: t('explorer.chapters') },
      { id: 'characters', label: t('explorer.characters') },
      { id: 'locations', label: t('explorer.locations') },
      { id: 'items', label: t('explorer.items') },
      { id: 'lore', label: t('explorer.lore') }
    ];

    const setTab = (tab: 'chapters' | 'characters' | 'locations' | 'items' | 'lore') => {
      this.activeTab = tab;
      this.propertyFilter = '';
      this.filteredPaths = null;
      this.propertyIndex = null;
      void this.render();
    };

    for (const tab of tabOrder) {
      const btn = tabs.createEl('button', {
        text: tab.label,
        cls: `novalist-explorer-tab ${this.activeTab === tab.id ? 'is-active' : ''}`
      });
      btn.addEventListener('click', () => setTab(tab.id));
    }

    // Property filter bar for characters, locations, items, and lore tabs
    if (this.activeTab === 'characters' || this.activeTab === 'locations' || this.activeTab === 'items' || this.activeTab === 'lore') {
      this.renderPropertyFilterBar(container);
      // Preload the property index for suggestions
      if (!this.propertyIndex) {
        void this.loadPropertyIndex();
      }
    }

    const list = container.createDiv('novalist-explorer-list');
    list.dataset.role = 'entity-list';

    await this.renderListContent(list);

    this.renderProjectSwitcher(container);
  }

  /** Render only the list content (characters / locations / chapters). */
  private async renderListContent(list: HTMLElement): Promise<void> {
    list.empty();

    if (this.activeTab === 'chapters') {
      const chapters = await this.plugin.getChapterDescriptions();
      const chapterItems = chapters.map((chapter) => ({
        name: chapter.name,
        order: chapter.order,
        status: chapter.status,
        act: chapter.act,
        file: chapter.file,
        scenes: chapter.scenes
      }));
      this.renderChapterList(list, chapterItems, t('explorer.noChapters'));
    } else if (this.activeTab === 'characters') {
      let characters = await this.plugin.getCharacterList();
      if (this.filteredPaths) {
        const filtered = this.filteredPaths;
        characters = characters.filter(c => filtered.has(c.file.path));
      }
      // Group-mode toggle
      const toggleBar = list.createDiv('novalist-group-mode-toggle');
      const roleBtn = toggleBar.createEl('button', {
        text: t('explorer.groupByRole'),
        cls: `novalist-group-mode-btn ${this.characterGroupMode === 'role' ? 'is-active' : ''}`,
      });
      const groupBtn = toggleBar.createEl('button', {
        text: t('explorer.groupByGroup'),
        cls: `novalist-group-mode-btn ${this.characterGroupMode === 'group' ? 'is-active' : ''}`,
      });
      roleBtn.addEventListener('click', () => {
        this.characterGroupMode = 'role';
        void this.refreshListOnly();
      });
      groupBtn.addEventListener('click', () => {
        this.characterGroupMode = 'group';
        void this.refreshListOnly();
      });
      if (this.propertyFilter && characters.length === 0) {
        list.createEl('p', { text: t('explorer.filterNoResults'), cls: 'novalist-empty' });
      } else {
        this.renderCharacterGroupedList(list, characters, t('explorer.noCharacters'));
      }
    } else if (this.activeTab === 'locations') {
      let locations = this.plugin.getLocationList();
      if (this.filteredPaths) {
        const filtered = this.filteredPaths;
        locations = locations.filter(l => filtered.has(l.file.path));
      }
      if (this.propertyFilter && locations.length === 0) {
        list.createEl('p', { text: t('explorer.filterNoResults'), cls: 'novalist-empty' });
      } else {
        this.renderLocationTree(list, locations, t('explorer.noLocations'));
      }
    } else if (this.activeTab === 'items') {
      let items = this.plugin.getItemList();
      if (this.filteredPaths) {
        const filtered = this.filteredPaths;
        items = items.filter(i => filtered.has(i.file.path));
      }
      if (this.propertyFilter && items.length === 0) {
        list.createEl('p', { text: t('explorer.filterNoResults'), cls: 'novalist-empty' });
      } else {
        this.renderList(list, items, t('explorer.noItems'));
      }
    } else if (this.activeTab === 'lore') {
      let lore = this.plugin.getLoreList();
      if (this.filteredPaths) {
        const filtered = this.filteredPaths;
        lore = lore.filter(l => filtered.has(l.file.path));
      }
      if (this.propertyFilter && lore.length === 0) {
        list.createEl('p', { text: t('explorer.filterNoResults'), cls: 'novalist-empty' });
      } else {
        this.renderList(list, lore, t('explorer.noLore'));
      }
    }
  }

  /** Re-render only the entity list without touching the filter bar. */
  private async refreshListOnly(): Promise<void> {
    const list = this.containerEl.querySelector<HTMLElement>('[data-role="entity-list"]');
    if (!list) {
      void this.render();
      return;
    }
    await this.renderListContent(list);
  }

  /** Render a sticky project switcher bar at the bottom of the explorer. */
  private renderProjectSwitcher(container: HTMLElement): void {
    const projects = this.plugin.getProjects();
    if (projects.length <= 1) return;

    const activeProject = this.plugin.getActiveProject();
    const bar = container.createDiv('novalist-explorer-project-bar');

    const select = bar.createEl('select', { cls: 'novalist-explorer-project-select' });
    for (const project of projects) {
      const opt = select.createEl('option', { text: project.name, value: project.id });
      if (project.id === activeProject?.id) opt.selected = true;
    }

    select.addEventListener('change', () => {
      void this.plugin.switchProject(select.value);
    });
  }

  /** Render a property filter bar above the list. */
  private renderPropertyFilterBar(container: HTMLElement): void {
    const bar = container.createDiv('novalist-explorer-filter-bar');
    this.filterBarEl = bar;

    const wrapper = bar.createDiv('novalist-explorer-filter-wrapper');

    const input = wrapper.createEl('input', {
      type: 'text',
      cls: 'novalist-explorer-filter-input',
      placeholder: t('explorer.filterPlaceholder'),
      value: this.propertyFilter,
    });
    this.filterInputEl = input;

    // Suggestions dropdown (hidden by default)
    const suggestions = wrapper.createDiv('novalist-explorer-filter-suggestions is-hidden');
    this.suggestionsEl = suggestions;

    if (this.propertyFilter) {
      const clearBtn = bar.createEl('button', {
        cls: 'novalist-explorer-filter-clear',
        attr: { 'aria-label': t('explorer.clearFilter') },
      });
      clearBtn.createEl('span', { text: '✕' });
      clearBtn.addEventListener('click', () => {
        this.propertyFilter = '';
        this.filteredPaths = null;
        input.value = '';
        this.hideSuggestions();
        // Remove the clear button
        clearBtn.remove();
        void this.refreshListOnly();
      });
    }

    input.addEventListener('input', () => {
      if (this.filterDebounceTimer !== null) {
        window.clearTimeout(this.filterDebounceTimer);
      }
      this.filterDebounceTimer = window.setTimeout(() => {
        this.filterDebounceTimer = null;
        this.propertyFilter = input.value;
        void this.applyPropertyFilter();
      }, 300);
      // Update suggestions immediately as user types
      this.updateSuggestions(input.value);
    });

    input.addEventListener('focus', () => {
      this.updateSuggestions(input.value);
    });

    input.addEventListener('blur', () => {
      // Delay hiding so click on suggestion can fire first
      window.setTimeout(() => this.hideSuggestions(), 200);
    });

    // Keyboard navigation for suggestions
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!this.suggestionsEl || this.suggestionsEl.hasClass('is-hidden')) return;
      const items = this.suggestionsEl.querySelectorAll('.novalist-filter-suggestion-item');
      if (items.length === 0) return;

      const active = this.suggestionsEl.querySelector<HTMLElement>('.is-active');
      let idx = active ? Array.from(items).indexOf(active) : -1;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (active) active.removeClass('is-active');
        idx = (idx + 1) % items.length;
        (items[idx] as HTMLElement).addClass('is-active');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (active) active.removeClass('is-active');
        idx = idx <= 0 ? items.length - 1 : idx - 1;
        (items[idx] as HTMLElement).addClass('is-active');
      } else if (e.key === 'Enter' && active) {
        e.preventDefault();
        const value = active.dataset.value;
        if (value) this.selectSuggestion(value);
      } else if (e.key === 'Escape') {
        this.hideSuggestions();
      }
    });
  }

  /** Preload the property index for auto-suggestions. */
  private async loadPropertyIndex(): Promise<void> {
    if (this.activeTab === 'characters') {
      this.propertyIndex = await this.plugin.collectCharacterPropertyIndex();
    } else if (this.activeTab === 'locations') {
      this.propertyIndex = await this.plugin.collectLocationPropertyIndex();
    }
  }

  /** Update the suggestions dropdown based on current input. */
  private updateSuggestions(raw: string): void {
    if (!this.suggestionsEl || !this.propertyIndex) {
      return;
    }
    this.suggestionsEl.empty();

    const colonIdx = raw.indexOf(':');
    const suggestions: Array<{ display: string; value: string }> = [];

    if (colonIdx === -1) {
      // User hasn't typed ":" yet — suggest matching property keys
      const query = raw.toLowerCase().trim();
      for (const key of this.propertyIndex.keys()) {
        if (!query || key.toLowerCase().includes(query)) {
          suggestions.push({ display: key, value: `${key}: ` });
        }
      }
    } else {
      // User has typed "key:" — suggest matching values for that key
      const keyPart = raw.substring(0, colonIdx).trim();
      const valuePart = raw.substring(colonIdx + 1).trim().toLowerCase();

      // Find the matching key (case-insensitive)
      let matchedKey: string | null = null;
      for (const key of this.propertyIndex.keys()) {
        if (key.toLowerCase() === keyPart.toLowerCase()) {
          matchedKey = key;
          break;
        }
      }
      if (matchedKey) {
        const values = this.propertyIndex.get(matchedKey);
        if (values) {
          for (const val of values) {
            if (!valuePart || val.toLowerCase().includes(valuePart)) {
              suggestions.push({ display: `${matchedKey}: ${val}`, value: `${matchedKey}: ${val}` });
            }
          }
        }
      }
    }

    if (suggestions.length === 0) {
      this.hideSuggestions();
      return;
    }

    // Cap suggestions at 12
    const capped = suggestions.slice(0, 12);
    for (const s of capped) {
      const item = this.suggestionsEl.createDiv({
        cls: 'novalist-filter-suggestion-item',
        text: s.display,
      });
      item.dataset.value = s.value;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); // prevent blur
        this.selectSuggestion(s.value);
      });
    }
    this.suggestionsEl.removeClass('is-hidden');
  }

  /** Select a suggestion and apply the filter. */
  private selectSuggestion(value: string): void {
    this.propertyFilter = value;
    if (this.filterInputEl) {
      this.filterInputEl.value = value;
      this.filterInputEl.focus();
      this.filterInputEl.setSelectionRange(value.length, value.length);
    }
    this.hideSuggestions();

    // If the suggestion ends with ": " the user picked a key — don't filter yet,
    // wait for them to pick or type a value
    if (value.trimEnd().endsWith(':')) {
      // Show value suggestions
      this.updateSuggestions(value);
      return;
    }

    void this.applyPropertyFilter();
  }

  /** Hide the suggestions dropdown. */
  private hideSuggestions(): void {
    if (this.suggestionsEl) {
      this.suggestionsEl.addClass('is-hidden');
    }
  }

  /** Parse the filter string and apply it. */
  private async applyPropertyFilter(): Promise<void> {
    const raw = this.propertyFilter.trim();
    if (!raw) {
      this.filteredPaths = null;
      void this.refreshListOnly();
      return;
    }

    // Parse "key: value" format; also support "key" (any non-empty value)
    const colonIdx = raw.indexOf(':');
    let filterKey: string;
    let filterValue: string;
    if (colonIdx !== -1) {
      filterKey = raw.substring(0, colonIdx).trim();
      filterValue = raw.substring(colonIdx + 1).trim();
    } else {
      filterKey = raw;
      filterValue = '';
    }

    if (this.activeTab === 'characters') {
      this.filteredPaths = await this.plugin.filterCharactersByProperty(filterKey, filterValue);
    } else if (this.activeTab === 'locations') {
      this.filteredPaths = await this.plugin.filterLocationsByProperty(filterKey, filterValue);
    }
    void this.refreshListOnly();
  }

  private async handleContextMenu(evt: MouseEvent, file: TFile): Promise<void> {
    evt.preventDefault();
    const menu = new Menu();

    if (this.plugin.isChapterFile(file)) {
      menu.addItem((item) => {
        item
          .setTitle(t('explorer.editChapter'))
          .setIcon('pencil')
          .onClick(() => {
            this.openEditChapterModal(file);
          });
      });

      menu.addItem((item) => {
        item
          .setTitle(t('explorer.addScene'))
          .setIcon('plus')
          .onClick(() => {
            this.plugin.promptSceneName(file);
          });
      });

      // Add act (assigns this chapter)
      menu.addItem((item) => {
        item
          .setTitle(t('explorer.addAct'))
          .setIcon('bookmark-plus')
          .onClick(() => {
            this.promptActName(file);
          });
      });

      // Assign to act submenu
      const acts = this.plugin.getActNames();
      const currentAct = this.plugin.getActForFileSync(file);
      if (acts.length > 0) {
        menu.addSeparator();
        for (const act of acts) {
          menu.addItem((item) => {
            item
              .setTitle(`${act}${act === currentAct ? ' ✓' : ''}`)
              .setIcon('bookmark')
              .onClick(async () => {
                await this.plugin.assignChapterToAct(file, act);
                void this.render();
              });
          });
        }
        if (currentAct) {
          menu.addItem((item) => {
            item
              .setTitle(t('explorer.removeFromAct'))
              .setIcon('x')
              .onClick(async () => {
                await this.plugin.removeChapterFromAct(file);
                void this.render();
              });
          });
        }
      }

      // ── Snapshot actions ──────────────────────────────────────────
      menu.addSeparator();
      menu.addItem((item) => {
        item
          .setTitle(t('explorer.snapshot'))
          .setIcon('camera')
          .onClick(() => {
            new SnapshotNameModal(this.app, this.plugin, file).open();
          });
      });
      menu.addItem((item) => {
        item
          .setTitle(t('explorer.viewSnapshots'))
          .setIcon('history')
          .onClick(() => {
            new SnapshotListModal(this.app, this.plugin, file).open();
          });
      });
    }

    // ── Move entity (character / location) between WB and projects ──
    const isEntity = this.plugin.isCharacterFile(file) || this.plugin.isLocationFile(file);
    if (isEntity) {
      const isWB = this.plugin.isWorldBiblePath(file.path);
      const wb = this.plugin.settings.worldBiblePath;

      if (!isWB && wb) {
        // Entity is in a project → offer "Move to World Bible"
        menu.addItem((item) => {
          item
            .setTitle(t('project.moveToWorldBible'))
            .setIcon('globe')
            .onClick(async () => {
              await this.plugin.moveEntityToWorldBible(file);
              void this.render();
            });
        });
      }

      // Offer "Move to project" (one entry per project, skip current if file is in that project)
      const projects = this.plugin.getProjects();
      if (projects.length > 0) {
        menu.addSeparator();
        for (const project of projects) {
          // Skip if entity already lives under this project
          if (file.path.startsWith(project.path + '/')) continue;
          menu.addItem((item) => {
            item
              .setTitle(t('project.moveToProject', { project: project.name }))
              .setIcon('folder-input')
              .onClick(async () => {
                await this.plugin.moveEntityToProject(file, project.id);
                void this.render();
              });
          });
        }
      }
    }

    // ── Location hierarchy ──────────────────────────────────────────
    if (this.plugin.isLocationFile(file)) {
      const locationEntry = this.plugin.getLocationList().find(l => l.file.path === file.path);
      const hasParent = !!(locationEntry?.parent);
      const allLocations = this.plugin.getLocationList().filter(l => l.file.path !== file.path);

      menu.addSeparator();
      menu.addItem((item) => {
        item
          .setTitle(t('explorer.setParent'))
          .setIcon('git-branch')
          .onClick(() => {
            new LocationParentPickerModal(this.app, allLocations, (chosen) => {
              void this.plugin.setLocationParent(file, chosen.name).then(() => { void this.render(); });
            }).open();
          });
      });
      if (hasParent) {
        menu.addItem((item) => {
          item
            .setTitle(t('explorer.removeParent'))
            .setIcon('x')
            .onClick(async () => {
              await this.plugin.setLocationParent(file, '');
              void this.render();
            });
        });
      }
    }

    // ── Character group ──────────────────────────────────────────────
    if (this.plugin.isCharacterFile(file)) {
      const charList = await this.plugin.getCharacterList();
      const charEntry = charList.find(c => c.file.path === file.path);
      const hasGroup = !!(charEntry?.group);
      const existingGroups = [...new Set(charList.map(c => c.group).filter(g => !!g))];

      menu.addSeparator();
      menu.addItem((item) => {
        item
          .setTitle(t('explorer.setGroup'))
          .setIcon('users')
          .onClick(() => {
            new GroupInputModal(this.app, existingGroups, charEntry?.group ?? '', (value) => {
              void this.plugin.setCharacterGroup(file, value).then(() => { void this.render(); });
            }).open();
          });
      });
      if (hasGroup) {
        menu.addItem((item) => {
          item
            .setTitle(t('explorer.removeGroup'))
            .setIcon('x')
            .onClick(async () => {
              await this.plugin.setCharacterGroup(file, '');
              void this.render();
            });
        });
      }
    }

    menu.addItem((item) => {
      item
        .setTitle(t('explorer.delete'))
        .setIcon('trash')
        .onClick(async () => {
          await this.app.fileManager.trashFile(file);
        });
    });

    menu.showAtMouseEvent(evt);
  }

  private renderChapterList(
    list: HTMLElement,
    items: (ChapterListData & { status?: ChapterStatus; act?: string; scenes?: string[] })[],
    emptyMessage: string
  ) {
    if (items.length === 0) {
      list.createEl('p', { text: emptyMessage, cls: 'novalist-empty' });
      return;
    }

    // Collect unique acts preserving order
    const actOrder: string[] = [];
    const actSeen = new Set<string>();
    for (const item of items) {
      if (item.act && !actSeen.has(item.act)) {
        actSeen.add(item.act);
        actOrder.push(item.act);
      }
    }

    const hasActs = actOrder.length > 0;
    const unassigned = items.filter(it => !it.act);
    let globalIndex = 0;

    // Render grouped acts
    for (const actName of actOrder) {
      const actItems = items.filter(it => it.act === actName);
      const groupKey = `act:${actName}`;
      const isCollapsed = this.getGroupCollapsed(groupKey);

      const actHeader = list.createDiv('novalist-group-header novalist-act-header');
      actHeader.dataset.act = actName;
      if (isCollapsed) actHeader.addClass('is-collapsed');
      actHeader.createEl('span', { text: actName, cls: 'novalist-group-title' });

      const actContainer = list.createDiv('novalist-group-container novalist-act-container');
      if (isCollapsed) actContainer.addClass('is-collapsed');

      actHeader.addEventListener('click', () => {
        const nextCollapsed = !this.getGroupCollapsed(groupKey);
        this.setGroupCollapsed(groupKey, nextCollapsed);
        actHeader.toggleClass('is-collapsed', nextCollapsed);
        actContainer.toggleClass('is-collapsed', nextCollapsed);
      });

      // Act header context menu
      actHeader.addEventListener('contextmenu', (evt) => {
        evt.preventDefault();
        const menu = new Menu();
        menu.addItem((item) => {
          item.setTitle(t('explorer.renameAct')).setIcon('pencil').onClick(() => {
            this.promptActRename(actName);
          });
        });
        menu.addItem((item) => {
          item.setTitle(t('explorer.deleteAct')).setIcon('trash').onClick(async () => {
            await this.plugin.deleteAct(actName);
            void this.render();
          });
        });
        menu.showAtMouseEvent(evt);
      });

      // Drop on act header to assign chapters
      actHeader.addEventListener('dragover', (evt) => {
        evt.preventDefault();
        actHeader.addClass('is-drop-target');
      });
      actHeader.addEventListener('dragleave', () => {
        actHeader.removeClass('is-drop-target');
      });
      actHeader.addEventListener('drop', (evt) => {
        evt.preventDefault();
        actHeader.removeClass('is-drop-target');
        const sourcePath = evt.dataTransfer?.getData('text/plain');
        if (!sourcePath) return;
        const sourceItem = items.find(i => i.file.path === sourcePath);
        if (sourceItem && sourceItem.act !== actName) {
          void this.plugin.assignChapterToAct(sourceItem.file, actName).then(() => this.render());
        }
      });

      for (const item of actItems) {
        globalIndex++;
        this.renderChapterRow(actContainer, item, globalIndex, items);
      }
    }

    // Render unassigned chapters
    if (hasActs && unassigned.length > 0) {
      const noActHeader = list.createDiv('novalist-group-header novalist-act-header novalist-act-unassigned');
      const groupKey = 'act:__unassigned__';
      const isCollapsed = this.getGroupCollapsed(groupKey);
      if (isCollapsed) noActHeader.addClass('is-collapsed');
      noActHeader.createEl('span', { text: t('explorer.noAct'), cls: 'novalist-group-title' });
      const noActContainer = list.createDiv('novalist-group-container');
      if (isCollapsed) noActContainer.addClass('is-collapsed');

      noActHeader.addEventListener('click', () => {
        const nextCollapsed = !this.getGroupCollapsed(groupKey);
        this.setGroupCollapsed(groupKey, nextCollapsed);
        noActHeader.toggleClass('is-collapsed', nextCollapsed);
        noActContainer.toggleClass('is-collapsed', nextCollapsed);
      });

      // Drop on unassigned header to remove from act
      noActHeader.addEventListener('dragover', (evt) => {
        evt.preventDefault();
        noActHeader.addClass('is-drop-target');
      });
      noActHeader.addEventListener('dragleave', () => {
        noActHeader.removeClass('is-drop-target');
      });
      noActHeader.addEventListener('drop', (evt) => {
        evt.preventDefault();
        noActHeader.removeClass('is-drop-target');
        const sourcePath = evt.dataTransfer?.getData('text/plain');
        if (!sourcePath) return;
        const sourceItem = items.find(i => i.file.path === sourcePath);
        if (sourceItem?.act) {
          void this.plugin.removeChapterFromAct(sourceItem.file).then(() => this.render());
        }
      });

      for (const item of unassigned) {
        globalIndex++;
        this.renderChapterRow(noActContainer, item, globalIndex, items);
      }
    } else if (!hasActs) {
      // No acts at all — flat list as before
      for (const item of items) {
        globalIndex++;
        this.renderChapterRow(list, item, globalIndex, items);
      }
    }
  }

  private renderChapterRow(
    parent: HTMLElement,
    item: ChapterListData & { status?: ChapterStatus; act?: string; scenes?: string[] },
    index: number,
    allItems: (ChapterListData & { status?: ChapterStatus; act?: string; scenes?: string[] })[]
  ) {
      const row = parent.createDiv('novalist-explorer-item');
      row.setAttribute('draggable', 'true');
      row.createEl('span', { text: `${index}. ${item.name}`, cls: 'novalist-explorer-label' });

      // Status icon (right side, read-only indicator)
      const status = item.status || 'outline';
      const statusDef = CHAPTER_STATUSES.find(s => s.value === status) || CHAPTER_STATUSES[0];
      const statusIcon = row.createEl('span', {
        text: statusDef.icon,
        cls: 'novalist-chapter-status-icon',
        attr: { title: statusDef.label, 'aria-label': statusDef.label }
      });
      statusIcon.style.color = statusDef.color;

      row.addEventListener('click', () => {
        void this.openFileInExplorer(item.file);
      });

      row.addEventListener('contextmenu', (evt) => {
        void this.handleContextMenu(evt, item.file);
      });

      row.addEventListener('dragstart', (evt) => {
        this.dragChapterIndex = index;
        row.addClass('is-dragging');
        if (evt.dataTransfer) {
          evt.dataTransfer.effectAllowed = 'move';
          evt.dataTransfer.setData('text/plain', item.file.path);
        }
      });

      row.addEventListener('dragend', () => {
        this.dragChapterIndex = null;
        row.removeClass('is-dragging');
        parent.querySelectorAll('.is-drop-target').forEach((el) => el.removeClass('is-drop-target'));
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
        const sourcePath = evt.dataTransfer?.getData('text/plain');
        if (!sourcePath) return;
        const sourceItem = allItems.find(i => i.file.path === sourcePath);
        if (!sourceItem) return;

        // If dropping onto a chapter in a different act, assign to that act
        if (sourceItem.act !== item.act) {
          if (item.act) {
            void this.plugin.assignChapterToAct(sourceItem.file, item.act).then(() => this.render());
          } else {
            void this.plugin.removeChapterFromAct(sourceItem.file).then(() => this.render());
          }
          return;
        }

        // Same act: reorder within the group
        const groupItems = allItems.filter(i => (i.act || '') === (item.act || ''));
        const sourceIdx = groupItems.indexOf(sourceItem);
        const targetIdx = groupItems.indexOf(item);
        if (sourceIdx === -1 || targetIdx === -1 || sourceIdx === targetIdx) return;

        const reordered = [...groupItems];
        const [moved] = reordered.splice(sourceIdx, 1);
        reordered.splice(targetIdx, 0, moved);
        this.dragChapterIndex = null;

        void this.plugin.updateChapterOrder(reordered.map((entry) => entry.file));
        void this.render();
      });

      // Render scenes under the chapter
      if (item.scenes && item.scenes.length > 0) {
        const sceneContainer = parent.createDiv('novalist-explorer-scenes');
        for (const sceneName of item.scenes) {
          const sceneRow = sceneContainer.createDiv('novalist-explorer-scene-item');
          sceneRow.createEl('span', { text: sceneName, cls: 'novalist-explorer-scene-label' });
          sceneRow.addEventListener('click', () => {
            void this.openSceneInChapter(item.file, sceneName);
          });
          sceneRow.addEventListener('contextmenu', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            const sceneMenu = new Menu();
            sceneMenu.addItem(mi => {
              mi.setTitle(t('explorer.editScene'))
                .setIcon('pencil')
                .onClick(() => {
                  this.openEditSceneModal(item.file, sceneName);
                });
            });
            sceneMenu.showAtMouseEvent(evt);
          });
        }
      }
  }

  private openEditChapterModal(file: TFile): void {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter ?? {};
    const heading = cache?.headings?.find(h => h.level === 1)?.heading;
    const existing: ChapterEditData = {
      name: heading ?? file.basename,
      order: String(fm.order ?? ''),
      status: (fm.status as ChapterStatus) ?? 'outline',
      act: typeof fm.act === 'string' ? fm.act : '',
      date: typeof fm.date === 'string' ? fm.date : '',
    };
    this.plugin.openChapterDescriptionModal(existing, (data) => {
      void (async () => {
      // Rename file if name changed
      if (data.name !== existing.name) {
        const newPath = file.path.replace(/[^/]+\.md$/, `${data.name}.md`);
        await this.app.fileManager.renameFile(file, newPath);
        // Update heading in the file body
        const renamedFile = this.app.vault.getAbstractFileByPath(newPath);
        if (renamedFile instanceof TFile) {
          const content = await this.app.vault.read(renamedFile);
          const updated = content.replace(/^# .+$/m, `# ${data.name}`);
          if (updated !== content) await this.app.vault.modify(renamedFile, updated);
          await this.plugin.updateChapterFrontmatter(renamedFile, {
            order: data.order,
            status: data.status,
            act: data.act,
            date: data.date,
          });
        }
      } else {
        await this.plugin.updateChapterFrontmatter(file, {
          order: data.order,
          status: data.status,
          act: data.act,
          date: data.date,
        });
      }
      void this.render();
      })();
    });
  }

  private openEditSceneModal(chapterFile: TFile, sceneName: string): void {
    const sceneDate = this.plugin.getSceneDateSync(chapterFile, sceneName);
    // Use chapter date as inherited fallback display — but only pass explicit scene date
    const chapterDate = this.plugin.getChapterDateSync(chapterFile);
    const explicitDate = sceneDate !== chapterDate ? sceneDate : '';
    const modal = new SceneNameModal(this.app, (data) => {
      void (async () => {
      // Rename scene heading if name changed
      if (data.name !== sceneName) {
        const content = await this.app.vault.read(chapterFile);
        const updated = content.replace(
          new RegExp(`^## ${sceneName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
          `## ${data.name}`
        );
        if (updated !== content) await this.app.vault.modify(chapterFile, updated);
        // Move scene date to new name
        if (sceneDate) {
          await this.plugin.setSceneDate(chapterFile, sceneName, '');
          await this.plugin.setSceneDate(chapterFile, data.name, data.date || sceneDate);
        } else if (data.date) {
          await this.plugin.setSceneDate(chapterFile, data.name, data.date);
        }
      } else if (data.date !== explicitDate) {
        await this.plugin.setSceneDate(chapterFile, sceneName, data.date);
      }
      void this.render();
      })();
    }, { name: sceneName, date: explicitDate });
    modal.open();
  }

  // ─── Location Tree ────────────────────────────────────────────────────────

  private renderLocationTree(list: HTMLElement, items: LocationListData[], emptyMessage: string): void {
    if (items.length === 0) {
      list.createEl('p', { text: emptyMessage, cls: 'novalist-empty' });
      return;
    }

    // Build name → item map and children map
    const byName = new Map<string, LocationListData>();
    for (const item of items) byName.set(item.name, item);

    const childMap = new Map<string, LocationListData[]>(); // parentName → children
    const roots: LocationListData[] = [];

    for (const item of items) {
      const rawParent = item.parent ?? '';
      const parentName = rawParent.replace(/^\[\[/, '').replace(/\]\]$/, '').trim();
      if (!parentName || !byName.has(parentName)) {
        roots.push(item);
      } else {
        if (!childMap.has(parentName)) childMap.set(parentName, []);
        childMap.get(parentName)?.push(item);
      }
    }

    // Sort children within each group
    for (const children of childMap.values()) {
      children.sort((a, b) => a.name.localeCompare(b.name));
    }
    roots.sort((a, b) => a.name.localeCompare(b.name));

    // Root drop zone (only visible while dragging)
    const treeContainer = list.createDiv('novalist-tree-container');
    const rootDrop = treeContainer.createDiv('novalist-tree-root-drop');
    rootDrop.setText(t('explorer.locationRoot'));

    rootDrop.addEventListener('dragover', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      rootDrop.addClass('drag-over');
    });
    rootDrop.addEventListener('dragleave', () => rootDrop.removeClass('drag-over'));
    rootDrop.addEventListener('drop', (evt) => {
      evt.preventDefault();
      rootDrop.removeClass('drag-over');
      treeContainer.removeClass('is-dragging');
      const path = evt.dataTransfer?.getData('text/plain') ?? '';
      if (!path) return;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        void this.plugin.setLocationParent(file, '').then(() => void this.render());
      }
    });

    // Detect drag enter/leave on the whole tree to show/hide root drop zone
    treeContainer.addEventListener('dragenter', () => treeContainer.addClass('is-dragging'));
    treeContainer.addEventListener('dragleave', (evt) => {
      if (!treeContainer.contains(evt.relatedTarget as Node)) {
        treeContainer.removeClass('is-dragging');
      }
    });
    treeContainer.addEventListener('dragend', () => treeContainer.removeClass('is-dragging'));

    // Render tree nodes recursively
    const renderNode = (container: HTMLElement, item: LocationListData, depth: number) => {
      const row = container.createDiv('novalist-tree-item');
      row.dataset.path = item.file.path;
      row.dataset.depth = String(depth);
      row.style.setProperty('--tree-depth', String(depth));
      row.setAttribute('draggable', 'true');

      const children = childMap.get(item.name) ?? [];
      const hasChildren = children.length > 0;

      // Collapse toggle
      const toggleBtn = row.createEl('span', { cls: 'novalist-tree-toggle' });
      if (hasChildren) {
        const isCollapsed = this.locationTreeCollapsed.has(item.file.path);
        toggleBtn.addClass(isCollapsed ? 'is-collapsed' : 'is-expanded');
        toggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.locationTreeCollapsed.has(item.file.path)) {
            this.locationTreeCollapsed.delete(item.file.path);
          } else {
            this.locationTreeCollapsed.add(item.file.path);
          }
          void this.refreshListOnly();
        });
      }

      // World Bible badge
      if (this.plugin.isWorldBiblePath(item.file.path)) {
        row.createEl('span', { text: t('project.wbBadge'), cls: 'novalist-explorer-badge novalist-wb-badge' });
      }

      row.createEl('span', { text: item.name, cls: 'novalist-explorer-label' });

      if (item.type) {
        row.createEl('span', { text: item.type, cls: 'novalist-explorer-badge novalist-type-badge' });
      }

      if (hasChildren) {
        row.createEl('span', {
          text: String(children.length),
          cls: 'novalist-explorer-badge novalist-children-badge',
          attr: { title: t('explorer.subLocationCount', { count: children.length }) },
        });
      }

      // Open on click
      row.addEventListener('click', () => void this.openFileInExplorer(item.file));
      row.addEventListener('contextmenu', (evt) => { void this.handleContextMenu(evt, item.file); });

      // Drag-to-reparent
      row.addEventListener('dragstart', (evt) => {
        this.draggingLocationPath = item.file.path;
        row.addClass('is-dragging');
        if (evt.dataTransfer) {
          evt.dataTransfer.effectAllowed = 'move';
          evt.dataTransfer.setData('text/plain', item.file.path);
        }
      });
      row.addEventListener('dragend', () => {
        this.draggingLocationPath = null;
        row.removeClass('is-dragging');
        treeContainer.querySelectorAll('.drag-over').forEach(el => el.removeClass('drag-over'));
        treeContainer.removeClass('is-dragging');
      });
      row.addEventListener('dragover', (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        if (this.draggingLocationPath !== item.file.path) {
          row.addClass('drag-over');
        }
      });
      row.addEventListener('dragleave', () => row.removeClass('drag-over'));
      row.addEventListener('drop', (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        row.removeClass('drag-over');
        treeContainer.removeClass('is-dragging');
        const srcPath = evt.dataTransfer?.getData('text/plain') ?? '';
        if (!srcPath || srcPath === item.file.path) return;
        const srcFile = this.app.vault.getAbstractFileByPath(srcPath);
        if (srcFile instanceof TFile) {
          void this.plugin.setLocationParent(srcFile, item.name).then(() => void this.render());
        }
      });

      // Render children (if not collapsed)
      if (hasChildren && !this.locationTreeCollapsed.has(item.file.path)) {
        const childContainer = container.createDiv('novalist-tree-children');
        for (const child of children) {
          renderNode(childContainer, child, depth + 1);
        }
      }
    };

    for (const root of roots) {
      renderNode(treeContainer, root, 0);
    }
  }

  private renderCharacterGroupedList(
    list: HTMLElement,
    items: CharacterListData[],
    emptyMessage: string
  ) {
    if (items.length === 0) {
      list.createEl('p', { text: emptyMessage, cls: 'novalist-empty' });
      return;
    }

    const groups: Record<string, CharacterListData[]> = {};
    const unassignedLabel = t('explorer.unassigned');
    const isGroupMode = this.characterGroupMode === 'group';

    // Distribute items by role or by group depending on toggle state
    for (const item of items) {
      const label = isGroupMode
        ? (item.group?.trim() || unassignedLabel)
        : (item.role?.trim() || unassignedLabel);

      if (!groups[label]) groups[label] = [];
      groups[label].push(item);
    }

    const existingRoles = Object.keys(groups)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const rolesToRender = existingRoles.filter(r => r !== unassignedLabel);
    if (groups[unassignedLabel]) {
      rolesToRender.push(unassignedLabel);
    }

    // Create a flattened visual order list for range selection logic
    const visualOrder: CharacterListData[] = [];
    for (const roleLabel of rolesToRender) {
         if (groups[roleLabel]) {
             visualOrder.push(...groups[roleLabel]);
         }
    }

    for (const roleLabel of rolesToRender) {
      const groupItems = groups[roleLabel];
      if (!groupItems || groupItems.length === 0) continue;

      const groupKey = this.getGroupKey(roleLabel, unassignedLabel);
      const roleColor = this.getRoleColor(groupKey);
      const isCollapsed = this.getGroupCollapsed(groupKey);

      // Group Header
      const headerObj = list.createDiv('novalist-group-header');
      headerObj.dataset.role = groupKey;
      if (roleColor) headerObj.style.setProperty('--novalist-role-color', roleColor);
      if (isCollapsed) headerObj.addClass('is-collapsed');

      headerObj.createEl('span', { text: roleLabel, cls: 'novalist-group-title' });


      const toggleGroup = () => {
        const nextCollapsed = !this.getGroupCollapsed(groupKey);
        this.setGroupCollapsed(groupKey, nextCollapsed);
        headerObj.toggleClass('is-collapsed', nextCollapsed);
        if (groupContainer) {
          groupContainer.toggleClass('is-collapsed', nextCollapsed);
        }
      };

      headerObj.addEventListener('click', () => {
        toggleGroup();
      });

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
           if (!sourceItem) continue;
           if (isGroupMode) {
             const nextGroup = roleLabel === unassignedLabel ? '' : roleLabel;
             if (sourceItem.group !== nextGroup) void this.plugin.setCharacterGroup(sourceItem.file, nextGroup);
           } else {
             if (sourceItem.role !== roleLabel) {
               const nextRole = roleLabel === unassignedLabel ? '' : roleLabel;
               void this.plugin.updateCharacterRole(sourceItem.file, nextRole);
             }
           }
        }
      });

      const groupContainer = list.createDiv('novalist-group-container');
      if (isCollapsed) {
        groupContainer.addClass('is-collapsed');
      }
      if (roleColor) groupContainer.style.setProperty('--novalist-role-color', roleColor);
      
      for (const item of groupItems) {
        const row = groupContainer.createDiv('novalist-explorer-item');
        row.setAttribute('draggable', 'true');
        row.dataset.path = item.file.path;
        if (roleColor) row.style.setProperty('--novalist-role-color', roleColor);

        // World Bible badge (before name)
        if (this.plugin.isWorldBiblePath(item.file.path)) {
          row.createEl('span', { text: t('project.wbBadge'), cls: 'novalist-explorer-badge novalist-wb-badge' });
        }

        row.createEl('span', { text: item.name, cls: 'novalist-explorer-label' });
        
        if (item.gender) {
          const genderBadge = row.createEl('span', { 
                text: item.gender, 
                cls: 'novalist-explorer-badge novalist-gender-badge', 
                attr: { title: t('explorer.genderTooltip', { gender: item.gender }) }
            });
          const genderColor = this.getGenderColor(item.gender);
          if (genderColor) genderBadge.style.setProperty('--novalist-gender-color', genderColor);
        }

        if (this.selectedFiles.has(item.file.path)) {
            row.addClass('is-selected');
        }

        row.addEventListener('contextmenu', (evt) => {
            void this.handleContextMenu(evt, item.file);
        });

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
        
           row.addClass('is-dragging');
           if (evt.dataTransfer) {
             evt.dataTransfer.effectAllowed = 'move';
             evt.dataTransfer.setData('application/json', JSON.stringify(dragPaths));
             evt.dataTransfer.setData('text/plain', item.file.path);
           }
        });

        // Drag End
        row.addEventListener('dragend', () => {
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

  private promptActName(assignFile?: TFile): void {
    const modal = new (class extends Modal {
      private actName = '';
      constructor(app: import('obsidian').App, private onDone: (name: string) => void) { super(app); }
      onOpen() {
        this.titleEl.setText(t('modal.createAct'));
        new Setting(this.contentEl)
          .setName(t('modal.actName'))
          .addText(text => {
            text.onChange(v => { this.actName = v; });
            text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
              if (e.key === 'Enter') { e.preventDefault(); this.submit(); }
            });
          });
        new Setting(this.contentEl)
          .addButton(btn => btn.setButtonText(t('modal.create')).setCta().onClick(() => this.submit()));
      }
      submit() { if (this.actName.trim()) { this.onDone(this.actName.trim()); } this.close(); }
    })(this.app, (name: string) => {
      const existing = this.plugin.getActNames();
      if (existing.includes(name)) {
        new Notice(t('notice.actExists'));
        return;
      }
      new Notice(t('notice.actCreated', { name }));
      const target = assignFile ?? this.plugin.getChapterDescriptionsSync().find(ch => !ch.act)?.file;
      if (target) {
        void this.plugin.assignChapterToAct(target, name).then(() => this.render());
      } else {
        void this.render();
      }
    });
    modal.open();
  }

  private promptActRename(oldName: string): void {
    const modal = new (class extends Modal {
      private actName = oldName;
      constructor(app: import('obsidian').App, private onDone: (name: string) => void) { super(app); }
      onOpen() {
        this.titleEl.setText(t('explorer.renameAct'));
        new Setting(this.contentEl)
          .setName(t('modal.actName'))
          .addText(text => {
            text.setValue(this.actName);
            text.onChange(v => { this.actName = v; });
            text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
              if (e.key === 'Enter') { e.preventDefault(); this.submit(); }
            });
          });
        new Setting(this.contentEl)
          .addButton(btn => btn.setButtonText(t('modal.update')).setCta().onClick(() => this.submit()));
      }
      submit() { if (this.actName.trim()) { this.onDone(this.actName.trim()); } this.close(); }
    })(this.app, (newName: string) => {
      void this.plugin.renameAct(oldName, newName).then(() => this.render());
    });
    modal.open();
  }

  private getGroupKey(roleLabel: string, unassignedLabel: string): string {
    if (roleLabel === unassignedLabel) return unassignedLabel;
    return normalizeCharacterRole(roleLabel);
  }

  private getRoleColor(roleLabel: string): string {
    const normalized = normalizeCharacterRole(roleLabel);
    return this.plugin.settings.roleColors[normalized] || '';
  }

  private getGenderColor(genderLabel: string): string {
    const trimmed = genderLabel.trim();
    return this.plugin.settings.genderColors[trimmed] || '';
  }

  private getGroupCollapsed(roleLabel: string): boolean {
    return this.plugin.settings.explorerGroupCollapsed[roleLabel] ?? false;
  }

  private setGroupCollapsed(roleLabel: string, collapsed: boolean): void {
    if (collapsed) {
      this.plugin.settings.explorerGroupCollapsed[roleLabel] = true;
    } else {
      delete this.plugin.settings.explorerGroupCollapsed[roleLabel];
    }
    void this.plugin.saveSettings();
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
      // World Bible badge (before name)
      if (this.plugin.isWorldBiblePath(item.file.path)) {
        row.createEl('span', { text: t('project.wbBadge'), cls: 'novalist-explorer-badge novalist-wb-badge' });
      }
      row.createEl('span', { text: item.name, cls: 'novalist-explorer-label' });
      row.addEventListener('click', () => {
        void this.openFileInExplorer(item.file);
      });
      row.addEventListener('contextmenu', (evt) => {
        void this.handleContextMenu(evt, item.file);
      });
    }
  }

  private async openFileInExplorer(file: TFile): Promise<void> {
    const targetLeaf = this.app.workspace.getLeaf(false);

    if (this.plugin.isCharacterFile(file)) {
      await this.plugin.openCharacterSheet(file, targetLeaf);
      return;
    }

    if (this.plugin.isLocationFile(file)) {
      await this.plugin.openLocationSheet(file, targetLeaf);
      return;
    }

    if (this.plugin.isItemFile(file)) {
      await this.plugin.openItemSheet(file, targetLeaf);
      return;
    }

    if (this.plugin.isLoreFile(file)) {
      await this.plugin.openLoreSheet(file, targetLeaf);
      return;
    }

    const existingLeaf = this.app.workspace.getLeavesOfType('markdown')
      .find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);

    const leaf = existingLeaf ?? this.app.workspace.getLeaf(true);
    await leaf.openFile(file);
    await this.app.workspace.revealLeaf(leaf);
  }

  private async openSceneInChapter(file: TFile, sceneName: string): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType('markdown')
      .find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);

    const leaf = existingLeaf ?? this.app.workspace.getLeaf(true);
    await leaf.openFile(file);
    await this.app.workspace.revealLeaf(leaf);

    // Scroll to the scene heading
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
}

// ─── Helper Modals ────────────────────────────────────────────────────────────

/** A fuzzy picker for selecting a parent location. */
class LocationParentPickerModal extends FuzzySuggestModal<LocationListData> {
  private _items: LocationListData[];
  private _onChoose: (item: LocationListData) => void;

  constructor(
    app: App,
    locations: LocationListData[],
    onChoose: (item: LocationListData) => void,
  ) {
    super(app);
    this._items = locations;
    this._onChoose = onChoose;
    this.setPlaceholder(t('explorer.pickParentPlaceholder'));
  }

  getItems(): LocationListData[] {
    return this._items;
  }

  getItemText(item: LocationListData): string {
    return item.name;
  }

  onChooseItem(item: LocationListData): void {
    this._onChoose(item);
  }
}

/** A simple modal with a text input for entering / choosing a character group. */
class GroupInputModal extends Modal {
  private _existingGroups: string[];
  private _current: string;
  private _onSubmit: (value: string) => void;

  constructor(
    app: App,
    existingGroups: string[],
    current: string,
    onSubmit: (value: string) => void,
  ) {
    super(app);
    this._existingGroups = existingGroups;
    this._current = current;
    this._onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: t('explorer.setGroupTitle') });

    new Setting(contentEl)
      .setName(t('explorer.groupLabel'))
      .addText((text) => {
        text.setValue(this._current);
        text.inputEl.placeholder = t('explorer.groupPlaceholder');

        // Datalist for autocomplete
        const listId = 'novalist-group-datalist';
        const datalist = contentEl.createEl('datalist');
        datalist.id = listId;
        for (const g of this._existingGroups) {
          datalist.createEl('option', { value: g });
        }
        text.inputEl.setAttribute('list', listId);

        text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            this._onSubmit(text.getValue().trim());
            this.close();
          }
        });

        new Setting(contentEl).addButton((btn) =>
          btn
            .setButtonText(t('explorer.applyGroup'))
            .setCta()
            .onClick(() => {
              this._onSubmit(text.getValue().trim());
              this.close();
            })
        );
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
