import {
  ItemView,
  TFile,
  WorkspaceLeaf,
  MarkdownView,
  Menu
} from 'obsidian';
import type NovalistPlugin from '../main';
import { normalizeCharacterRole } from '../utils/characterUtils';
import { ChapterListData, CharacterListData, LocationListData, CHAPTER_STATUSES, ChapterStatus } from '../types';
import { t } from '../i18n';

export const NOVELIST_EXPLORER_VIEW_TYPE = 'novalist-explorer';

export class NovalistExplorerView extends ItemView {
  plugin: NovalistPlugin;
  private activeTab: 'chapters' | 'characters' | 'locations' = 'chapters';
  private dragChapterIndex: number | null = null;
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

    container.createEl('h3', { text: t('explorer.displayName'), cls: 'novalist-explorer-header' });

    const tabs = container.createDiv('novalist-explorer-tabs');
    const tabOrder: Array<{ id: 'chapters' | 'characters' | 'locations'; label: string }> = [
      { id: 'chapters', label: t('explorer.chapters') },
      { id: 'characters', label: t('explorer.characters') },
      { id: 'locations', label: t('explorer.locations') }
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
      const chapters = await this.plugin.getChapterDescriptions();
      const chapterItems = chapters.map((chapter) => ({
        name: chapter.name,
        order: chapter.order,
        status: chapter.status,
        file: chapter.file
      }));
      this.renderChapterList(list, chapterItems, t('explorer.noChapters'));
      return;
    }

    if (this.activeTab === 'characters') {
      const characters = await this.plugin.getCharacterList();
      this.renderCharacterGroupedList(list, characters, t('explorer.noCharacters'));
      return;
    }

    const locations = this.plugin.getLocationList();
    this.renderList(list, locations, t('explorer.noLocations'));
  }

  private handleContextMenu(evt: MouseEvent, file: TFile) {
    evt.preventDefault();
    const menu = new Menu();

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
    items: (ChapterListData & { status?: ChapterStatus })[],
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
        this.handleContextMenu(evt, item.file);
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

        void this.plugin.updateChapterOrder(reordered.map((entry) => entry.file));
        void this.render();
      });
    });
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
    
    // Distribute items
    for (const item of items) {
      const roleLabel = item.role?.trim() || unassignedLabel;
      
      if (!groups[roleLabel]) {
        groups[roleLabel] = [];
      }
      groups[roleLabel].push(item);
    }

    const existingRoles = Object.keys(groups)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const rolesToRender = existingRoles.filter(r => r !== unassignedLabel);
    if (groups[unassignedLabel]) {
      rolesToRender.unshift(unassignedLabel);
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
           if (sourceItem && sourceItem.role !== roleLabel) {
             const nextRole = roleLabel === unassignedLabel ? '' : roleLabel;
             void this.plugin.updateCharacterRole(sourceItem.file, nextRole);
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
            this.handleContextMenu(evt, item.file);
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
    items: LocationListData[],
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
      row.addEventListener('contextmenu', (evt) => {
        this.handleContextMenu(evt, item.file);
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

    const existingLeaf = this.app.workspace.getLeavesOfType('markdown')
      .find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);

    const leaf = existingLeaf ?? this.app.workspace.getLeaf(true);
    await leaf.openFile(file);
    await this.app.workspace.revealLeaf(leaf);
  }
}
