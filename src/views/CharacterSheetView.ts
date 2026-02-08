import {
  TextFileView,
  WorkspaceLeaf,
  TFile,
  Setting,
  ButtonComponent,
  Notice,
  Component,
  SuggestModal,
  App,
  setIcon
} from 'obsidian';
import type NovalistPlugin from '../main';
import { CharacterSheetData, CharacterRelationship, CharacterChapterOverride, CharacterImage } from '../types';
import { parseCharacterSheet, serializeCharacterSheet } from '../utils/characterSheetUtils';
import { InverseRelationshipModal } from '../modals/InverseRelationshipModal';

export const CHARACTER_SHEET_VIEW_TYPE = 'character-sheet';


class CharacterInlineSuggest {
  private inputEl: HTMLInputElement;
  private plugin: NovalistPlugin;
  private app: App;
  private onSelect: (file: TFile) => void;
  private suggestionContainer: HTMLElement | null = null;
  private suggestions: TFile[] = [];
  private selectedIndex: number = -1;

  constructor(app: App, plugin: NovalistPlugin, inputEl: HTMLInputElement, onSelect: (file: TFile) => void) {
    this.app = app;
    this.plugin = plugin;
    this.inputEl = inputEl;
    this.onSelect = onSelect;

    this.inputEl.addEventListener('input', () => this.onInput());
    this.inputEl.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.inputEl.addEventListener('blur', () => this.onBlur());
  }

  private onInput(): void {
    const query = this.inputEl.value;
    if (!query || query.length === 0) {
      this.close();
      return;
    }

    const root = this.plugin.settings.projectPath;
    const folder = `${root}/${this.plugin.settings.characterFolder}`;
    this.suggestions = this.app.vault.getFiles().filter(f => 
      f.path.startsWith(folder) && 
      f.extension === 'md' &&
      f.basename.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 10);

    if (this.suggestions.length > 0) {
      this.selectedIndex = 0;
      this.showSuggestions();
    } else {
      this.close();
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.suggestionContainer) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex = Math.min(this.selectedIndex + 1, this.suggestions.length - 1);
      this.renderSuggestions();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this.renderSuggestions();
    } else if (e.key === 'Enter') {
      if (this.selectedIndex >= 0 && this.suggestions[this.selectedIndex]) {
        e.preventDefault();
        e.stopImmediatePropagation(); // Prevent the input's default Enter handler
        this.selectSuggestion(this.suggestions[this.selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      this.close();
    }
  }

  private onBlur(): void {
    // Delay closing to allow click event to register
    setTimeout(() => this.close(), 150); 
  }

  private showSuggestions(): void {
    if (!this.suggestionContainer) {
      this.suggestionContainer = document.body.createDiv('character-sheet-suggestion-container');
    }

    const rect = this.inputEl.getBoundingClientRect();
    this.suggestionContainer.style.top = `${rect.bottom + window.scrollY}px`;
    this.suggestionContainer.style.left = `${rect.left + window.scrollX}px`;
    this.suggestionContainer.style.width = `${Math.max(rect.width, 200)}px`;

    this.renderSuggestions();
  }

  private renderSuggestions(): void {
    if (!this.suggestionContainer) return;
    this.suggestionContainer.empty();

    this.suggestions.forEach((file, index) => {
      const item = this.suggestionContainer.createDiv({
         cls: `character-sheet-suggestion-item${index === this.selectedIndex ? ' is-selected' : ''}`,
         text: file.basename
      });
      
      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent blur on input so change event doesn't fire with partial text
        this.selectSuggestion(file);
      });
      
      item.addEventListener('mouseenter', () => {
        this.selectedIndex = index;
        this.renderSuggestions();
      });
    });
  }

  private selectSuggestion(file: TFile): void {
    this.close();
    // Clear value before onSelect because onSelect triggers re-render 
    // which triggers blur/change events on the destroyed input, 
    // potentially causing duplicate additions if value is still there.
    this.inputEl.value = ''; 
    this.onSelect(file);
  }

  private close(): void {
    if (this.suggestionContainer) {
      this.suggestionContainer.remove();
      this.suggestionContainer = null;
    }
  }
}


const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];

class ImageSuggesterModal extends SuggestModal<TFile> {
  private onSelect: (file: TFile) => void;
  private plugin: NovalistPlugin;

  constructor(app: App, plugin: NovalistPlugin, onSelect: (file: TFile) => void) {
    super(app);
    this.plugin = plugin;
    this.onSelect = onSelect;
  }

  getSuggestions(query: string): TFile[] {
    const root = this.plugin.settings.projectPath;
    const folder = `${root}/${this.plugin.settings.imageFolder}`;
    const files = this.app.vault.getFiles().filter(f => 
      f.path.startsWith(folder) && 
      IMAGE_EXTENSIONS.includes(f.extension.toLowerCase()) &&
      f.basename.toLowerCase().includes(query.toLowerCase())
    );
    return files.slice(0, 10);
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.createEl('div', { text: file.basename });
    el.createEl('small', { text: file.path, cls: 'suggestion-path' });
  }

