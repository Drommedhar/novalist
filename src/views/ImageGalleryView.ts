import { ItemView, WorkspaceLeaf, TFile, setIcon } from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';

export const IMAGE_GALLERY_VIEW_TYPE = 'novalist-image-gallery';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];

export class ImageGalleryView extends ItemView {
  plugin: NovalistPlugin;
  private filterQuery: string = '';
  private viewMode: 'grid' | 'list' = 'grid';
  private images: TFile[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: NovalistPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return IMAGE_GALLERY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t('imageGallery.displayName');
  }

  getIcon(): string {
    return 'image';
  }

  onOpen(): Promise<void> {
    this.containerEl.empty();
    this.loadImages();
    this.render();

    this.registerEvent(this.app.vault.on('create', () => { this.loadImages(); this.render(); }));
    this.registerEvent(this.app.vault.on('delete', () => { this.loadImages(); this.render(); }));
    this.registerEvent(this.app.vault.on('rename', () => { this.loadImages(); this.render(); }));
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.containerEl.empty();
    return Promise.resolve();
  }

  private loadImages(): void {
    const projectPath = this.plugin.settings.projectPath;
    const imageFolder = `${projectPath}/${this.plugin.settings.imageFolder}`;

    this.images = this.app.vault.getFiles().filter(f =>
      f.path.startsWith(imageFolder) &&
      IMAGE_EXTENSIONS.includes(f.extension.toLowerCase())
    ).sort((a, b) => a.basename.localeCompare(b.basename));
  }

  private getFilteredImages(): TFile[] {
    if (!this.filterQuery) return this.images;
    const q = this.filterQuery.toLowerCase();
    return this.images.filter(f =>
      f.basename.toLowerCase().includes(q) ||
      f.path.toLowerCase().includes(q)
    );
  }

  private render(): void {
    const container = this.containerEl;
    container.empty();
    container.addClass('novalist-image-gallery');

    // Toolbar
    const toolbar = container.createDiv('novalist-image-gallery-toolbar');

    // Search
    const searchWrap = toolbar.createDiv('novalist-image-gallery-search');
    const searchIcon = searchWrap.createSpan('novalist-image-gallery-search-icon');
    setIcon(searchIcon, 'search');
    const searchInput = searchWrap.createEl('input', {
      type: 'text',
      placeholder: t('imageGallery.search'),
      cls: 'novalist-image-gallery-search-input',
    });
    searchInput.value = this.filterQuery;
    searchInput.addEventListener('input', () => {
      this.filterQuery = searchInput.value;
      this.renderContent(content);
    });

    // View mode toggle
    const modeToggle = toolbar.createDiv('novalist-image-gallery-mode-toggle');
    const gridBtn = modeToggle.createEl('button', { cls: 'novalist-image-gallery-mode-btn' });
    setIcon(gridBtn, 'layout-grid');
    gridBtn.ariaLabel = t('imageGallery.gridView');
    if (this.viewMode === 'grid') gridBtn.addClass('is-active');
    gridBtn.addEventListener('click', () => {
      this.viewMode = 'grid';
      this.render();
    });

    const listBtn = modeToggle.createEl('button', { cls: 'novalist-image-gallery-mode-btn' });
    setIcon(listBtn, 'list');
    listBtn.ariaLabel = t('imageGallery.listView');
    if (this.viewMode === 'list') listBtn.addClass('is-active');
    listBtn.addEventListener('click', () => {
      this.viewMode = 'list';
      this.render();
    });

    // Count
    const filtered = this.getFilteredImages();
    toolbar.createSpan({
      text: `${filtered.length} / ${this.images.length}`,
      cls: 'novalist-image-gallery-count',
    });

    // Content
    const content = container.createDiv('novalist-image-gallery-content');
    this.renderContent(content);
  }

  private renderContent(container: HTMLElement): void {
    container.empty();
    const filtered = this.getFilteredImages();

    if (filtered.length === 0) {
      const empty = container.createDiv('novalist-image-gallery-empty');
      empty.createEl('p', { text: this.filterQuery ? t('imageGallery.noResults') : t('imageGallery.noImages') });
      return;
    }

    if (this.viewMode === 'grid') {
      this.renderGrid(container, filtered);
    } else {
      this.renderList(container, filtered);
    }
  }

  private renderGrid(container: HTMLElement, images: TFile[]): void {
    const grid = container.createDiv('novalist-image-gallery-grid');

    for (const file of images) {
      const card = grid.createDiv('novalist-image-gallery-card');

      const thumbWrap = card.createDiv('novalist-image-gallery-card-thumb');
      const src = this.app.vault.getResourcePath(file);
      thumbWrap.createEl('img', {
        attr: { src, alt: file.basename, loading: 'lazy' },
      });

      const info = card.createDiv('novalist-image-gallery-card-info');
      info.createEl('span', { text: file.basename, cls: 'novalist-image-gallery-card-name' });

      const actions = card.createDiv('novalist-image-gallery-card-actions');

      const copyBtn = actions.createEl('button', { cls: 'novalist-image-gallery-action-btn' });
      setIcon(copyBtn, 'copy');
      copyBtn.ariaLabel = t('imageGallery.copyLink');
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void window.navigator.clipboard.writeText(`![[${file.path}]]`);
      });

      const openBtn = actions.createEl('button', { cls: 'novalist-image-gallery-action-btn' });
      setIcon(openBtn, 'external-link');
      openBtn.ariaLabel = t('imageGallery.openFile');
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.app.workspace.openLinkText(file.path, '', true);
      });

      // Click card to open
      card.addEventListener('click', () => {
        void this.app.workspace.openLinkText(file.path, '', true);
      });
    }
  }

  private renderList(container: HTMLElement, images: TFile[]): void {
    const list = container.createDiv('novalist-image-gallery-list');

    for (const file of images) {
      const row = list.createDiv('novalist-image-gallery-list-row');

      const thumbWrap = row.createDiv('novalist-image-gallery-list-thumb');
      const src = this.app.vault.getResourcePath(file);
      thumbWrap.createEl('img', {
        attr: { src, alt: file.basename, loading: 'lazy' },
      });

      const info = row.createDiv('novalist-image-gallery-list-info');
      info.createEl('span', { text: file.basename, cls: 'novalist-image-gallery-list-name' });
      info.createEl('small', { text: file.path, cls: 'novalist-image-gallery-list-path' });

      const actions = row.createDiv('novalist-image-gallery-list-actions');

      const copyBtn = actions.createEl('button', { cls: 'novalist-image-gallery-action-btn' });
      setIcon(copyBtn, 'copy');
      copyBtn.ariaLabel = t('imageGallery.copyLink');
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void window.navigator.clipboard.writeText(`![[${file.path}]]`);
      });

      const openBtn = actions.createEl('button', { cls: 'novalist-image-gallery-action-btn' });
      setIcon(openBtn, 'external-link');
      openBtn.ariaLabel = t('imageGallery.openFile');
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.app.workspace.openLinkText(file.path, '', true);
      });

      row.addEventListener('click', () => {
        void this.app.workspace.openLinkText(file.path, '', true);
      });
    }
  }
}
