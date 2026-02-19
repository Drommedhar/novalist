import {
  TextFileView,
  WorkspaceLeaf,
  TFile,
  Setting,
  ButtonComponent,
  Notice,
  SuggestModal,
  App
} from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';
import { ItemSheetData, CharacterImage, CustomPropertyDefinition } from '../types';
import { parseItemSheet, serializeItemSheet } from '../utils/itemSheetUtils';

export const ITEM_SHEET_VIEW_TYPE = 'item-sheet';

class ImageSuggesterModal extends SuggestModal<TFile> {
  plugin: NovalistPlugin;
  onSelect: (file: TFile) => void;

  constructor(app: App, plugin: NovalistPlugin, onSelect: (file: TFile) => void) {
    super(app);
    this.plugin = plugin;
    this.onSelect = onSelect;
  }

  getSuggestions(query: string): TFile[] {
    const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];
    const lowerQuery = query.toLowerCase();

    return this.app.vault.getFiles().filter(file =>
      IMAGE_EXTENSIONS.includes(file.extension.toLowerCase()) &&
      file.path.toLowerCase().includes(lowerQuery)
    ).slice(0, 20);
  }

  renderSuggestion(file: TFile, el: HTMLElement) {
    el.createEl('div', { text: file.basename });
    el.createEl('small', { text: file.path });
  }

  onChooseSuggestion(file: TFile, _evt: MouseEvent | KeyboardEvent) {
    this.onSelect(file);
  }
}

export class ItemSheetView extends TextFileView {
  plugin: NovalistPlugin;
  data: ItemSheetData;
  originalData: string = '';
  private knownSections: Set<string> = new Set();

  constructor(leaf: WorkspaceLeaf, plugin: NovalistPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.data = {
      name: '',
      type: '',
      description: '',
      origin: '',
      images: [],
      customProperties: {},
      sections: []
    };
  }

  getViewType(): string {
    return ITEM_SHEET_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file ? this.file.basename : t('itemSheet.fallbackTitle');
  }

  protected async onOpen(): Promise<void> {
    // Setup
  }

  protected async onClose(): Promise<void> {
    // Cleanup
  }

  getViewData(): string {
    return serializeItemSheet(this.data);
  }

  setViewData(data: string, _clear: boolean): void {
    this.originalData = data;
    this.data = parseItemSheet(data);
    this.mergeFromTemplate();
    this.loadKnownSections();
    this.render();
  }

  private mergeFromTemplate(): void {
    const template = this.plugin.getItemTemplate(this.data.templateId);
    for (const def of template.customPropertyDefs) {
      if (!(def.key in this.data.customProperties)) {
        this.data.customProperties[def.key] = def.defaultValue;
      }
    }
    for (const section of template.sections) {
      if (!this.data.sections.some(s => s.title === section.title)) {
        this.data.sections.push({ title: section.title, content: section.defaultContent });
      }
    }
    if (!this.data.templateId) {
      this.data.templateId = template.id;
    }
  }

  private loadKnownSections(): void {
    if (this.data.sections) {
      this.data.sections.forEach(s => this.knownSections.add(s.title));
    }
  }

  render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass('character-sheet-view');
    container.addClass('item-sheet-view');

    const wrapper = container.createDiv('character-sheet-container');

    // Header
    const header = wrapper.createDiv('character-sheet-header');
    header.createEl('h2', { text: this.data.name || t('itemSheet.unnamedItem'), cls: 'character-sheet-title' });

    const headerActions = header.createDiv('character-sheet-header-actions');
    new ButtonComponent(headerActions)
      .setButtonText(t('itemSheet.save'))
      .setCta()
      .onClick(() => {
        void this.save();
      });
    new ButtonComponent(headerActions)
      .setButtonText(t('itemSheet.editSource'))
      .setClass('character-sheet-mode-toggle')
      .onClick(() => {
        void this.switchToMarkdownView();
      });

    const mainContent = wrapper.createDiv('character-sheet-main-content');

