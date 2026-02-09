import type NovalistPlugin from '../main';

export class NovalistToolbarManager {
  private plugin: NovalistPlugin;
  private observer: MutationObserver | null = null;

  constructor(plugin: NovalistPlugin) {
    this.plugin = plugin;
  }

  /**
   * Start watching for new tabs and inject toolbar
   */
  enable(): void {
    this.injectAll();
    this.startObserving();
  }

  /**
   * Stop watching and remove all toolbars
   */
  disable(): void {
    this.stopObserving();
    this.removeAll();
  }

  /**
   * Toggle based on setting
   */
  update(): void {
    if (this.plugin.settings.enableToolbar) {
      this.enable();
    } else {
      this.disable();
    }
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
  }

  private renderToolbar(container: HTMLElement): void {
    // Create group
    const createGroup = container.createDiv('novalist-view-toolbar-group');
    this.createButton(createGroup, 'user-plus', 'Add character', () => {
      this.plugin.openCharacterModal();
    });
    this.createButton(createGroup, 'map-pin', 'Add location', () => {
      this.plugin.openLocationModal();
    });
    this.createButton(createGroup, 'file-plus', 'Add chapter', () => {
      this.plugin.openChapterDescriptionModal();
    });

    // Views group
    const viewsGroup = container.createDiv('novalist-view-toolbar-group');
    this.createButton(viewsGroup, 'folder-tree', 'Explorer', () => {
      void this.plugin.activateExplorerView(true);
    });
    this.createButton(viewsGroup, 'panel-right', 'Sidebar', () => {
      void this.plugin.activateView();
    });
    this.createButton(viewsGroup, 'git-graph', 'Map', () => {
      void this.plugin.activateCharacterMapView();
    });

    // Tools group
    const toolsGroup = container.createDiv('novalist-view-toolbar-group');
    this.createButton(toolsGroup, 'bar-chart-2', 'Stats', () => {
      void this.plugin.activateStatisticsView();
    });
    this.createButton(toolsGroup, 'download', 'Export', () => {
      void this.plugin.activateExportView();
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
