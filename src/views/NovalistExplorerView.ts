import {
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
        act: chapter.act,
        file: chapter.file,
        scenes: chapter.scenes
      }));
      this.renderChapterList(list, chapterItems, t('explorer.noChapters'));
    } else if (this.activeTab === 'characters') {
      const characters = await this.plugin.getCharacterList();
      this.renderCharacterGroupedList(list, characters, t('explorer.noCharacters'));
    } else {
      const locations = this.plugin.getLocationList();
      this.renderList(list, locations, t('explorer.noLocations'));
    }

    this.renderProjectSwitcher(container);
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

  private handleContextMenu(evt: MouseEvent, file: TFile) {
    evt.preventDefault();
    const menu = new Menu();

    if (this.plugin.isChapterFile(file)) {
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
        this.handleContextMenu(evt, item.file);
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
        }
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
    items: LocationListData[],
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
