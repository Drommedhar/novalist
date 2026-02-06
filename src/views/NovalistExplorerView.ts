import {
  ItemView,
  TFile,
  WorkspaceLeaf,
  MarkdownView,
  Menu
} from 'obsidian';
import type NovalistPlugin from '../main';
import { CHARACTER_ROLE_LABELS } from '../utils/characterUtils';
import { ChapterListData, CharacterListData, LocationListData } from '../types';

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
    return 'Novalist explorer';
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
      const chapters = this.plugin.getChapterList();
      this.renderChapterList(list, chapters, 'No chapters found.');
      return;
    }

    if (this.activeTab === 'characters') {
      const characters = await this.plugin.getCharacterList();
      this.renderCharacterGroupedList(list, characters, 'No characters found.');
      return;
    }

    const locations = this.plugin.getLocationList();
    this.renderList(list, locations, 'No locations found.');
  }

  private handleContextMenu(evt: MouseEvent, file: TFile) {
    evt.preventDefault();
    const menu = new Menu();

    menu.addItem((item) => {
      item
        .setTitle('Delete')
        .setIcon('trash')
        .onClick(async () => {
          await this.app.fileManager.trashFile(file);
        });
    });

    menu.showAtMouseEvent(evt);
  }

  private renderChapterList(
    list: HTMLElement,
    items: ChapterListData[],
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

        void this.plugin.updateChapterOrder(reordered.map((entry) => entry.descFile));
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
    const visualOrder: CharacterListData[] = [];
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
                 void this.plugin.updateCharacterRole(sourceItem.file, roleLabel);
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
    const existingLeaf = this.app.workspace.getLeavesOfType('markdown')
      .find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);

    const leaf = existingLeaf ?? this.app.workspace.getLeaf(true);
    await leaf.openFile(file);
    await this.app.workspace.revealLeaf(leaf);
  }
}