    const leftCol = mainContent.createDiv('character-sheet-column left');
    const rightCol = mainContent.createDiv('character-sheet-column right');

    this.renderBasicInfo(leftCol);
    this.renderCustomProperties(leftCol);

    this.renderImagesSection(rightCol);
    this.renderSectionsArea(rightCol);
  }

  private renderBasicInfo(container: HTMLElement): void {
    const section = container.createDiv('character-sheet-section');
    section.createEl('h3', { text: t('itemSheet.basicInfo'), cls: 'character-sheet-section-title' });

    new Setting(section)
      .setName(t('itemSheet.name'))
      .addText(text => {
        text.setValue(this.data.name || '');
        text.onChange(value => { this.data.name = value; });
      });

    new Setting(section)
      .setName(t('itemSheet.type'))
      .addText(text => {
        text.setValue(this.data.type || '');
        text.setPlaceholder(t('itemSheet.typePlaceholder'));
        text.onChange(value => { this.data.type = value; });
      });

    new Setting(section)
      .setName(t('itemSheet.origin'))
      .addText(text => {
        text.setValue(this.data.origin || '');
        text.setPlaceholder(t('itemSheet.originPlaceholder'));
        text.onChange(value => { this.data.origin = value; });
      });

    new Setting(section)
      .setName(t('itemSheet.description'))
      .addTextArea(text => {
        text.setValue(this.data.description || '');
        text.setPlaceholder(t('itemSheet.descriptionPlaceholder'));
        text.onChange(value => { this.data.description = value; });
      });
  }

  private getPropertyDef(key: string): CustomPropertyDefinition | undefined {
    const template = this.plugin.getItemTemplate(this.data.templateId);
    return template.customPropertyDefs?.find(d => d.key === key);
  }

  private renderCustomProperties(container: HTMLElement): void {
    const section = container.createDiv('character-sheet-section');
    section.createEl('h3', { text: t('itemSheet.customProperties'), cls: 'character-sheet-section-title' });

    const props = this.data.customProperties;
    const list = section.createDiv('location-sheet-custom-list');

    Object.entries(props).forEach(([key, value]) => {
      const row = list.createDiv('location-sheet-custom-row');
      const def = this.getPropertyDef(key);
      const propType = def?.type ?? 'string';
      let currentKey = key;

      const keyInput = row.createEl('input', {
        type: 'text',
        cls: 'location-sheet-custom-key',
        placeholder: t('itemSheet.propertyNamePlaceholder')
      });
      keyInput.value = key;
      keyInput.addEventListener('blur', () => {
        const newKey = keyInput.value.trim();
        if (newKey && newKey !== currentKey) {
          if (props[newKey] !== undefined) {
            new Notice(t('notice.propertyExists', { key: newKey }));
            keyInput.value = currentKey;
            return;
          }
          const val = props[currentKey];
          delete props[currentKey];
          props[newKey] = val;
          currentKey = newKey;
          this.render();
        }
      });
      keyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          keyInput.blur();
        }
      });

      switch (propType) {
        case 'bool': {
          const toggle = row.createDiv('location-sheet-custom-value checkbox-container');
          const cb = toggle.createEl('input', { type: 'checkbox' });
          cb.checked = value === 'true';
          cb.addEventListener('change', () => { props[key] = String(cb.checked); });
          break;
        }
        case 'date': {
          const dateInput = row.createEl('input', {
            type: 'date',
            cls: 'location-sheet-custom-value',
          });
          dateInput.value = value;
          dateInput.addEventListener('input', () => { props[key] = dateInput.value; });
          break;
        }
        case 'int': {
          const numInput = row.createEl('input', {
            type: 'number',
            cls: 'location-sheet-custom-value',
            attr: { step: '1' } as Record<string, string>,
          });
          numInput.value = value;
          numInput.addEventListener('input', () => { props[key] = numInput.value; });
          break;
        }
        case 'enum': {
          if (def?.enumOptions && def.enumOptions.length > 0) {
            const sel = row.createEl('select', { cls: 'location-sheet-custom-value dropdown' });
            const emptyOpt = sel.createEl('option', { text: '—', value: '' });
            emptyOpt.value = '';
            for (const opt of def.enumOptions) {
              sel.createEl('option', { text: opt, value: opt });
            }
            sel.value = value;
            sel.addEventListener('change', () => { props[key] = sel.value; });
          } else {
            const fallback = row.createEl('input', {
              type: 'text',
              cls: 'location-sheet-custom-value',
              placeholder: t('itemSheet.valuePlaceholder')
            });
            fallback.value = value;
            fallback.addEventListener('input', () => { props[key] = fallback.value; });
          }
          break;
        }
        case 'timespan': {
          const tsInput = row.createEl('input', {
            type: 'date',
            cls: 'location-sheet-custom-value',
          });
          tsInput.value = value;
          tsInput.addEventListener('input', () => { props[key] = tsInput.value; });
          break;
        }
        default: {
          const valueInput = row.createEl('input', {
            type: 'text',
            cls: 'location-sheet-custom-value',
            placeholder: t('itemSheet.valuePlaceholder')
          });
          valueInput.value = value;
          valueInput.addEventListener('input', () => { props[key] = valueInput.value; });
        }
      }

      new ButtonComponent(row)
        .setIcon('trash')
        .onClick(() => {
          delete props[key];
          this.render();
        });
    });

    new ButtonComponent(section)
      .setButtonText(t('itemSheet.addProperty'))
      .onClick(() => {
        let i = 1;
        while (props[`New Prop ${i}`]) i++;
        props[`New Prop ${i}`] = '';
        this.render();
      });
  }

  private renderImagesSection(container: HTMLElement): void {
    const section = container.createDiv('character-sheet-section character-sheet-images');
    section.createEl('h3', { text: t('itemSheet.images'), cls: 'character-sheet-section-title' });

    const images = this.data.images;
    const imagesList = section.createDiv('character-sheet-images-list');

    if (images.length === 0) {
      imagesList.createEl('p', { text: t('itemSheet.dropImages'), cls: 'character-sheet-empty' });
    } else {
      images.forEach((img, idx) => {
        this.renderImageRow(imagesList, images, idx);
      });
    }

    new ButtonComponent(section)
      .setButtonText(t('itemSheet.addImage'))
      .onClick(() => {
        images.push({ name: 'New image', path: '' });
        this.render();
      });

    this.setupImageDragDrop(section, images);
  }

  private renderImageRow(container: HTMLElement, images: CharacterImage[], index: number): void {
    const row = container.createDiv('character-sheet-image-row');
    const image = images[index];

    const preview = row.createDiv('character-sheet-image-thumb');
    preview.addClass('character-sheet-image-clickable');
    if (image.path) {
      const file = this.plugin.resolveImagePath(image.path, this.file.path);
      if (file) {
        const src = this.plugin.app.vault.getResourcePath(file);
        preview.createEl('img', { attr: { src, alt: image.name } });
      } else {
        preview.appendChild(this.getImageIcon());
      }
    } else {
      preview.appendChild(this.getImageIcon());
    }

    preview.addEventListener('click', () => {
      new ImageSuggesterModal(this.app, this.plugin, (file) => {
        images[index].path = `![[${file.path}]]`;
        if (!images[index].name || images[index].name === 'New image') {
          images[index].name = file.basename;
        }
        this.render();
      }).open();
    });

    const details = row.createDiv('character-sheet-image-details');

    new Setting(details)
      .setClass('character-sheet-image-name')
      .setName('Name')
      .addText(text => {
        text.setValue(image.name);
        text.onChange(value => {
          images[index].name = value;
        });
      })
      .addButton(btn => {
        btn.setIcon('trash');
        btn.setTooltip('Remove');
        btn.onClick(() => {
          images.splice(index, 1);
          this.render();
        });
      });
  }

  private setupImageDragDrop(container: HTMLElement, images: CharacterImage[]): void {
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      container.addClass('character-sheet-drag-over');
    });
    container.addEventListener('dragleave', () => {
      container.removeClass('character-sheet-drag-over');
    });
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      container.removeClass('character-sheet-drag-over');
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      void this.handleDroppedImages(files, images);
    });
  }

  private getImageIcon(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.addClass('character-sheet-image-icon');
    svg.innerHTML = `
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
      <circle cx="8.5" cy="8.5" r="1.5"></circle>
      <polyline points="21 15 16 10 5 21"></polyline>
    `;
    return svg;
  }

  private async computeHash(data: ArrayBuffer): Promise<string> {
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private async handleDroppedImages(files: FileList, images: CharacterImage[]): Promise<void> {
    const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];
    let addedCount = 0;

    const projectPath = this.plugin.settings.projectPath;
    const imageFolder = `${projectPath}/${this.plugin.settings.imageFolder}`;

    const folderAbstract = this.plugin.app.vault.getAbstractFileByPath(imageFolder);
    if (!folderAbstract) {
      await this.plugin.app.vault.createFolder(imageFolder);
    }

    const existingImageHashes = new Map<string, string>();
    const existingFiles = this.plugin.app.vault.getFiles().filter(f =>
      f.path.startsWith(imageFolder) && IMAGE_EXTENSIONS.includes(f.extension.toLowerCase())
    );

    for (const existingFile of existingFiles) {
      try {
        const content = await this.plugin.app.vault.readBinary(existingFile);
        const hash = await this.computeHash(content);
        existingImageHashes.set(hash, existingFile.path);
      } catch {
        // Skip
      }
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (!IMAGE_EXTENSIONS.includes(ext)) continue;

      const arrayBuffer = await file.arrayBuffer();
      const fileHash = await this.computeHash(arrayBuffer);

      const existingPath = existingImageHashes.get(fileHash);
      if (existingPath) {
        const basename = existingPath.split('/').pop()?.replace(/\.[^/.]+$/, '') || file.name;
        images.push({ name: basename, path: `![[${existingPath}]]` });
        addedCount++;
        continue;
      }

      let targetPath = `${imageFolder}/${file.name}`;
      let counter = 1;
      while (this.plugin.app.vault.getAbstractFileByPath(targetPath)) {
        const namePart = file.name.substring(0, file.name.lastIndexOf('.'));
        targetPath = `${imageFolder}/${namePart} ${counter}.${ext}`;
        counter++;
      }

      await this.plugin.app.vault.createBinary(targetPath, arrayBuffer);
      existingImageHashes.set(fileHash, targetPath);

      const basename = targetPath.split('/').pop()?.replace(/\.[^/.]+$/, '') || 'New image';
      images.push({ name: basename, path: `![[${targetPath}]]` });
      addedCount++;
    }

    this.render();
    new Notice(`Added ${addedCount} image(s)`);
  }

  private renderSectionsArea(_container: HTMLElement): void {
    // Placeholder for sections
  }

  private async switchToMarkdownView(): Promise<void> {
    await this.save();
    if (this.file) {
      await this.leaf.setViewState({
        type: 'markdown',
        state: { file: this.file.path }
      });
    }
  }

  async save(): Promise<void> {
    const content = serializeItemSheet(this.data);
    if (this.file) {
      const nextName = this.data.name.trim();
      if (nextName && this.file.basename !== nextName) {
        const lastSlash = this.file.path.lastIndexOf('/');
        const folderPath = lastSlash >= 0 ? this.file.path.slice(0, lastSlash) : '';
        const nextPath = `${folderPath ? `${folderPath}/` : ''}${nextName}.md`;
        if (!this.app.vault.getAbstractFileByPath(nextPath)) {
          await this.app.fileManager.renameFile(this.file, nextPath);
        } else {
          new Notice(t('notice.itemFileExists'));
        }
      }
      await this.app.vault.modify(this.file, content);
      new Notice(t('notice.itemSaved'));
    }
  }
}
