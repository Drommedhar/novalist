import { MarkdownView, TFile } from 'obsidian';
import type NovalistPlugin from '../main';
import { CHAPTER_STATUSES, type ChapterStatus } from '../types';
import { t } from '../i18n';

export class NovalistToolbarManager {
  private plugin: NovalistPlugin;
  private observer: MutationObserver | null = null;
  private eventRefs: Array<{ unload: () => void }> = [];

  constructor(plugin: NovalistPlugin) {
    this.plugin = plugin;
  }

  /**
   * Start watching for new tabs and inject toolbar
   */
  enable(): void {
    this.injectAll();
    this.startObserving();
    this.startListeningForLeafChanges();
  }

  /**
   * Stop watching and remove all toolbars
   */
  disable(): void {
    this.stopObserving();
    this.stopListeningForLeafChanges();
    this.removeAll();
  }

  /**
   * Enable toolbars and listeners.
   */
  update(): void {
    this.enable();
  }

  private injectAll(): void {
    const viewHeaders = document.querySelectorAll('.view-header');
    viewHeaders.forEach(header => {
      this.injectToolbar(header as HTMLElement);
    });
  }

  private removeAll(): void {
    document.querySelectorAll('.novalist-view-toolbar').forEach(el => el.remove());
  }

  private startListeningForLeafChanges(): void {
    // Update chapter status dropdowns whenever the active leaf or file changes
    const ref1 = this.plugin.app.workspace.on('active-leaf-change', () => {
      this.refreshAllChapterDropdowns();
    });
    const ref2 = this.plugin.app.workspace.on('file-open', () => {
      this.refreshAllChapterDropdowns();
    });
    this.plugin.registerEvent(ref1);
    this.plugin.registerEvent(ref2);
    // Keep refs so we can conceptually track them (Obsidian handles cleanup via registerEvent)
    this.eventRefs.push(
      { unload: () => this.plugin.app.workspace.offref(ref1) },
      { unload: () => this.plugin.app.workspace.offref(ref2) }
    );
  }

  private stopListeningForLeafChanges(): void {
    for (const ref of this.eventRefs) {
      ref.unload();
    }
    this.eventRefs = [];
  }

  /** Re-render the chapter status dropdown in every injected toolbar. */
  private refreshAllChapterDropdowns(): void {
    document.querySelectorAll('.novalist-view-toolbar').forEach(toolbar => {
      this.updateChapterDropdown(toolbar as HTMLElement);
    });
  }

