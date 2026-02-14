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
   * Start watching for new tabs and inject ribbon toolbar
   */
  enable(): void {
    // Remove any legacy toolbars from view-headers
    document.querySelectorAll('.novalist-view-toolbar').forEach(el => el.remove());

    this.injectAll();
    this.startObserving();
    this.startListeningForLeafChanges();
  }

  /**
   * Stop watching and remove all ribbons
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
    const leafContents = document.querySelectorAll('.workspace-leaf-content[data-type="markdown"]');
    leafContents.forEach(content => {
      this.injectRibbon(content as HTMLElement);
    });
  }

  private removeAll(): void {
    document.querySelectorAll('.novalist-ribbon').forEach(el => el.remove());
    document.querySelectorAll('.novalist-view-toolbar').forEach(el => el.remove());
  }

  private startListeningForLeafChanges(): void {
    const ref1 = this.plugin.app.workspace.on('active-leaf-change', () => {
      this.injectAll();
      this.refreshAllChapterDropdowns();
    });
    const ref2 = this.plugin.app.workspace.on('file-open', () => {
      this.refreshAllChapterDropdowns();
    });
    this.plugin.registerEvent(ref1);
    this.plugin.registerEvent(ref2);
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

  /** Re-render the chapter status dropdown in every injected ribbon. */
  private refreshAllChapterDropdowns(): void {
    document.querySelectorAll('.novalist-ribbon').forEach(ribbon => {
      this.updateChapterDropdown(ribbon as HTMLElement);
    });
  }

  private startObserving(): void {
    if (this.observer) return;

    this.observer = new MutationObserver((mutations) => {
      for (let m = 0; m < mutations.length; m++) {
        const added = mutations[m].addedNodes;
        for (let i = 0; i < added.length; i++) {
          const node = added[i];
          if (node instanceof HTMLElement) {
            if (node.classList?.contains('view-header')) {
              const leafContent = node.closest('.workspace-leaf-content');
              if (leafContent?.getAttribute('data-type') === 'markdown') {
                this.injectRibbon(leafContent as HTMLElement);
              }
            }
            if (node.classList?.contains('view-content')) {
              const leafContent = node.closest('.workspace-leaf-content');
              if (leafContent?.getAttribute('data-type') === 'markdown') {
                this.injectRibbon(leafContent as HTMLElement);
              }
            }
            if (node.matches?.('.workspace-leaf-content[data-type="markdown"]')) {
              this.injectRibbon(node);
            }
            const leafContents = node.querySelectorAll?.('.workspace-leaf-content[data-type="markdown"]') || [];
            leafContents.forEach((el: Element) => {
              this.injectRibbon(el as HTMLElement);
            });
            const headers = node.querySelectorAll?.('.view-header') || [];
            headers.forEach((header: Element) => {
              const leafContent = header.closest('.workspace-leaf-content');
              if (leafContent?.getAttribute('data-type') === 'markdown') {
                this.injectRibbon(leafContent as HTMLElement);
              }
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

  private injectRibbon(leafContent: HTMLElement): void {
    if (leafContent.querySelector('.novalist-ribbon')) return;

    const viewContent = leafContent.querySelector('.view-content');
    if (!viewContent) return;

    const ribbon = document.createElement('div');
    ribbon.addClass('novalist-ribbon');

    this.renderRibbon(ribbon);

    viewContent.insertBefore(ribbon, viewContent.firstChild);

    this.updateChapterDropdown(ribbon);
  }

  private renderRibbon(container: HTMLElement): void {
    // ── Tab bar (always visible, even when collapsed) ──
    const tabBar = container.createDiv('novalist-ribbon-tabs');

    const createTab = tabBar.createEl('button', {
      cls: 'novalist-ribbon-tab is-active',
      text: t('toolbar.groupCreate'),
      attr: { 'data-tab': 'create' }
    });

    const viewsTab = tabBar.createEl('button', {
      cls: 'novalist-ribbon-tab',
      text: t('toolbar.groupViews'),
      attr: { 'data-tab': 'views' }
    });

    // Spacer pushes toggle to the right
    tabBar.createDiv('novalist-ribbon-tabs-spacer');

    // Collapse/expand toggle
    const toggleBtn = tabBar.createEl('button', {
      cls: 'novalist-ribbon-toggle',
      attr: { 'aria-label': t('toolbar.collapseRibbon') }
    });
    toggleBtn.appendChild(this.createLucideIcon('chevron-up'));

    // ── Ribbon body (panels, hidden when collapsed) ──
    const body = container.createDiv('novalist-ribbon-body');

    // ── Create panel ──
    const createPanel = body.createDiv({
      cls: 'novalist-ribbon-panel is-active',
      attr: { 'data-tab': 'create' }
    });
    const createGroup = createPanel.createDiv('novalist-ribbon-group');
    const createItems = createGroup.createDiv('novalist-ribbon-group-items');
    this.createRibbonButton(createItems, 'user-plus', t('toolbar.character'), t('toolbar.addCharacter'), () => {
      this.plugin.openCharacterModal();
    });
    this.createRibbonButton(createItems, 'map-pin', t('toolbar.location'), t('toolbar.addLocation'), () => {
      this.plugin.openLocationModal();
    });
    this.createRibbonButton(createItems, 'file-plus', t('toolbar.chapter'), t('toolbar.addChapter'), () => {
      this.plugin.openChapterDescriptionModal();
    });
    createGroup.createEl('span', { text: t('toolbar.groupCreate'), cls: 'novalist-ribbon-group-label' });

    // Divider + Chapter status group (in Create panel)
    createPanel.createDiv('novalist-ribbon-divider');
    const statusGroup = createPanel.createDiv('novalist-ribbon-group novalist-ribbon-group-status');
    statusGroup.createDiv('novalist-chapter-status-slot');
    statusGroup.createEl('span', { text: t('toolbar.groupStatus'), cls: 'novalist-ribbon-group-label novalist-ribbon-status-label' });

    // ── Views panel ──
    const viewsPanel = body.createDiv({
      cls: 'novalist-ribbon-panel',
      attr: { 'data-tab': 'views' }
    });
    const viewsGroup = viewsPanel.createDiv('novalist-ribbon-group');
    const viewsItems = viewsGroup.createDiv('novalist-ribbon-group-items');
    this.createRibbonButton(viewsItems, 'folder-tree', t('toolbar.explorer'), t('toolbar.explorer'), () => {
      void this.plugin.activateExplorerView(true);
    });
    this.createRibbonButton(viewsItems, 'panel-right', t('toolbar.sidebar'), t('toolbar.sidebar'), () => {
      void this.plugin.activateView();
    });
    this.createRibbonButton(viewsItems, 'git-graph', t('toolbar.map'), t('toolbar.map'), () => {
      void this.plugin.activateCharacterMapView();
    });
    this.createRibbonButton(viewsItems, 'table', t('toolbar.plotBoard'), t('toolbar.plotBoard'), () => {
      void this.plugin.activatePlotBoardView();
    });
    this.createRibbonButton(viewsItems, 'download', t('toolbar.export'), t('toolbar.export'), () => {
      void this.plugin.activateExportView();
    });
    viewsGroup.createEl('span', { text: t('toolbar.groupViews'), cls: 'novalist-ribbon-group-label' });

    // ── Tab switching logic ──
    const tabs = [createTab, viewsTab];
    const panels = [createPanel, viewsPanel];

    const switchTab = (tab: HTMLElement) => {
      const targetTab = tab.getAttribute('data-tab');

      // Update tab active state
      tabs.forEach(t => t.removeClass('is-active'));
      tab.addClass('is-active');

      // Update panel visibility
      panels.forEach(p => {
        if (p.getAttribute('data-tab') === targetTab) {
          p.addClass('is-active');
        } else {
          p.removeClass('is-active');
        }
      });

      // If collapsed, expand when clicking a tab
      if (container.hasClass('is-collapsed')) {
        container.removeClass('is-collapsed');
        toggleBtn.empty();
        toggleBtn.appendChild(this.createLucideIcon('chevron-up'));
        toggleBtn.setAttribute('aria-label', t('toolbar.collapseRibbon'));
      }
    };

    createTab.addEventListener('click', () => switchTab(createTab));
    viewsTab.addEventListener('click', () => switchTab(viewsTab));

    // ── Collapse/expand logic ──
    toggleBtn.addEventListener('click', () => {
      const isCollapsed = container.hasClass('is-collapsed');
      container.toggleClass('is-collapsed', !isCollapsed);
      toggleBtn.empty();
      toggleBtn.appendChild(this.createLucideIcon(isCollapsed ? 'chevron-up' : 'chevron-down'));
      toggleBtn.setAttribute('aria-label', isCollapsed ? t('toolbar.collapseRibbon') : t('toolbar.expandRibbon'));
    });
  }

  /**
   * Determine which TFile (if any) the ribbon's parent view displays.
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
   * Show or hide the chapter-status dropdown inside a given ribbon.
   */
  private updateChapterDropdown(ribbon: HTMLElement): void {
    const slot = ribbon.querySelector('.novalist-chapter-status-slot');
    if (!slot) return;

    slot.innerHTML = '';

    const file = this.getFileForToolbar(ribbon);
    if (!file || !this.isChapterFile(file)) {
      const statusGroup = ribbon.querySelector('.novalist-ribbon-group-status');
      if (statusGroup) (statusGroup as HTMLElement).addClass('is-hidden');
      // Also hide the divider before status
      const dividers = ribbon.querySelectorAll('.novalist-ribbon-panel.is-active .novalist-ribbon-divider');
      dividers.forEach(d => (d as HTMLElement).addClass('is-hidden'));
      return;
    }

    // Show the status group and divider
    const statusGroup = ribbon.querySelector('.novalist-ribbon-group-status');
    if (statusGroup) (statusGroup as HTMLElement).removeClass('is-hidden');
    const dividers = ribbon.querySelectorAll('.novalist-ribbon-panel[data-tab="create"] .novalist-ribbon-divider');
    dividers.forEach(d => (d as HTMLElement).removeClass('is-hidden'));

    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const currentStatus: ChapterStatus =
      (cache?.frontmatter?.status as ChapterStatus) || 'outline';
    const currentDef = CHAPTER_STATUSES.find(s => s.value === currentStatus) || CHAPTER_STATUSES[0];

    const wrapper = (slot as HTMLElement).createDiv('novalist-chapter-status-dropdown');

    const btn = wrapper.createEl('button', {
      cls: 'novalist-chapter-status-btn',
      attr: { 'aria-label': t('toolbar.chapterStatus', { label: currentDef.label }) }
    });
    btn.createEl('span', { text: currentDef.icon, cls: 'novalist-chapter-status-btn-icon' });
    btn.setCssProps({ '--status-color': currentDef.color });
    btn.createEl('span', { text: currentDef.label, cls: 'novalist-chapter-status-btn-label' });

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

    const closeHandler = (e: MouseEvent) => {
      if (!wrapper.contains(e.target as Node)) {
        menu.addClass('is-hidden');
        document.removeEventListener('click', closeHandler);
      }
    };
    btn.addEventListener('click', () => {
      setTimeout(() => document.addEventListener('click', closeHandler), 0);
    });
  }

  private createRibbonButton(
    container: HTMLElement,
    icon: string,
    label: string,
    tooltip: string,
    callback: () => void
  ): void {
    const wrapper = container.createDiv({
      cls: 'novalist-ribbon-btn',
      attr: { 'aria-label': tooltip }
    });

    const iconEl = wrapper.createDiv('novalist-ribbon-btn-icon');
    iconEl.appendChild(this.createLucideIcon(icon));

    wrapper.createEl('span', { text: label, cls: 'novalist-ribbon-btn-label' });

    wrapper.addEventListener('click', callback);
  }

  private createLucideIcon(name: string): SVGSVGElement {
    const icons: Record<string, string> = {
      'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/>',
      'map-pin': '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
      'file-plus': '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>',
      'folder-tree': '<path d="M13 10h7a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-1-1V2a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h3"/><path d="M13 10h-2.5a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1H13"/><path d="M13 14h-2a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h3"/>',
      'panel-right': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="15" y1="3" x2="15" y2="21"/>',
      'git-graph': '<circle cx="5" cy="6" r="3"/><path d="M5 9v6"/><circle cx="5" cy="18" r="3"/><path d="M12 3v18"/><circle cx="19" cy="6" r="3"/><path d="M16 15.7A9 9 0 0 0 19 9"/>',
      'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
      'table': '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
      'chevron-up': '<polyline points="18 15 12 9 6 15"/>',
      'chevron-down': '<polyline points="6 9 12 15 18 9"/>'
    };

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
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
