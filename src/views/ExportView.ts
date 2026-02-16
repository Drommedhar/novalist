import { ItemView, WorkspaceLeaf, ButtonComponent, TextComponent, Notice } from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';
import { 
  exportToEPUB, 
  exportToDOCX, 
  exportToPDF,
  exportToMarkdown,
  downloadBlob 
} from '../utils/exportUtils';

export const EXPORT_VIEW_TYPE = 'novalist-export';

export class ExportView extends ItemView {
  plugin: NovalistPlugin;
  private selectedChapters: Set<string> = new Set();
  private title: string = '';
  private author: string = '';
  private includeTitlePage: boolean = true;
  private smfPreset: boolean = false;
  private format: 'epub' | 'pdf' | 'docx' | 'md' = 'epub';

  constructor(leaf: WorkspaceLeaf, plugin: NovalistPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return EXPORT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t('export.displayName');
  }

  getIcon(): string {
    return 'file-output';
  }

  async onOpen(): Promise<void> {
    this.containerEl.empty();
    
    // Set default title from project name
    const projectPath = this.plugin.settings.projectPath;
    this.title = projectPath.split('/').pop() || 'My Novel';
    
    await this.render();
  }

  async render(): Promise<void> {
    const container = this.containerEl;
    container.empty();
    container.addClass('novalist-export');

    // Header
    container.createEl('h3', { text: t('export.header'), cls: 'novalist-export-header' });

    // Get all chapters
    const chapters = await this.plugin.getChapterDescriptions();
    
    if (chapters.length === 0) {
      container.createEl('p', { text: t('export.noChapters'), cls: 'novalist-empty' });
      return;
    }

    // Select all by default
    if (this.selectedChapters.size === 0) {
      chapters.forEach(ch => this.selectedChapters.add(ch.file.path));
    }

    // Options Section
    const optionsSection = container.createDiv('novalist-export-section');
    optionsSection.createEl('h4', { text: t('export.options'), cls: 'novalist-export-section-title' });

    // Title
    const titleRow = optionsSection.createDiv('novalist-export-row');
    titleRow.createEl('label', { text: t('export.title') });
    new TextComponent(titleRow)
      .setPlaceholder(t('export.titlePlaceholder'))
      .setValue(this.title)
      .onChange(value => { this.title = value; });

    // Author
    const authorRow = optionsSection.createDiv('novalist-export-row');
    authorRow.createEl('label', { text: t('export.author') });
    new TextComponent(authorRow)
      .setPlaceholder(t('export.authorPlaceholder'))
      .setValue(this.author)
      .onChange(value => { this.author = value; });

    // Format
    const formatRow = optionsSection.createDiv('novalist-export-row');
    formatRow.createEl('label', { text: t('export.format') });
    const formatSelect = formatRow.createEl('select', { cls: 'novalist-export-select' });
    formatSelect.createEl('option', { value: 'epub', text: t('export.formatEpub') });
    formatSelect.createEl('option', { value: 'docx', text: t('export.formatDocx') });
    formatSelect.createEl('option', { value: 'pdf', text: t('export.formatPdf') });
    formatSelect.createEl('option', { value: 'md', text: t('export.formatMarkdown') });
    formatSelect.value = this.format;
    formatSelect.addEventListener('change', () => {
      this.format = formatSelect.value as typeof this.format;
      void this.render();
    });

    // SMF preset toggle (only for DOCX and PDF)
    if (this.format === 'docx' || this.format === 'pdf') {
      const smfRow = optionsSection.createDiv('novalist-export-row');
      smfRow.createEl('label', { text: t('export.smfPreset') });
      const smfToggleLabel = smfRow.createEl('label', { cls: 'novalist-export-toggle' });
      const smfToggleInput = smfToggleLabel.createEl('input', { 
        type: 'checkbox',
        attr: { checked: this.smfPreset ? 'checked' : undefined }
      });
      smfToggleInput.addEventListener('change', () => {
        this.smfPreset = smfToggleInput.checked;
      });
      smfToggleLabel.createEl('span', { cls: 'novalist-export-toggle-slider' });

      const smfDesc = optionsSection.createDiv('novalist-export-smf-desc');
      smfDesc.createEl('p', { text: t('export.smfPresetDesc') });
    }

    // Include title page
    const titlePageRow = optionsSection.createDiv('novalist-export-row');
    titlePageRow.createEl('label', { text: t('export.includeTitlePage') });
    const toggleLabel = titlePageRow.createEl('label', { cls: 'novalist-export-toggle' });
    const toggleInput = toggleLabel.createEl('input', { 
      type: 'checkbox',
      attr: { checked: this.includeTitlePage ? 'checked' : undefined }
    });
    toggleInput.addEventListener('change', () => {
      this.includeTitlePage = toggleInput.checked;
    });
    toggleLabel.createEl('span', { cls: 'novalist-export-toggle-slider' });

    // Chapters Section
    const chaptersSection = container.createDiv('novalist-export-section');
    const chaptersHeader = chaptersSection.createDiv('novalist-export-section-header');
    chaptersHeader.createEl('h4', { text: t('export.selectChapters'), cls: 'novalist-export-section-title' });
    
    // Select all/none buttons
    const selectButtons = chaptersHeader.createDiv('novalist-export-select-buttons');
    new ButtonComponent(selectButtons)
      .setButtonText(t('export.selectAll'))
      .onClick(() => {
        chapters.forEach(ch => this.selectedChapters.add(ch.file.path));
        void this.render();
      });
    new ButtonComponent(selectButtons)
      .setButtonText(t('export.selectNone'))
      .onClick(() => {
        this.selectedChapters.clear();
        void this.render();
      });

    // Chapter list
    const chapterList = chaptersSection.createDiv('novalist-export-chapter-list');
    
    for (const chapter of chapters) {
      const row = chapterList.createDiv('novalist-export-chapter-row');
      
      const checkbox = row.createEl('input', { 
        type: 'checkbox',
        attr: { 
          id: `chapter-${chapter.file.path}`,
          checked: this.selectedChapters.has(chapter.file.path) ? 'checked' : undefined
        }
      });
      
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selectedChapters.add(chapter.file.path);
        } else {
          this.selectedChapters.delete(chapter.file.path);
        }
      });
      
      row.createEl('label', { 
        text: `${chapter.order}. ${chapter.name}`,
        attr: { for: `chapter-${chapter.file.path}` }
      });
    }

    // Export Button
    const exportSection = container.createDiv('novalist-export-section');
    const exportButton = new ButtonComponent(exportSection)
      .setButtonText(t('export.exportButton', { format: this.format.toUpperCase() }))
      .setCta()
      .onClick(() => void this.handleExport());
    exportButton.buttonEl.addClass('novalist-export-button');

    // Info
    const infoSection = container.createDiv('novalist-export-info');
    infoSection.createEl('p', { 
      text: t('export.selectedCount', { count: this.selectedChapters.size }),
      cls: 'novalist-export-selection-count'
    });
  }

  private async handleExport(): Promise<void> {
    if (this.selectedChapters.size === 0) {
      return;
    }

    const options = {
      format: this.format === 'md' ? 'epub' as const : this.format,
      includeTitlePage: this.includeTitlePage,
      includeChapters: Array.from(this.selectedChapters),
      title: this.title || 'Untitled',
      author: this.author,
      smfPreset: this.smfPreset && (this.format === 'docx' || this.format === 'pdf')
    };

    try {
      let blob: Blob;
      let filename: string;

      switch (this.format) {
        case 'epub':
          blob = await exportToEPUB(this.plugin, options);
          filename = `${this.sanitizeFilename(this.title)}.epub`;
          break;
        case 'docx':
          blob = await exportToDOCX(this.plugin, options);
          filename = `${this.sanitizeFilename(this.title)}.docx`;
          break;
        case 'pdf':
          blob = await exportToPDF(this.plugin, options);
          filename = `${this.sanitizeFilename(this.title)}.pdf`;
          break;
        case 'md': {
          const mdContent = await exportToMarkdown(this.plugin, options);
          blob = new Blob([mdContent], { type: 'text/markdown' });
          filename = `${this.sanitizeFilename(this.title)}.md`;
          break;
        }
        default:
          throw new Error('Unknown format');
      }

      downloadBlob(blob, filename);
    } catch (error) {
      new Notice(`Export failed: ${String(error)}`);
    }
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9\-_\s]/g, '').replace(/\s+/g, '_') || 'export';
  }
}