  onChooseSuggestion(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
    this.onSelect(file);
  }
}

export class CharacterSheetView extends TextFileView {
  plugin: NovalistPlugin;
  private readonly suggestionId: string;
  private data: CharacterSheetData = {
    name: '',
    surname: '',
    gender: '',
    age: '',
    role: 'Side',
    faceShot: '',
    relationships: [],
    customProperties: {},
    sections: [],
    chapterOverrides: []
  };
  private contentContainer: HTMLElement;
  private previewComponent = new Component();
  private knownSections: Set<string> = new Set();
  private currentChapter: string | null = null;
  private enableOverrides: boolean = false;
  private chapterLabelById: Map<string, string> = new Map();

  constructor(leaf: WorkspaceLeaf, plugin: NovalistPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.suggestionId = Math.random().toString(36).slice(2, 10);
  }

  getViewType(): string {
    return CHARACTER_SHEET_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file ? `${this.file.basename} (Character Sheet)` : 'Character Sheet';
  }

  getIcon(): string {
    return 'user';
  }

  async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file);
    const content = await this.app.vault.read(file);
    this.originalData = content;
    this.data = parseCharacterSheet(content);
    this.loadKnownSections();
    void this.render();
  }

  async onUnloadFile(): Promise<void> {
    this.previewComponent.unload();
    return super.onUnloadFile();
  }

  clear(): void {
    this.contentEl.empty();
  }

  protected async onOpen(): Promise<void> {
    // Override to handle onOpen
  }

  protected async onClose(): Promise<void> {
    // Override to handle onClose
  }

  getViewData(): string {
    return serializeCharacterSheet(this.data);
  }

  setViewData(data: string, _clear: boolean): void {
    this.originalData = data;
    this.data = parseCharacterSheet(data);
    this.loadKnownSections();
    void this.render();
  }

  private loadKnownSections(): void {
    const root = this.plugin.settings.projectPath;
    const folder = `${root}/${this.plugin.settings.characterFolder}`;
    const files = this.app.vault.getFiles().filter(f => 
      f.path.startsWith(folder) && f.extension === 'md'
    );
    
    // Collect section titles from this and other character files
    for (const file of files) {
      if (file.path === this.file?.path) continue;
      // We can't read all files synchronously, so we'll just track new sections as they're created
    }
    
    // Add current sections to known
    for (const section of this.data.sections) {
      this.knownSections.add(section.title);
    }
  }

  render(): void {
    this.contentEl.empty();
    this.contentEl.addClass('character-sheet-view');

    // Header with mode toggle
    const header = this.contentEl.createDiv('character-sheet-header');
    header.createEl('h2', { text: 'Character', cls: 'character-sheet-title' });

    const headerActions = header.createDiv('character-sheet-header-actions');
    new ButtonComponent(headerActions)
      .setButtonText('Save')
      .setCta()
      .onClick(() => {
        void this.save();
      });
    new ButtonComponent(headerActions)
      .setButtonText('Edit source')
      .setClass('character-sheet-mode-toggle')
      .onClick(() => {
        void this.switchToMarkdownView();
      });

    this.contentContainer = this.contentEl.createDiv('character-sheet-container');
    void this.renderFormMode();
  }

  private renderFormMode(): void {
    this.contentContainer.empty();
    this.previewComponent.unload();
    this.previewComponent = new Component();
    this.previewComponent.load();

    // Chapter override selector (if chapters exist)
    void this.renderChapterOverrideSelector();

    // Main form layout - two columns on desktop
    const formGrid = this.contentContainer.createDiv('character-sheet-grid');
    
    // Left column - basic info
    const leftCol = formGrid.createDiv('character-sheet-left');
    this.renderBasicInfoSection(leftCol);
    
    // Right column - images
    const rightCol = formGrid.createDiv('character-sheet-right');
    this.renderImagesSection(rightCol);

    // Full width sections below
    this.renderRelationshipsSection(this.contentContainer);
    this.renderCustomPropertiesSection(this.contentContainer);
    if (!this.enableOverrides) {
      this.renderSectionsArea(this.contentContainer);
    }
    this.renderChapterOverridesSection(this.contentContainer);

  }

  private async renderChapterOverrideSelector(): Promise<void> {
    const container = this.contentContainer.createDiv('character-sheet-chapter-selector');
    const chapters = await this.plugin.getChapterDescriptions();
    if (chapters.length === 0) return;

    this.chapterLabelById = new Map(chapters.map((ch) => [ch.id, ch.name]));
    
    new Setting(container)
      .setName('Preview/edit for chapter')
      .setDesc('Select a chapter to preview or edit chapter-specific overrides')
      .addDropdown(dropdown => {
        dropdown.addOption('', 'Default (no override)');
        for (const ch of chapters) {
          dropdown.addOption(ch.id, ch.name);
        }
        dropdown.setValue(this.currentChapter || '');
        
        dropdown.onChange(value => {
          this.currentChapter = value || null;
          this.enableOverrides = !!value;
          void this.render();
        });
      });

    if (this.currentChapter && this.enableOverrides) {
      const overrideInfo = container.createDiv('character-sheet-override-info');
      overrideInfo.createEl('span', { 
        text: `Editing overrides for: ${this.getChapterLabel(this.currentChapter)}`,
        cls: 'character-sheet-override-badge'
      });
      
      new ButtonComponent(container)
        .setButtonText('Clear override for this chapter')
        .onClick(() => {
          const label = this.getChapterLabel(this.currentChapter);
          this.data.chapterOverrides = this.data.chapterOverrides.filter(
            o => o.chapter !== this.currentChapter && o.chapter !== label
          );
          this.currentChapter = null;
          this.enableOverrides = false;
          void this.render();
        });
    }
  }

  private renderBasicInfoSection(container: HTMLElement): void {
    const section = container.createDiv('character-sheet-section');
    section.createEl('h3', { text: 'Basic information', cls: 'character-sheet-section-title' });

    // Name and Surname row
    const nameRow = section.createDiv('character-sheet-row');
    
    new Setting(nameRow)
      .setName('Name')
      .addText(text => {
        text.setValue(this.getEffectiveValue('name'));
        text.onChange(value => {
          this.setEffectiveValue('name', value);
        });
      });

    new Setting(nameRow)
      .setName('Surname')
      .addText(text => {
        text.setValue(this.getEffectiveValue('surname'));
        text.onChange(value => {
          this.setEffectiveValue('surname', value);
        });
      });

    // Gender and Age row
    const detailsRow1 = section.createDiv('character-sheet-row');
    const genderListId = `novalist-gender-suggestions-${this.suggestionId}`;
    const genderDatalist = section.createEl('datalist', { attr: { id: genderListId } });
    
    new Setting(detailsRow1)
      .setName('Gender')
      .addText(text => {
        text.setValue(this.getEffectiveValue('gender'));
        text.inputEl.setAttr('list', genderListId);
        void this.populateDatalist(genderDatalist, this.getKnownGenders(text.getValue()));
        text.onChange(value => {
          this.setEffectiveValue('gender', value);
          void this.populateDatalist(genderDatalist, this.getKnownGenders(value));
        });
      });

    new Setting(detailsRow1)
      .setName('Age')
      .addText(text => {
        text.setValue(this.getEffectiveValue('age'));
        text.onChange(value => {
          this.setEffectiveValue('age', value);
        });
      });

    // Role row (compact)
    const roleRow = section.createDiv('character-sheet-row character-sheet-role-row');
    const roleListId = `novalist-role-suggestions-${this.suggestionId}`;
    const roleDatalist = section.createEl('datalist', { attr: { id: roleListId } });
    new Setting(roleRow)
      .setName('Role')
      .addText(text => {
        text.setValue(this.getEffectiveValue('role'));
        text.setPlaceholder('Protag, love interest, etc.');
        text.inputEl.setAttr('list', roleListId);
        void this.populateDatalist(roleDatalist, this.getKnownRoles(text.getValue()));
        text.onChange(value => {
          this.setEffectiveValue('role', value);
          void this.populateDatalist(roleDatalist, this.getKnownRoles(value));
        });
      });
  }

  private async populateDatalist(
    datalist: HTMLDataListElement,
    valuesPromise: Promise<string[]>
  ): Promise<void> {
    const values = await valuesPromise;
    datalist.innerHTML = '';
    for (const value of values) {
      datalist.createEl('option', { attr: { value } });
    }
  }

  private async getKnownRoles(currentValue: string): Promise<string[]> {
    const roles = new Set<string>();
    const trimmedCurrent = currentValue.trim();
    if (trimmedCurrent) roles.add(trimmedCurrent);

    for (const role of Object.keys(this.plugin.settings.roleColors)) {
      const trimmed = role.trim();
      if (trimmed) roles.add(trimmed);
    }

    const characters = await this.plugin.getCharacterList();
    for (const character of characters) {
      const trimmed = character.role?.trim();
      if (trimmed) roles.add(trimmed);
    }

    return Array.from(roles).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  private async getKnownGenders(currentValue: string): Promise<string[]> {
    const genders = new Set<string>();
    const trimmedCurrent = currentValue.trim();
    if (trimmedCurrent) genders.add(trimmedCurrent);

    for (const gender of Object.keys(this.plugin.settings.genderColors)) {
      const trimmed = gender.trim();
      if (trimmed) genders.add(trimmed);
    }

    const characters = await this.plugin.getCharacterList();
    for (const character of characters) {
      const trimmed = character.gender?.trim();
      if (trimmed) genders.add(trimmed);
    }

    return Array.from(genders).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  private renderImagesSection(container: HTMLElement): void {
    const section = container.createDiv('character-sheet-section character-sheet-images');
    section.createEl('h3', { text: 'Images', cls: 'character-sheet-section-title' });

    const images = this.getEffectiveImages();
    
    // Image list
    const imagesList = section.createDiv('character-sheet-images-list');
    
    if (images.length === 0) {
      imagesList.createEl('p', { text: 'Drag and drop images here or click add image', cls: 'character-sheet-empty' });
    } else {
      for (let i = 0; i < images.length; i++) {
        this.renderImageRow(imagesList, images, i);
      }
    }

    // Add image button
    new ButtonComponent(section)
      .setButtonText('Add image')
      .onClick(() => {
        images.push({ name: 'New image', path: '' });
        this.setEffectiveImages(images);
        void this.render();
      });

    // Setup drag and drop on the entire section
    this.setupImageDragDrop(section, images);
  }

  private renderImageRow(container: HTMLElement, images: CharacterImage[], index: number): void {
    const row = container.createDiv('character-sheet-image-row');
    const image = images[index];
    
    // Image preview (clickable to open image suggester)
    const preview = row.createDiv('character-sheet-image-thumb');
    preview.addClass('character-sheet-image-clickable');
    if (image.path) {
      const file = this.plugin.resolveImagePath(image.path, this.file?.path || '');
      if (file) {
        const src = this.plugin.app.vault.getResourcePath(file);
        preview.createEl('img', { attr: { src, alt: image.name } });
      } else {
        preview.appendChild(this.getImageIcon());
      }
    } else {
      preview.appendChild(this.getImageIcon());
    }
    
    // Click to open image suggester
    preview.addEventListener('click', () => {
      new ImageSuggesterModal(this.app, this.plugin, (file) => {
        images[index].path = `![[${file.path}]]`;
        images[index].name = file.basename;
        this.setEffectiveImages(images);
        void this.render();
      }).open();
    });

    // Image name (editable) and remove button
    const details = row.createDiv('character-sheet-image-details');
    
    new Setting(details)
      .setClass('character-sheet-image-name')
      .setName('Name')
      .addText(text => {
        text.setValue(image.name);
        text.onChange(value => {
          images[index].name = value;
          this.setEffectiveImages(images);
        });
      })
      .addButton(btn => {
        btn.setIcon('trash');
        btn.setTooltip('Remove');
        btn.onClick(() => {
          images.splice(index, 1);
          this.setEffectiveImages(images);
          void this.render();
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
    // Create an image icon SVG
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

  private async handleDroppedImages(files: FileList, images: CharacterImage[]): Promise<void> {
    const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];
    let addedCount = 0;
    
    // Get project images folder
    const projectPath = this.plugin.settings.projectPath;
    const imageFolder = `${projectPath}/${this.plugin.settings.imageFolder}`;
    
    // Ensure folder exists
    const folderAbstract = this.plugin.app.vault.getAbstractFileByPath(imageFolder);
    if (!folderAbstract) {
      await this.plugin.app.vault.createFolder(imageFolder);
    }

    // Build a map of existing image hashes to their paths
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
        // Skip files we can't read
      }
    }
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      
      if (!IMAGE_EXTENSIONS.includes(ext)) continue;

      // Read file content
      const arrayBuffer = await file.arrayBuffer();
      const fileHash = await this.computeHash(arrayBuffer);
      
      // Check if we already have this image by hash
      const existingPath = existingImageHashes.get(fileHash);
      if (existingPath) {
        // Image already exists, just add reference to it
        const basename = existingPath.split('/').pop()?.replace(/\.[^/.]+$/, '') || file.name;
        images.push({
          name: basename,
          path: `![[${existingPath}]]`
        });
        addedCount++;
        continue;
      }

      // Generate unique filename
      let targetPath = `${imageFolder}/${file.name}`;
      let counter = 1;
      while (this.plugin.app.vault.getAbstractFileByPath(targetPath)) {
        const namePart = file.name.substring(0, file.name.lastIndexOf('.'));
        targetPath = `${imageFolder}/${namePart} ${counter}.${ext}`;
        counter++;
      }

      // Create in vault
      await this.plugin.app.vault.createBinary(targetPath, arrayBuffer);
      
      // Add to our hash map for subsequent drops
      existingImageHashes.set(fileHash, targetPath);

      // Add to images list
      const basename = targetPath.split('/').pop()?.replace(/\.[^/.]+$/, '') || 'New image';
      images.push({
        name: basename,
        path: `![[${targetPath}]]`
      });
      addedCount++;
    }

    this.setEffectiveImages(images);
    void this.render();
    new Notice(`Added ${addedCount} image(s)`);
  }

  private async computeHash(data: ArrayBuffer): Promise<string> {
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private renderRelationshipsSection(container: HTMLElement): void {
    const section = container.createDiv('character-sheet-section');
    section.createEl('h3', { text: 'Character relationships', cls: 'character-sheet-section-title' });

    const relationships = this.getEffectiveRelationships();
    const listContainer = section.createDiv('character-sheet-relationships-list');

    if (relationships.length === 0) {
      listContainer.createEl('p', { text: 'No relationships defined yet.', cls: 'character-sheet-empty' });
    } else {
      for (let i = 0; i < relationships.length; i++) {
        this.renderRelationshipRow(listContainer, relationships, i);
      }
    }

    // Add relationship button
    new ButtonComponent(section)
      .setButtonText('Add relationship')
      .onClick(() => {
        relationships.push({ role: '', character: '' });
        this.setEffectiveRelationships(relationships);
        void this.render();
      });

    // Known relationship keys as suggestions
    if (this.plugin.knownRelationshipKeys.size > 0) {
      const suggestions = section.createDiv('character-sheet-suggestions');
      suggestions.createEl('small', { text: 'Suggested relationship types: ' });
      for (const key of this.plugin.knownRelationshipKeys) {
        const chip = suggestions.createEl('span', { 
          text: key, 
          cls: 'character-sheet-chip' 
        });
        chip.addEventListener('click', () => {
          relationships.push({ role: key, character: '' });
          this.setEffectiveRelationships(relationships);
          void this.render();
        });
      }
    }
  }

  private renderRelationshipRow(container: HTMLElement, relationships: CharacterRelationship[], index: number): void {
    const row = container.createDiv('character-sheet-relationship-row');
    // Role Setting (Left column)
    new Setting(row)
      .setClass('character-sheet-relationship-role')
      .addText(text => {
        text.setPlaceholder('Role (e.g., friend, enemy)');
        text.setValue(relationships[index].role);
        text.onChange(value => {
          relationships[index].role = value;
          this.setEffectiveRelationships(relationships);
        });
      });

    // Character Setting (Middle column - Badges)
    const charSetting = new Setting(row)
      .setClass('character-sheet-relationship-character');
    
    // Clear default styling implies we might need to be careful with flex
    // createDiv appends to .setting-item-control
    const badgeWrapper = charSetting.controlEl.createDiv('character-badges-container');
    
    // Helper to add badges
    const chars = (relationships[index].character || '')
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
      
    chars.forEach(charRaw => {
        // charRaw is e.g. "[[Name]]" or "Name"
        const display = charRaw.replace(/^\[\[(.*)\]\]$/, '$1');
        const badge = badgeWrapper.createDiv('character-badge');
        badge.setText(display);
        
        const removeBtn = badge.createSpan('character-badge-remove');
        setIcon(removeBtn, 'x');
        removeBtn.setAttr('aria-label', 'Remove character');
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            const newChars = chars.filter(c => c !== charRaw);
            relationships[index].character = newChars.join(', ');
            this.setEffectiveRelationships(relationships);
            void this.render();
        };
    });

    // Add input functionality
    const input = badgeWrapper.createEl('input', { 
        type: 'text', 
        cls: 'character-badge-input', 
        placeholder: '+' 
    });

    // Attach inline suggester first so it processes Enter key before the blur handler
    new CharacterInlineSuggest(this.app, this.plugin, input, (file) => {
        const newRef = `[[${file.basename}]]`;
        const current = relationships[index].character || '';
        const existing = current
            .split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0);
        
        if (!existing.includes(newRef)) {
            existing.push(newRef);
            relationships[index].character = existing.join(', ');
            this.setEffectiveRelationships(relationships);
            void this.render();

            const role = relationships[index].role;
            if (role && role.trim()) {
                new InverseRelationshipModal(
                    this.app,
                    this.plugin,
                    this.file,
                    file,
                    role,
                    (inverseKey) => {
                        void this.addInverseRelationship(file, inverseKey);
                    }
                ).open();
            }
        }
    });
    
    input.addEventListener('change', () => {
        const val = input.value.trim();
        if (val) {
            const newRef = val.startsWith('[[') && val.endsWith(']]') ? val : `[[${val}]]`;
            const current = relationships[index].character || '';
            const existing = current
                .split(',')
                .map(s => s.trim())
                .filter(s => s.length > 0);
            
            if (!existing.includes(newRef)) {
                existing.push(newRef);
                relationships[index].character = existing.join(', ');
                this.setEffectiveRelationships(relationships);
                void this.render();
            }
            input.value = '';
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            input.blur(); // Trigger change
        }
    });

    // Remove Row Button (Right column)
    charSetting.addButton(btn => {
        btn.setIcon('trash');
        btn.setTooltip('Remove relationship row');
        btn.onClick(() => {
          relationships.splice(index, 1);
          this.setEffectiveRelationships(relationships);
          void this.render();
        });
      });
  }

  private renderCustomPropertiesSection(container: HTMLElement): void {
    const section = container.createDiv('character-sheet-section');
    section.createEl('h3', { text: 'Custom properties', cls: 'character-sheet-section-title' });

    const customProps = this.getEffectiveCustomProperties();
    const listContainer = section.createDiv('character-sheet-custom-list');

    const entries = Object.entries(customProps);
    if (entries.length === 0) {
      listContainer.createEl('p', { text: 'No custom properties yet.', cls: 'character-sheet-empty' });
    } else {
      for (let i = 0; i < entries.length; i++) {
        this.renderCustomPropertyRow(listContainer, entries, i, customProps);
      }
    }

    // Add custom property button
    new ButtonComponent(section)
      .setButtonText('Add custom property')
      .onClick(() => {
        // Generate unique key name
        let baseName = 'New property';
        let keyName = baseName;
        let counter = 2;
        while (customProps[keyName] !== undefined) {
          keyName = `${baseName} ${counter}`;
          counter++;
        }
        customProps[keyName] = '';
        this.setEffectiveCustomProperties(customProps);
        void this.render();
      });
  }

  private renderCustomPropertyRow(
    container: HTMLElement, 
    entries: [string, string][], 
    index: number,
    customProps: Record<string, string>
  ): void {
    const row = container.createDiv('character-sheet-custom-row');
    const [originalKey, value] = entries[index];
    let currentKey = originalKey; // Mutable reference to track key changes without re-rendering
    
    new Setting(row)
      .setClass('character-sheet-custom-key')
      .addText(text => {
        text.setPlaceholder('Property name');
        text.setValue(currentKey);
        // Use blur to avoid creating duplicate keys while typing
        text.inputEl.addEventListener('blur', () => {
           const newKey = text.getValue().trim();
           if (newKey && newKey !== currentKey) {
               // Check for duplicates
               const props = this.getEffectiveCustomProperties();
               if (props[newKey] !== undefined) {
                   new Notice(`Property '${newKey}' already exists.`);
                   text.setValue(currentKey);
                   return;
               }
               
               // Perform the rename on the data object
               // We use the object reference passed in (customProps) or fetch fresh?
               // renderCustomPropertiesSection passes `this.getEffectiveCustomProperties()` which creates a new object copy usually.
               // But `customProps` in renderCustomPropertiesSection is: const customProps = this.getEffectiveCustomProperties();
               // And that variable is passed here.
               // getEffectiveCustomProperties returns a copy?
               // ... return { ...this.data.customProperties }; -> YES it returns a shallow copy.
               // BUT `this.setEffectiveCustomProperties(customProps)` was used in the previous code on every change.
               // So if we modify `customProps` here (which is the object from the parent scope), and call setEffective, it works.
               
               // We must operate on the `customProps` object passed to this function to maintain consistency with the other fields.
               if (customProps[currentKey] !== undefined) {
                   const val = customProps[currentKey];
                   delete customProps[currentKey];
                   customProps[newKey] = val;
                   
                   currentKey = newKey; // Update closure
                   this.setEffectiveCustomProperties(customProps);
                   // NO RENDER calling here to preserve focus flow
               }
           }
        });
        text.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                text.inputEl.blur();
            }
        });
      });

    new Setting(row)
      .setClass('character-sheet-custom-value')
      .addText(text => {
        text.setPlaceholder('Value');
        text.setValue(value);
        text.onChange(newValue => {
          // Use currentKey to ensure we update the correct entry if it was renamed
          customProps[currentKey] = newValue;
          this.setEffectiveCustomProperties(customProps);
        });
      })
      .addButton(btn => {
        btn.setIcon('trash');
        btn.setTooltip('Remove');
        btn.onClick(() => {
          delete customProps[currentKey];
          this.setEffectiveCustomProperties(customProps);
          void this.render(); // Render required for deletion
        });
      });
  }

  private renderSectionsArea(container: HTMLElement): void {
    const area = container.createDiv('character-sheet-sections-area');
    
    // Existing sections
    for (let i = 0; i < this.data.sections.length; i++) {
      this.renderFreeSection(area, i);
    }

    // Add new section
    const addSection = area.createDiv('character-sheet-add-section');
    
    // Known section suggestions
    if (this.knownSections.size > 0) {
      const suggestions = addSection.createDiv('character-sheet-section-suggestions');
      suggestions.createEl('small', { text: 'Add section: ' });
      for (const title of this.knownSections) {
        const chip = suggestions.createEl('span', { 
          text: title, 
          cls: 'character-sheet-chip' 
        });
        chip.addEventListener('click', () => {
          this.data.sections.push({ title, content: '' });
          this.knownSections.add(title);
          void this.render();
        });
      }
    }

    new ButtonComponent(addSection)
      .setButtonText('Add new section')
      .onClick(() => {
        this.data.sections.push({ title: 'New section', content: '' });
        void this.render();
      });
  }

  private renderFreeSection(container: HTMLElement, index: number): void {
    const section = this.data.sections[index];
    const sectionEl = container.createDiv('character-sheet-free-section');
    
    const header = sectionEl.createDiv('character-sheet-free-section-header');
    
    const titleInput = header.createEl('input', { 
      type: 'text',
      cls: 'character-sheet-section-title-input'
    });
    titleInput.value = section.title;
    titleInput.placeholder = 'Section title';
    titleInput.addEventListener('change', () => {
      section.title = titleInput.value;
      this.knownSections.add(section.title);
    });

    new ButtonComponent(header)
      .setIcon('trash')
      .setTooltip('Remove section')
      .onClick(() => {
        this.data.sections.splice(index, 1);
        this.render();
      });

    const contentArea = sectionEl.createDiv('character-sheet-free-section-content');
    const textarea = contentArea.createEl('textarea', {
      cls: 'character-sheet-markdown-textarea'
    });
    textarea.value = section.content;
    textarea.placeholder = 'Write content here';
    textarea.addEventListener('input', () => {
      section.content = textarea.value;
    });
  }

  private renderChapterOverridesSection(container: HTMLElement): void {
    this.ensureChapterLabelMap();
    const section = container.createDiv('character-sheet-section character-sheet-overrides');
    section.createEl('h3', { 
      text: 'Chapter overrides', 
      cls: 'character-sheet-section-title' 
    });

    if (this.data.chapterOverrides.length === 0) {
      section.createEl('p', { 
        text: 'No chapter-specific overrides set. Select a chapter above to create overrides.', 
        cls: 'character-sheet-empty' 
      });
      return;
    }

    const list = section.createDiv('character-sheet-overrides-list');
    for (const override of this.data.chapterOverrides) {
      const item = list.createDiv('character-sheet-override-item');
      item.createEl('strong', { text: this.getChapterLabel(override.chapter) });
      
      const details: string[] = [];
      if (override.name) details.push(`name: ${override.name}`);
      if (override.surname) details.push(`surname: ${override.surname}`);
      if (override.age) details.push(`age: ${override.age}`);
      if (override.gender) details.push(`gender: ${override.gender}`);
      if (override.role) details.push(`role: ${override.role}`);
      if (override.relationships) details.push(`relationships: ${override.relationships.length}`);
      
      if (details.length > 0) {
        item.createEl('span', { 
          text: ` (${details.join(', ')})`,
          cls: 'character-sheet-override-details'
        });
      }

      new ButtonComponent(item)
        .setIcon('trash')
        .setTooltip('Remove override')
        .onClick(() => {
          this.data.chapterOverrides = this.data.chapterOverrides.filter(
            o => o.chapter !== override.chapter
          );
          void this.render();
        });
    }
  }

  private async switchToMarkdownView(): Promise<void> {
    // Save current data first
    await this.save();
    // Switch to standard markdown view
    if (this.file) {
      await this.leaf.setViewState({
        type: 'markdown',
        state: { file: this.file.path }
      });
    }
  }

  private getChapterLabel(chapterId: string): string {
    return this.chapterLabelById.get(chapterId) || chapterId;
  }

  private ensureChapterLabelMap(): void {
    if (this.chapterLabelById.size > 0) return;
    const chapters = this.plugin.getChapterDescriptionsSync();
    this.chapterLabelById = new Map(chapters.map((ch) => [ch.id, ch.name]));
  }

  private getOverrideForCurrentChapter(): CharacterChapterOverride | undefined {
    if (!this.currentChapter) return undefined;

    let override = this.data.chapterOverrides.find(o => o.chapter === this.currentChapter);
    if (!override) {
      const label = this.getChapterLabel(this.currentChapter);
      override = this.data.chapterOverrides.find(o => o.chapter === label);
      if (override) {
        override.chapter = this.currentChapter;
      }
    }

    return override;
  }

  // Helper methods for handling overrides
  private getEffectiveValue(field: keyof CharacterSheetData): string {
    if (this.enableOverrides && this.currentChapter) {
      const override = this.getOverrideForCurrentChapter();
      if (override) {
        const overrideValue = override[field as keyof CharacterChapterOverride];
        if (overrideValue !== undefined) {
          return typeof overrideValue === 'string' ? overrideValue : JSON.stringify(overrideValue);
        }
      }
    }
    const dataValue = this.data[field];
    return typeof dataValue === 'string' ? dataValue : JSON.stringify(dataValue ?? '');
  }

  private setEffectiveValue(field: keyof CharacterSheetData, value: string): void {
    if (this.enableOverrides && this.currentChapter) {
      let override = this.getOverrideForCurrentChapter();
      if (!override) {
        override = { chapter: this.currentChapter };
        this.data.chapterOverrides.push(override);
      }
      (override as Record<string, string>)[field] = value;
    } else {
      (this.data as Record<string, string>)[field] = value;
    }
  }

  private getEffectiveRelationships(): CharacterRelationship[] {
    if (this.enableOverrides && this.currentChapter) {
      const override = this.getOverrideForCurrentChapter();
      if (override?.relationships !== undefined) {
        return [...override.relationships];
      }
    }
    return [...this.data.relationships];
  }

  private setEffectiveRelationships(relationships: CharacterRelationship[]): void {
    if (this.enableOverrides && this.currentChapter) {
      let override = this.getOverrideForCurrentChapter();
      if (!override) {
        override = { chapter: this.currentChapter };
        this.data.chapterOverrides.push(override);
      }
      override.relationships = relationships;
    } else {
      this.data.relationships = relationships;
    }
  }

  private getEffectiveCustomProperties(): Record<string, string> {
    if (this.enableOverrides && this.currentChapter) {
      const override = this.data.chapterOverrides.find(o => o.chapter === this.currentChapter);
      if (override?.customProperties !== undefined) {
        return { ...this.data.customProperties, ...override.customProperties };
      }
    }
    return { ...this.data.customProperties };
  }

  private setEffectiveCustomProperties(props: Record<string, string>): void {
    if (this.enableOverrides && this.currentChapter) {
      let override = this.data.chapterOverrides.find(o => o.chapter === this.currentChapter);
      if (!override) {
        override = { chapter: this.currentChapter };
        this.data.chapterOverrides.push(override);
      }
      override.customProperties = props;
    } else {
      this.data.customProperties = props;
    }
  }

  private getEffectiveImages(): CharacterImage[] {
    let sourceImages: CharacterImage[];
    if (this.enableOverrides && this.currentChapter) {
      const override = this.data.chapterOverrides.find(o => o.chapter === this.currentChapter);
      if (override?.images !== undefined) {
        sourceImages = override.images;
      } else {
        sourceImages = this.data.images;
      }
    } else {
      sourceImages = this.data.images;
    }
    // Deep copy to prevent modifying the originals
    return sourceImages.map(img => ({ ...img }));
  }

  private setEffectiveImages(images: CharacterImage[]): void {
    if (this.enableOverrides && this.currentChapter) {
      let override = this.data.chapterOverrides.find(o => o.chapter === this.currentChapter);
      if (!override) {
        override = { chapter: this.currentChapter };
        this.data.chapterOverrides.push(override);
      }
      override.images = images;
    } else {
      this.data.images = images;
    }
  }

  async addInverseRelationship(targetFile: TFile, inverseRole: string): Promise<void> {
    try {
      const content = await this.app.vault.read(targetFile);
      const data = parseCharacterSheet(content);
      
      const sourceLink = `[[${this.file.basename}]]`;
      
      // Check if this relationship already exists
      let processed = false;
      if (data.relationships) {
        // Try to find if relationship with this role already exists
        const existingRel = data.relationships.find(r => r.role.toLowerCase() === inverseRole.toLowerCase());
        if (existingRel) {
            const chars = existingRel.character.split(',').map(s => s.trim()).filter(s => s.length > 0);
            if (!chars.includes(sourceLink)) {
                chars.push(sourceLink);
                existingRel.character = chars.join(', ');
                processed = true;
            } else {
                // Already exists
                processed = true; 
            }
        }
      } else {
          data.relationships = [];
      }

      if (!processed) {
          data.relationships.push({
              role: inverseRole,
              character: sourceLink
          });
      }

      const newContent = serializeCharacterSheet(data);
      await this.app.vault.modify(targetFile, newContent);
      new Notice(`Added "${inverseRole}" relationship to ${targetFile.basename}`);
      
    } catch {
      new Notice(`Failed to add inverse relationship to ${targetFile.basename}`);
    }
  }

  async save(): Promise<void> {
    const content = serializeCharacterSheet(this.data);
    if (this.file) {
      const nextName = `${this.data.name} ${this.data.surname}`.trim();
      if (nextName && this.file.basename !== nextName) {
        const lastSlash = this.file.path.lastIndexOf('/');
        const folderPath = lastSlash >= 0 ? this.file.path.slice(0, lastSlash) : '';
        const nextPath = `${folderPath ? `${folderPath}/` : ''}${nextName}.md`;
        if (!this.app.vault.getAbstractFileByPath(nextPath)) {
          await this.app.fileManager.renameFile(this.file, nextPath);
        } else {
          new Notice('A character file with that name already exists.');
        }
      }
      await this.app.vault.modify(this.file, content);
      new Notice('Character saved!');
    }
  }
}