  private startObserving(): void {
    if (this.observer) return;

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            // Check if added node is a view header
            if (node.classList?.contains('view-header')) {
              this.injectToolbar(node);
            }
            // Check for view headers inside added node
            const headers = node.querySelectorAll?.('.view-header') || [];
            headers.forEach((header: Element) => {
              this.injectToolbar(header as HTMLElement);
            });
          }
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  private stopObserving(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  private injectToolbar(header: HTMLElement): void {
    // Check if already has toolbar
    if (header.querySelector('.novalist-view-toolbar')) return;

    const toolbar = document.createElement('div');
    toolbar.addClass('novalist-view-toolbar');

    // Create buttons
    this.renderToolbar(toolbar);

    // Insert at the start of header, positioned absolutely
    header.prepend(toolbar);

    // Initial update for chapter dropdown
    this.updateChapterDropdown(toolbar);
  }

  private renderToolbar(container: HTMLElement): void {
    // Create group
    const createGroup = container.createDiv('novalist-view-toolbar-group');
    this.createButton(createGroup, 'user-plus', t('toolbar.addCharacter'), () => {
      this.plugin.openCharacterModal();
    });
    this.createButton(createGroup, 'map-pin', t('toolbar.addLocation'), () => {
      this.plugin.openLocationModal();
    });
    this.createButton(createGroup, 'file-plus', t('toolbar.addChapter'), () => {
      this.plugin.openChapterDescriptionModal();
    });

    // Views group
    const viewsGroup = container.createDiv('novalist-view-toolbar-group');
    this.createButton(viewsGroup, 'folder-tree', t('toolbar.explorer'), () => {
      void this.plugin.activateExplorerView(true);
    });
    this.createButton(viewsGroup, 'panel-right', t('toolbar.sidebar'), () => {
      void this.plugin.activateView();
    });
    this.createButton(viewsGroup, 'git-graph', t('toolbar.map'), () => {
      void this.plugin.activateCharacterMapView();
    });
    this.createButton(viewsGroup, 'table', t('toolbar.plotBoard'), () => {
      void this.plugin.activatePlotBoardView();
    });
    this.createButton(viewsGroup, 'download', t('toolbar.export'), () => {
      void this.plugin.activateExportView();
    });

    // Chapter status placeholder — filled dynamically by updateChapterDropdown
    container.createDiv('novalist-chapter-status-slot');
  }

  /**
   * Determine which TFile (if any) the toolbar's parent view-header displays.
   * Walk the DOM to the workspace-leaf, then match it against Obsidian leaves.
   */
  private getFileForToolbar(toolbar: HTMLElement): TFile | null {
    const leafEl = toolbar.closest('.workspace-leaf');
    if (!leafEl) return null;

    let found: TFile | null = null;
    this.plugin.app.workspace.iterateAllLeaves(leaf => {
      if (found) return;
      if ((leaf as unknown as { containerEl: HTMLElement }).containerEl === leafEl) {
        const view = leaf.view;
        if (view instanceof MarkdownView && view.file) {
          found = view.file;
        }
      }
    });
    return found;
  }

  /** Check whether a file lives inside the chapter folder. */
  private isChapterFile(file: TFile): boolean {
    const root = this.plugin.settings.projectPath;
    const folder = `${root}/${this.plugin.settings.chapterFolder}/`;
    return file.path.startsWith(folder) && file.extension === 'md';
  }

  /**
   * Show or hide the chapter-status dropdown inside a given toolbar.
   * Called once on injection and again on every leaf / file change.
   */
  private updateChapterDropdown(toolbar: HTMLElement): void {
    const slot = toolbar.querySelector('.novalist-chapter-status-slot');
    if (!slot) return;

    // Clear previous contents
    slot.innerHTML = '';

    const file = this.getFileForToolbar(toolbar);
    if (!file || !this.isChapterFile(file)) return;

    // Read current status from frontmatter cache
    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const currentStatus: ChapterStatus =
      (cache?.frontmatter?.status as ChapterStatus) || 'outline';
    const currentDef = CHAPTER_STATUSES.find(s => s.value === currentStatus) || CHAPTER_STATUSES[0];

    const wrapper = (slot as HTMLElement).createDiv('novalist-chapter-status-dropdown');

    // Current value button
    const btn = wrapper.createEl('button', {
      cls: 'novalist-chapter-status-btn',
      attr: { 'aria-label': t('toolbar.chapterStatus', { label: currentDef.label }) }
    });
    btn.createEl('span', { text: currentDef.icon, cls: 'novalist-chapter-status-btn-icon' });
    btn.setCssProps({ '--status-color': currentDef.color });
    btn.createEl('span', { text: currentDef.label, cls: 'novalist-chapter-status-btn-label' });

    // Dropdown menu (hidden by default via CSS, toggled via class)
    const menu = wrapper.createDiv('novalist-chapter-status-menu is-hidden');

    for (const statusDef of CHAPTER_STATUSES) {
      const option = menu.createDiv({
        cls: `novalist-chapter-status-option${statusDef.value === currentStatus ? ' is-active' : ''}`
      });
      option.createEl('span', { text: statusDef.icon });
      option.createEl('span', { text: statusDef.label });
      option.setCssProps({ '--status-color': statusDef.color });

      option.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.addClass('is-hidden');
        void this.plugin.updateChapterStatus(file, statusDef.value).then(() => {
          this.refreshAllChapterDropdowns();
        });
      });
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.toggleClass('is-hidden', !menu.hasClass('is-hidden'));
    });

    // Close menu when clicking outside
    const closeHandler = (e: MouseEvent) => {
      if (!wrapper.contains(e.target as Node)) {
        menu.addClass('is-hidden');
        document.removeEventListener('click', closeHandler);
      }
    };
    btn.addEventListener('click', () => {
      // Defer so this click doesn't immediately close
      setTimeout(() => document.addEventListener('click', closeHandler), 0);
    });
  }

  private createButton(
    container: HTMLElement,
    icon: string,
    tooltip: string,
    callback: () => void
  ): void {
    const btn = container.createEl('button', {
      cls: 'novalist-view-toolbar-btn',
      attr: { 'aria-label': tooltip }
    });

    btn.appendChild(this.createLucideIcon(icon));

    btn.addEventListener('click', callback);
  }

  private createLucideIcon(name: string): SVGSVGElement {
    const icons: Record<string, string> = {
      'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/>',
      'map-pin': '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
      'file-plus': '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>',
      'folder-tree': '<path d="M13 10h7a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-1-1V2a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h3"/><path d="M13 10h-2.5a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1H13"/><path d="M13 14h-2a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h3"/>',
      'panel-right': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="15" y1="3" x2="15" y2="21"/>',
      'git-graph': '<circle cx="5" cy="6" r="3"/><path d="M5 9v6"/><circle cx="5" cy="18" r="3"/><path d="M12 3v18"/><circle cx="19" cy="6" r="3"/><path d="M16 15.7A9 9 0 0 0 19 9"/>',
      'bar-chart-2': '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
      'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
      'table': '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
      'clock': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
      'shield-check': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
      'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'
    };

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML = icons[name] || '';
    return svg;
  }
}
