"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOVELIST_SIDEBAR_VIEW_TYPE = void 0;
const obsidian_1 = require("obsidian");
const DEFAULT_SETTINGS = {
    projectPath: 'NovelProject',
    autoReplacements: {
        "'": "«",
        "''": "»",
        "--": "—",
        "...": "…"
    },
    enableHoverPreview: true,
    enableSidebarView: true,
    characterFolder: 'Characters',
    locationFolder: 'Locations',
    chapterDescFolder: 'ChapterDescriptions',
    chapterFolder: 'Chapters'
};
// ==========================================
// VIEWS
// ==========================================
exports.NOVELIST_SIDEBAR_VIEW_TYPE = 'novalist-sidebar';
class NovalistSidebarView extends obsidian_1.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.currentChapterFile = null;
        this.selectedEntity = null;
        this.activeTab = 'context';
        this.lastNonFocusTab = 'context';
        this.lastFocusKey = null;
        this.autoFocusActive = true;
        this.selectedImageByPath = new Map();
        this.plugin = plugin;
    }
    getViewType() {
        return exports.NOVELIST_SIDEBAR_VIEW_TYPE;
    }
    getDisplayText() {
        return 'Novalist Context';
    }
    getIcon() {
        return 'book-open';
    }
    async onOpen() {
        this.containerEl.empty();
        this.render();
        // Listen for active file changes
        this.registerEvent(this.app.workspace.on('file-open', (file) => {
            if (file && file.extension === 'md') {
                this.currentChapterFile = file;
                this.render();
            }
        }));
    }
    async render() {
        var _a, _b, _c, _d;
        const container = this.containerEl;
        container.empty();
        container.addClass('novalist-sidebar');
        container.onclick = (evt) => {
            const target = evt.target;
            if (!target)
                return;
            const link = target.closest('a');
            if (!link || !container.contains(link))
                return;
            const href = link.getAttribute('data-href') || link.getAttribute('href') || link.textContent || '';
            if (!href)
                return;
            void this.plugin.focusEntityByName(href, true).then((handled) => {
                if (handled) {
                    evt.preventDefault();
                    evt.stopPropagation();
                }
            });
        };
        // Header
        container.createEl('h3', { text: 'Novalist Context', cls: 'novalist-sidebar-header' });
        // Tabs
        const tabs = container.createDiv('novalist-tabs');
        const setTab = (tab) => {
            this.autoFocusActive = false;
            this.activeTab = tab;
            if (tab !== 'focus')
                this.lastNonFocusTab = tab;
            this.render();
        };
        const tabOrder = [
            { id: 'actions', label: 'Actions' },
            { id: 'context', label: 'Overview' },
            { id: 'focus', label: 'Focus' }
        ];
        for (const tab of tabOrder) {
            const btn = tabs.createEl('button', {
                text: tab.label,
                cls: `novalist-tab ${this.activeTab === tab.id ? 'is-active' : ''}`
            });
            btn.addEventListener('click', () => setTab(tab.id));
        }
        if (!this.selectedEntity && this.activeTab === 'focus') {
            this.activeTab = this.lastNonFocusTab;
        }
        if (this.activeTab === 'focus') {
            const details = container.createDiv('novalist-section novalist-selected-entity');
            if (!this.selectedEntity) {
                details.createEl('p', { text: 'No focused item.', cls: 'novalist-empty' });
            }
            else {
                const content = await this.plugin.app.vault.read(this.selectedEntity.file);
                let body = this.plugin.stripFrontmatter(content);
                const title = this.plugin.extractTitle(body);
                if (title) {
                    details.createEl('h3', { text: title, cls: 'novalist-focus-title' });
                    body = this.plugin.removeTitle(body);
                }
                if (this.selectedEntity.type === 'character') {
                    body = this.plugin.stripChapterRelevantSection(body);
                    body = this.plugin.stripImagesSection(body);
                    if (this.currentChapterFile) {
                        const charData = await this.plugin.parseCharacterFile(this.selectedEntity.file);
                        const chapterKey = await this.plugin.getChapterNameForFile(this.currentChapterFile);
                        const chapterInfo = charData.chapterInfos.find(ci => ci.chapter === chapterKey);
                        if (chapterInfo) {
                            body = this.plugin.applyCharacterOverridesToBody(body, chapterInfo.overrides);
                        }
                    }
                    const images = this.plugin.parseImagesSection(content);
                    if (images.length > 0) {
                        const imageRow = details.createDiv('novalist-image-row');
                        imageRow.createEl('span', { text: 'Images', cls: 'novalist-image-label' });
                        const dropdown = new obsidian_1.DropdownComponent(imageRow);
                        for (const img of images) {
                            dropdown.addOption(img.name, img.name);
                        }
                        const key = this.selectedEntity.file.path;
                        const selected = this.selectedImageByPath.get(key) || images[0].name;
                        dropdown.setValue(selected);
                        const imageContainer = details.createDiv('novalist-image-preview');
                        const renderImage = async (name) => {
                            const img = images.find(i => i.name === name) || images[0];
                            this.selectedImageByPath.set(key, img.name);
                            imageContainer.empty();
                            const file = this.plugin.resolveImagePath(img.path, this.selectedEntity.file.path);
                            if (!file) {
                                imageContainer.createEl('p', { text: 'Image not found.', cls: 'novalist-empty' });
                                return;
                            }
                            const src = this.plugin.app.vault.getResourcePath(file);
                            imageContainer.createEl('img', { attr: { src, alt: img.name } });
                        };
                        dropdown.onChange((val) => {
                            void renderImage(val);
                        });
                        await renderImage(selected);
                    }
                }
                if (this.selectedEntity.type === 'character' && this.currentChapterFile) {
                    const charData = await this.plugin.parseCharacterFile(this.selectedEntity.file);
                    const chapterKey = await this.plugin.getChapterNameForFile(this.currentChapterFile);
                    const chapterInfo = charData.chapterInfos.find(ci => ci.chapter === chapterKey);
                    if (chapterInfo && (((_a = chapterInfo.overrides) === null || _a === void 0 ? void 0 : _a.further_info) || chapterInfo.info)) {
                        const block = details.createDiv('novalist-section');
                        block.createEl('h4', { text: `Chapter Notes: ${chapterKey}`, cls: 'novalist-section-title' });
                        const text = [(_b = chapterInfo.overrides) === null || _b === void 0 ? void 0 : _b.further_info, chapterInfo.info].filter(Boolean).join('\n');
                        const md = block.createDiv('novalist-markdown');
                        await obsidian_1.MarkdownRenderer.renderMarkdown(text, md, '', this);
                    }
                }
                const md = details.createDiv('novalist-markdown');
                await obsidian_1.MarkdownRenderer.renderMarkdown(body, md, '', this);
            }
            return;
        }
        if (this.activeTab === 'actions') {
            const actionsSection = container.createDiv('novalist-section');
            actionsSection.createEl('h4', { text: '⚡ Quick Actions', cls: 'novalist-section-title' });
            const btnContainer = actionsSection.createDiv('novalist-actions');
            new obsidian_1.ButtonComponent(btnContainer)
                .setButtonText('Add Character')
                .onClick(() => this.plugin.openCharacterModal());
            new obsidian_1.ButtonComponent(btnContainer)
                .setButtonText('Add Location')
                .onClick(() => this.plugin.openLocationModal());
            new obsidian_1.ButtonComponent(btnContainer)
                .setButtonText('Add Chapter Description')
                .onClick(() => this.plugin.openChapterDescriptionModal());
            return;
        }
        if (!this.currentChapterFile) {
            container.createEl('p', { text: 'Open a chapter file to see context.', cls: 'novalist-empty' });
            return;
        }
        // Get chapter data
        const chapterData = await this.plugin.parseChapterFile(this.currentChapterFile);
        // Characters Section
        if (chapterData.characters.length > 0) {
            const characterItems = [];
            const chapterKey = this.currentChapterFile ? await this.plugin.getChapterNameForFile(this.currentChapterFile) : '';
            for (const charName of chapterData.characters) {
                const charFile = await this.plugin.findCharacterFile(charName);
                if (!charFile)
                    continue;
                const charData = await this.plugin.parseCharacterFile(charFile);
                const chapterInfo = charData.chapterInfos.find(ci => ci.chapter === chapterKey);
                characterItems.push({ data: charData, chapterInfo });
            }
            if (characterItems.length > 0) {
                const charSection = container.createDiv('novalist-section');
                charSection.createEl('h4', { text: '👤 Characters', cls: 'novalist-section-title' });
                const charList = charSection.createDiv('novalist-list');
                for (const itemData of characterItems) {
                    const { data: charData, chapterInfo } = itemData;
                    const item = charList.createDiv('novalist-item');
                    // Header with name
                    const header = item.createDiv('novalist-item-header');
                    header.createEl('strong', { text: `${charData.name} ${charData.surname}` });
                    // Info
                    const info = item.createDiv('novalist-item-info');
                    const age = ((_c = chapterInfo === null || chapterInfo === void 0 ? void 0 : chapterInfo.overrides) === null || _c === void 0 ? void 0 : _c.age) || charData.age;
                    const relationship = ((_d = chapterInfo === null || chapterInfo === void 0 ? void 0 : chapterInfo.overrides) === null || _d === void 0 ? void 0 : _d.relationship) || charData.relationship;
                    if (age)
                        info.createEl('span', { text: `Age: ${age}`, cls: 'novalist-tag' });
                    if (relationship)
                        info.createEl('span', { text: relationship, cls: 'novalist-tag' });
                    // Hover/Click to open
                    item.addEventListener('click', () => {
                        this.plugin.focusEntityByName(`${charData.name} ${charData.surname}`.trim(), true);
                    });
                }
            }
        }
        // Locations Section
        if (chapterData.locations.length > 0) {
            const locationItems = [];
            for (const locName of chapterData.locations) {
                const locFile = await this.plugin.findLocationFile(locName);
                if (!locFile)
                    continue;
                const locData = await this.plugin.parseLocationFile(locFile);
                locationItems.push(locData);
            }
            if (locationItems.length > 0) {
                const locSection = container.createDiv('novalist-section');
                locSection.createEl('h4', { text: '📍 Locations', cls: 'novalist-section-title' });
                const locList = locSection.createDiv('novalist-list');
                for (const locData of locationItems) {
                    const item = locList.createDiv('novalist-item');
                    item.createEl('strong', { text: locData.name });
                    if (locData.description) {
                        item.createEl('p', { text: locData.description });
                    }
                    item.addEventListener('click', () => {
                        this.plugin.focusEntityByName(locData.name, true);
                    });
                }
            }
        }
    }
    async onClose() {
        // Cleanup
    }
    setSelectedEntity(entity, options) {
        const nextKey = entity ? entity.file.path : null;
        const changed = nextKey !== this.lastFocusKey;
        this.lastFocusKey = nextKey;
        this.selectedEntity = entity;
        if (changed && nextKey) {
            this.selectedImageByPath.delete(nextKey);
        }
        if (!entity) {
            if (this.activeTab === 'focus')
                this.activeTab = this.lastNonFocusTab;
        }
        else if (changed && (options === null || options === void 0 ? void 0 : options.forceFocus) !== false) {
            this.autoFocusActive = true;
            this.activeTab = 'focus';
        }
        else if (this.autoFocusActive && this.activeTab !== 'focus' && (options === null || options === void 0 ? void 0 : options.forceFocus) !== false) {
            this.activeTab = 'focus';
        }
        this.render();
    }
}
// ==========================================
// MODALS
// ==========================================
class CharacterModal extends obsidian_1.Modal {
    constructor(app, plugin) {
        super(app);
        this.name = '';
        this.surname = '';
        this.age = '';
        this.relationship = '';
        this.furtherInfo = '';
        this.previewEl = null;
        this.plugin = plugin;
    }
    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Create New Character' });
        // Name
        new obsidian_1.Setting(contentEl)
            .setName('Name')
            .addText(text => text.onChange(value => this.name = value));
        // Surname
        new obsidian_1.Setting(contentEl)
            .setName('Surname')
            .addText(text => text.onChange(value => this.surname = value));
        // Age
        new obsidian_1.Setting(contentEl)
            .setName('Age')
            .addText(text => text.onChange(value => this.age = value));
        // Relationship
        new obsidian_1.Setting(contentEl)
            .setName('Relationship')
            .addText(text => text.onChange(value => this.relationship = value));
        // Further Info
        new obsidian_1.Setting(contentEl)
            .setName('Further Information')
            .addTextArea(text => text
            .setPlaceholder('Supports Markdown')
            .onChange(async (value) => {
            this.furtherInfo = value;
            await this.renderPreview();
        }));
        // Markdown preview
        this.previewEl = contentEl.createDiv('novalist-markdown-preview');
        this.previewEl.createEl('small', { text: 'Preview' });
        await this.renderPreview();
        // Buttons
        const buttonDiv = contentEl.createDiv('modal-button-container');
        new obsidian_1.ButtonComponent(buttonDiv)
            .setButtonText('Cancel')
            .onClick(() => this.close());
        new obsidian_1.ButtonComponent(buttonDiv)
            .setButtonText('Create')
            .setCta()
            .onClick(async () => {
            await this.plugin.createCharacter(this.name, this.surname, this.age, this.relationship, this.furtherInfo);
            this.close();
        });
    }
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
    async renderPreview() {
        if (!this.previewEl)
            return;
        this.previewEl.empty();
        this.previewEl.createEl('small', { text: 'Preview' });
        const container = this.previewEl.createDiv();
        await obsidian_1.MarkdownRenderer.renderMarkdown(this.furtherInfo || '', container, '', this.plugin);
    }
}
class LocationModal extends obsidian_1.Modal {
    constructor(app, plugin) {
        super(app);
        this.name = '';
        this.description = '';
        this.plugin = plugin;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Create New Location' });
        new obsidian_1.Setting(contentEl)
            .setName('Name')
            .addText(text => text.onChange(value => this.name = value));
        new obsidian_1.Setting(contentEl)
            .setName('Description')
            .addTextArea(text => text.onChange(value => this.description = value));
        const buttonDiv = contentEl.createDiv('modal-button-container');
        new obsidian_1.ButtonComponent(buttonDiv)
            .setButtonText('Cancel')
            .onClick(() => this.close());
        new obsidian_1.ButtonComponent(buttonDiv)
            .setButtonText('Create')
            .setCta()
            .onClick(async () => {
            await this.plugin.createLocation(this.name, this.description);
            this.close();
        });
    }
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
class ChapterDescriptionModal extends obsidian_1.Modal {
    constructor(app, plugin) {
        super(app);
        this.name = '';
        this.order = '';
        this.outline = '';
        this.plugin = plugin;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Create Chapter Description' });
        new obsidian_1.Setting(contentEl)
            .setName('Name')
            .addText(text => text.onChange(value => this.name = value));
        new obsidian_1.Setting(contentEl)
            .setName('Order')
            .addText(text => text.onChange(value => this.order = value));
        new obsidian_1.Setting(contentEl)
            .setName('Outline')
            .addTextArea(text => text
            .setPlaceholder('Supports Markdown')
            .onChange(value => this.outline = value));
        const buttonDiv = contentEl.createDiv('modal-button-container');
        new obsidian_1.ButtonComponent(buttonDiv)
            .setButtonText('Cancel')
            .onClick(() => this.close());
        new obsidian_1.ButtonComponent(buttonDiv)
            .setButtonText('Create')
            .setCta()
            .onClick(async () => {
            await this.plugin.createChapterDescription(this.name, this.order, this.outline);
            this.close();
        });
    }
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
// ==========================================
// SETTINGS TAB
// ==========================================
class NovalistSettingTab extends obsidian_1.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Novalist Settings' });
        new obsidian_1.Setting(containerEl)
            .setName('Project Path')
            .setDesc('Root folder for your novel project')
            .addText(text => text
            .setPlaceholder('NovelProject')
            .setValue(this.plugin.settings.projectPath)
            .onChange(async (value) => {
            this.plugin.settings.projectPath = value;
            await this.plugin.saveSettings();
        }));
        // Auto Replacements
        containerEl.createEl('h3', { text: 'Auto Replacements' });
        containerEl.createEl('p', { text: 'Configure text shortcuts that will be auto-replaced while typing.' });
        const replacementContainer = containerEl.createDiv('novalist-replacements');
        Object.entries(this.plugin.settings.autoReplacements).forEach(([key, value]) => {
            this.addReplacementSetting(replacementContainer, key, value);
        });
        new obsidian_1.ButtonComponent(containerEl)
            .setButtonText('Add Replacement')
            .onClick(() => {
            this.addReplacementSetting(replacementContainer, '', '');
        });
        new obsidian_1.Setting(containerEl)
            .setName('Enable Hover Preview')
            .setDesc('Show character/location info on hover')
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.enableHoverPreview)
            .onChange(async (value) => {
            this.plugin.settings.enableHoverPreview = value;
            await this.plugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName('Enable Sidebar View')
            .setDesc('Show the Novalist context sidebar')
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.enableSidebarView)
            .onChange(async (value) => {
            this.plugin.settings.enableSidebarView = value;
            await this.plugin.saveSettings();
        }));
    }
    addReplacementSetting(container, key, value) {
        const setting = new obsidian_1.Setting(container)
            .addText(text => text
            .setPlaceholder("Shortcut (e.g. '')")
            .setValue(key)
            .onChange(async (newKey) => {
            delete this.plugin.settings.autoReplacements[key];
            this.plugin.settings.autoReplacements[newKey] = value;
            await this.plugin.saveSettings();
        }))
            .addText(text => text
            .setPlaceholder('Replacement (e.g. »)')
            .setValue(value)
            .onChange(async (newValue) => {
            this.plugin.settings.autoReplacements[key] = newValue;
            await this.plugin.saveSettings();
        }))
            .addExtraButton(btn => btn
            .setIcon('trash')
            .onClick(async () => {
            delete this.plugin.settings.autoReplacements[key];
            await this.plugin.saveSettings();
            this.display();
        }));
    }
}
// ==========================================
// MAIN PLUGIN CLASS
// ==========================================
class NovalistPlugin extends obsidian_1.Plugin {
    constructor() {
        super(...arguments);
        this.sidebarView = null;
        this.entityIndex = new Map();
        this.entityRegex = null;
        this.lastHoverEntity = null;
        this.hoverTimer = null;
        this.caretTimer = null;
    }
    async onload() {
        await this.loadSettings();
        await this.refreshEntityIndex();
        await this.syncAllCharactersChapterInfos();
        this.app.workspace.onLayoutReady(() => {
            void this.syncAllCharactersChapterInfos();
        });
        // Register sidebar view
        this.registerView(exports.NOVELIST_SIDEBAR_VIEW_TYPE, (leaf) => {
            this.sidebarView = new NovalistSidebarView(leaf, this);
            return this.sidebarView;
        });
        // Add ribbon icon
        this.addRibbonIcon('book-open', 'Novalist', () => {
            this.activateView();
        });
        // Initialize project structure command
        this.addCommand({
            id: 'initialize-novel-project',
            name: 'Initialize Novel Project Structure',
            callback: () => this.initializeProjectStructure()
        });
        // Open sidebar command
        this.addCommand({
            id: 'open-novalist-sidebar',
            name: 'Open Context Sidebar',
            callback: () => this.activateView()
        });
        // Open focused entity in sidebar (edit mode)
        this.addCommand({
            id: 'open-entity-in-sidebar',
            name: 'Open Entity In Sidebar',
            callback: () => this.openEntityFromEditor()
        });
        // Add new character command
        this.addCommand({
            id: 'add-character',
            name: 'Add New Character',
            callback: () => this.openCharacterModal()
        });
        // Add new location command
        this.addCommand({
            id: 'add-location',
            name: 'Add New Location',
            callback: () => this.openLocationModal()
        });
        // Add new chapter description command
        this.addCommand({
            id: 'add-chapter-description',
            name: 'Add Chapter Description',
            callback: () => this.openChapterDescriptionModal()
        });
        // Sync character chapter info command
        this.addCommand({
            id: 'sync-character-chapter-info',
            name: 'Sync Character Chapter Info',
            callback: () => this.syncAllCharactersChapterInfos()
        });
        // Settings tab
        this.addSettingTab(new NovalistSettingTab(this.app, this));
        // Auto-replacement on typing
        this.registerDomEvent(document, 'keyup', (evt) => {
            if (evt.key.length === 1 || evt.key === 'Space' || evt.key === 'Enter') {
                this.handleAutoReplacement();
            }
        });
        // Hover preview handler
        if (this.settings.enableHoverPreview) {
            this.registerHoverLinkSource('novalist', {
                display: 'Novalist',
                defaultMod: true,
            });
        }
        // Auto-link character/location names in reading view for hover previews (chapters only)
        this.registerMarkdownPostProcessor((el, ctx) => {
            if (!this.settings.enableHoverPreview)
                return;
            if (!(ctx === null || ctx === void 0 ? void 0 : ctx.sourcePath) || !this.isChapterPath(ctx.sourcePath))
                return;
            this.linkifyElement(el);
        });
        // Edit-mode hover and click handling
        this.registerDomEvent(document, 'mousemove', (evt) => {
            var _a;
            if (!this.settings.enableHoverPreview)
                return;
            const view = this.app.workspace.getActiveViewOfType(obsidian_1.MarkdownView);
            if (!view)
                return;
            if (!view.file || !this.isChapterFile(view.file))
                return;
            const editor = view.editor;
            const cm = editor === null || editor === void 0 ? void 0 : editor.cm;
            if (!cm || !(evt.target instanceof Node) || !((_a = cm.dom) === null || _a === void 0 ? void 0 : _a.contains(evt.target)))
                return;
            if (this.hoverTimer)
                window.clearTimeout(this.hoverTimer);
            this.hoverTimer = window.setTimeout(() => {
                const name = this.getEntityAtCoords(editor, evt.clientX, evt.clientY);
                if (!name) {
                    if (!this.getEntityAtCursor(editor)) {
                        this.clearFocus();
                    }
                    return;
                }
                if (name === this.lastHoverEntity)
                    return;
                this.lastHoverEntity = name;
                this.openEntityInSidebar(name, { reveal: false });
            }, 120);
        });
        const handleEntityClick = (evt) => {
            var _a;
            const view = this.app.workspace.getActiveViewOfType(obsidian_1.MarkdownView);
            if (!view)
                return;
            if (!view.file || !this.isChapterFile(view.file))
                return;
            const editor = view.editor;
            const cm = editor === null || editor === void 0 ? void 0 : editor.cm;
            if (!cm || !(evt.target instanceof Node) || !((_a = cm.dom) === null || _a === void 0 ? void 0 : _a.contains(evt.target)))
                return;
            if (!evt.ctrlKey && !evt.metaKey)
                return;
            const name = this.getEntityAtCoords(editor, evt.clientX, evt.clientY);
            if (name)
                this.openEntityInSidebar(name, { reveal: true });
        };
        this.registerDomEvent(document, 'mousedown', handleEntityClick);
        this.registerDomEvent(document, 'click', handleEntityClick);
        // Caret-driven focus update (edit mode)
        const handleCaret = () => {
            const view = this.app.workspace.getActiveViewOfType(obsidian_1.MarkdownView);
            if (!view)
                return;
            if (!view.file || !this.isChapterFile(view.file)) {
                this.clearFocus();
                return;
            }
            const editor = view.editor;
            const name = this.getEntityAtCursor(editor);
            if (name) {
                this.openEntityInSidebar(name, { reveal: false });
            }
            else {
                this.clearFocus();
            }
        };
        this.registerDomEvent(document, 'selectionchange', () => {
            if (this.caretTimer)
                window.clearTimeout(this.caretTimer);
            this.caretTimer = window.setTimeout(handleCaret, 120);
        });
        this.registerDomEvent(document, 'keyup', () => {
            if (this.caretTimer)
                window.clearTimeout(this.caretTimer);
            this.caretTimer = window.setTimeout(handleCaret, 120);
        });
        // Keep index up to date
        this.registerEvent(this.app.vault.on('create', () => this.refreshEntityIndex()));
        this.registerEvent(this.app.vault.on('delete', () => this.refreshEntityIndex()));
        this.registerEvent(this.app.vault.on('modify', () => this.refreshEntityIndex()));
        this.registerEvent(this.app.vault.on('rename', () => this.refreshEntityIndex()));
        // Auto-create chapter files when chapter descriptions appear
        this.registerEvent(this.app.vault.on('create', (file) => {
            if (file instanceof obsidian_1.TFile)
                this.ensureChapterFileForDesc(file);
        }));
        this.registerEvent(this.app.vault.on('rename', (file) => {
            if (file instanceof obsidian_1.TFile)
                this.ensureChapterFileForDesc(file);
        }));
        // Sync character/location references into chapter descriptions
        this.registerEvent(this.app.vault.on('modify', (file) => {
            if (file instanceof obsidian_1.TFile)
                this.syncChapterDescriptionFromChapter(file);
        }));
        this.registerEvent(this.app.vault.on('rename', (file) => {
            if (file instanceof obsidian_1.TFile)
                this.syncChapterDescriptionFromChapter(file);
        }));
        // Ensure character chapter info sections stay in sync with chapter descriptions
        this.registerEvent(this.app.vault.on('create', (file) => {
            if (file instanceof obsidian_1.TFile)
                this.syncCharacterChapterInfos(file);
        }));
        this.registerEvent(this.app.vault.on('rename', (file) => {
            if (file instanceof obsidian_1.TFile)
                this.syncCharacterChapterInfos(file);
        }));
        // Auto-activate sidebar if enabled
        if (this.settings.enableSidebarView) {
            this.activateView();
        }
        console.log('Novalist plugin loaded');
    }
    onunload() {
        this.app.workspace.detachLeavesOfType(exports.NOVELIST_SIDEBAR_VIEW_TYPE);
    }
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }
    async saveSettings() {
        await this.saveData(this.settings);
    }
    async activateView() {
        const { workspace } = this.app;
        let leaf = null;
        const leaves = workspace.getLeavesOfType(exports.NOVELIST_SIDEBAR_VIEW_TYPE);
        if (leaves.length > 0) {
            leaf = leaves[0];
        }
        else {
            leaf = workspace.getRightLeaf(false);
            await leaf.setViewState({ type: exports.NOVELIST_SIDEBAR_VIEW_TYPE, active: true });
        }
        workspace.revealLeaf(leaf);
    }
    async ensureSidebarView() {
        await this.activateView();
        return this.sidebarView;
    }
    // ==========================================
    // PROJECT STRUCTURE
    // ==========================================
    async initializeProjectStructure() {
        const vault = this.app.vault;
        const root = this.settings.projectPath;
        // Create main folders
        const folders = [
            `${root}/${this.settings.characterFolder}`,
            `${root}/${this.settings.locationFolder}`,
            `${root}/${this.settings.chapterDescFolder}`,
            `${root}/${this.settings.chapterFolder}`
        ];
        for (const folder of folders) {
            try {
                await vault.createFolder(folder);
            }
            catch (e) {
                // Folder might already exist
            }
        }
        // Create template files
        await this.createTemplateFiles();
        new obsidian_1.Notice('Novel project structure initialized!');
    }
    async createTemplateFiles() {
        const vault = this.app.vault;
        const root = this.settings.projectPath;
        // Character Template
        const charTemplate = `# Character Name Surname

## General Information
- **Age:** 
- **Relationship:** 

## Further Information

## Images

- Portrait: path/to/image.png
- Action Shot: path/to/another-image.jpg

## Chapter Relevant Information
- **Chapter 1**:
  - age: 
  - relationship: 
  - further_info: 
  - info: 
<!-- This section is auto-populated by the plugin -->
`;
        // Location Template
        const locTemplate = `---
name: 
images: []
---

# Location Info

## Description

## Images

## Appearances
<!-- Auto-populated list of chapters -->
`;
        // Chapter Description Template
        const chapDescTemplate = `---
name: 
order: 
outline: 
character_refs: []
location_refs: []
---

# Chapter Description

## Outline

## Character References
<!-- Auto-filled from chapter content -->

## Location References
<!-- Auto-filled from chapter content -->
`;
        // Chapter Template
        const chapterTemplate = `---
title: 
chapter_number: 
description: 
characters: []
locations: []
---

# Chapter Title

<!-- Write your chapter here -->
`;
        const templates = [
            { path: `${root}/Templates/Character Template.md`, content: charTemplate },
            { path: `${root}/Templates/Location Template.md`, content: locTemplate },
            { path: `${root}/Templates/Chapter Description Template.md`, content: chapDescTemplate },
            { path: `${root}/Templates/Chapter Template.md`, content: chapterTemplate },
            { path: `${root}/${this.settings.characterFolder}/_Character Template.md`, content: charTemplate },
            { path: `${root}/${this.settings.locationFolder}/_Location Template.md`, content: locTemplate },
            { path: `${root}/${this.settings.chapterDescFolder}/_Chapter Description Template.md`, content: chapDescTemplate },
            { path: `${root}/${this.settings.chapterFolder}/_Chapter Template.md`, content: chapterTemplate }
        ];
        try {
            await vault.createFolder(`${root}/Templates`);
        }
        catch (e) { }
        for (const tmpl of templates) {
            try {
                await vault.create(tmpl.path, tmpl.content);
            }
            catch (e) {
                // File might exist
            }
        }
    }
    // ==========================================
    // FILE CREATION
    // ==========================================
    async createCharacter(name, surname, age, relationship, furtherInfo) {
        const vault = this.app.vault;
        const folder = `${this.settings.projectPath}/${this.settings.characterFolder}`;
        const filename = `${name}_${surname}.md`;
        const filepath = `${folder}/${filename}`;
        const content = `# ${name} ${surname}

  ## General Information
  - **Age:** ${age}
  - **Relationship:** ${relationship}

  ## Further Information
  ${furtherInfo}

  ## Images

  - Portrait: path/to/image.png

  ## Chapter Relevant Information
  <!-- This section is auto-populated by the plugin -->
  `;
        try {
            await vault.create(filepath, content);
            new obsidian_1.Notice(`Character ${name} ${surname} created!`);
        }
        catch (e) {
            new obsidian_1.Notice('Error creating character: ' + e.message);
        }
    }
    async createLocation(name, description) {
        const vault = this.app.vault;
        const folder = `${this.settings.projectPath}/${this.settings.locationFolder}`;
        const filename = `${name}.md`;
        const filepath = `${folder}/${filename}`;
        const content = `---
name: ${name}
images: []
---

# ${name}

## Description
${description}

## Images

## Appearances
`;
        try {
            await vault.create(filepath, content);
            new obsidian_1.Notice(`Location ${name} created!`);
        }
        catch (e) {
            new obsidian_1.Notice('Error creating location: ' + e.message);
        }
    }
    async createChapterDescription(name, order, outline) {
        const vault = this.app.vault;
        const folder = `${this.settings.projectPath}/${this.settings.chapterDescFolder}`;
        const filename = `${name}.md`;
        const filepath = `${folder}/${filename}`;
        const content = `---
name: ${name}
order: ${order}
outline: ${outline}
character_refs: []
location_refs: []
---

# ${name}

## Outline
${outline}

## Character References
<!-- Auto-filled from chapter content -->

## Location References
<!-- Auto-filled from chapter content -->
`;
        try {
            await vault.create(filepath, content);
            new obsidian_1.Notice(`Chapter description ${name} created!`);
            const file = this.app.vault.getAbstractFileByPath(filepath);
            if (file instanceof obsidian_1.TFile) {
                await this.ensureChapterFileForDesc(file);
            }
        }
        catch (e) {
            new obsidian_1.Notice('Error creating chapter description: ' + e.message);
        }
    }
    openCharacterModal() {
        new CharacterModal(this.app, this).open();
    }
    openLocationModal() {
        new LocationModal(this.app, this).open();
    }
    openChapterDescriptionModal() {
        new ChapterDescriptionModal(this.app, this).open();
    }
    // ==========================================
    // PARSING LOGIC
    // ==========================================
    async parseCharacterFile(file) {
        const content = await this.app.vault.read(file);
        const textData = this.parseCharacterText(content);
        const chapterInfos = this.parseChapterOverrides(content);
        return {
            name: textData.name || '',
            surname: textData.surname || '',
            age: textData.age || '',
            relationship: textData.relationship || '',
            furtherInfo: textData.furtherInfo || '',
            chapterInfos
        };
    }
    async parseLocationFile(file) {
        const content = await this.app.vault.read(file);
        const frontmatter = this.parseFrontmatter(content);
        const descMatch = content.match(/## Description\s+([\s\S]*?)(?=##|$)/);
        const description = descMatch ? descMatch[1].trim() : '';
        return {
            name: frontmatter.name || '',
            description
        };
    }
    parseImagesSection(content) {
        const match = content.match(/## Images\s+([\s\S]*?)(?=##|$)/);
        if (!match)
            return [];
        const lines = match[1].split('\n').map(l => l.trim()).filter(l => l.startsWith('-'));
        const images = [];
        for (const line of lines) {
            const cleaned = line.replace(/^[-*]\s*/, '').trim();
            if (!cleaned)
                continue;
            const parts = cleaned.split(':');
            if (parts.length >= 2) {
                const name = parts.shift().trim();
                const path = parts.join(':').trim();
                if (name && path)
                    images.push({ name, path });
            }
            else {
                images.push({ name: cleaned, path: cleaned });
            }
        }
        return images;
    }
    parseCharacterText(content) {
        const body = this.stripFrontmatter(content);
        let name = '';
        let surname = '';
        let age = '';
        let relationship = '';
        let furtherInfo = '';
        const titleMatch = body.match(/^#\s+(.+)$/m);
        if (titleMatch) {
            const fullName = titleMatch[1].trim();
            const parts = fullName.split(' ');
            name = parts.shift() || '';
            surname = parts.join(' ');
        }
        const generalMatch = body.match(/## General Information\s+([\s\S]*?)(?=##|$)/);
        if (generalMatch) {
            const lines = generalMatch[1].split('\n').map(l => l.trim());
            for (const line of lines) {
                const ageMatch = line.match(/^[-*]\s*\*\*Age\*\*:\s*(.+)$/i);
                if (ageMatch) {
                    age = ageMatch[1].trim();
                    continue;
                }
                const relMatch = line.match(/^[-*]\s*\*\*Relationship\*\*:\s*(.+)$/i);
                if (relMatch) {
                    relationship = relMatch[1].trim();
                }
            }
        }
        const furtherMatch = body.match(/## Further Information\s+([\s\S]*?)(?=##|$)/);
        if (furtherMatch) {
            furtherInfo = furtherMatch[1].trim();
        }
        return { name, surname, age, relationship, furtherInfo };
    }
    parseChapterOverrides(content) {
        const section = content.match(/## Chapter Relevant Information\s+([\s\S]*?)(?=##|$)/);
        if (!section)
            return [];
        const lines = section[1].split('\n');
        const results = [];
        let current = null;
        let currentKey = null;
        for (const raw of lines) {
            const line = raw.trim();
            const chapterMatch = line.match(/^[-*]\s*\*\*([^*]+)\*\*(?:\s*\([^)]*\))?\s*:?\s*$/);
            if (chapterMatch) {
                if (current)
                    results.push(current);
                current = { chapter: chapterMatch[1].trim(), info: '', overrides: {} };
                currentKey = null;
                continue;
            }
            if (!current)
                continue;
            const kvMatch = line.match(/^[-*]\s*([^:]+):\s*(.*)$/);
            if (kvMatch) {
                const key = kvMatch[1].trim();
                const value = kvMatch[2].trim();
                currentKey = key.toLowerCase();
                if (currentKey === 'info') {
                    current.info = value;
                }
                else {
                    current.overrides[currentKey] = value;
                }
            }
            else if (/^\s{2,}\S/.test(raw) && currentKey) {
                const continuation = raw.trimEnd();
                if (currentKey === 'info') {
                    current.info = current.info ? `${current.info}\n${continuation.trim()}` : continuation.trim();
                }
                else {
                    const prev = current.overrides[currentKey] || '';
                    current.overrides[currentKey] = prev ? `${prev}\n${continuation.trim()}` : continuation.trim();
                }
            }
            else if (line.length > 0) {
                current.info = current.info ? `${current.info}\n${line}` : line;
            }
        }
        if (current)
            results.push(current);
        return results;
    }
    resolveImagePath(imagePath, sourcePath) {
        const linkpath = imagePath.replace(/^!\[\[|\]\]$/g, '').trim();
        const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
        if (dest && dest instanceof obsidian_1.TFile)
            return dest;
        const direct = this.app.vault.getAbstractFileByPath(linkpath);
        return direct instanceof obsidian_1.TFile ? direct : null;
    }
    async syncAllCharactersChapterInfos() {
        const folder = `${this.settings.projectPath}/${this.settings.characterFolder}`;
        const files = this.app.vault.getFiles().filter(f => f.path.startsWith(folder) && !this.isTemplateFile(f));
        for (const file of files) {
            await this.ensureCharacterChapterInfos(file);
        }
    }
    async syncCharacterChapterInfos(file) {
        const descFolder = `${this.settings.projectPath}/${this.settings.chapterDescFolder}`;
        if (!file.path.startsWith(descFolder))
            return;
        await this.syncAllCharactersChapterInfos();
    }
    async ensureCharacterChapterInfos(charFile) {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.path === charFile.path)
            return;
        const content = await this.app.vault.read(charFile);
        const chapters = await this.getChapterDescriptions();
        if (chapters.length === 0)
            return;
        const existing = this.parseChapterOverrides(content);
        const existingMap = new Map(existing.map(c => [c.chapter, c]));
        const formatValue = (value) => {
            if (!value)
                return '';
            if (!value.includes('\n'))
                return ` ${value}`;
            const lines = value.split('\n').map(l => l.trim());
            return `\n    ${lines.join('\n    ')}`;
        };
        const entries = chapters
            .map(c => {
            var _a, _b, _c, _d, _e, _f, _g;
            const prev = existingMap.get(c.name);
            const age = (_b = (_a = prev === null || prev === void 0 ? void 0 : prev.overrides) === null || _a === void 0 ? void 0 : _a.age) !== null && _b !== void 0 ? _b : '';
            const relationship = (_d = (_c = prev === null || prev === void 0 ? void 0 : prev.overrides) === null || _c === void 0 ? void 0 : _c.relationship) !== null && _d !== void 0 ? _d : '';
            const furtherInfo = (_f = (_e = prev === null || prev === void 0 ? void 0 : prev.overrides) === null || _e === void 0 ? void 0 : _e.further_info) !== null && _f !== void 0 ? _f : '';
            const info = (_g = prev === null || prev === void 0 ? void 0 : prev.info) !== null && _g !== void 0 ? _g : '';
            return `- **${c.name}**${c.order ? ` (Order: ${c.order})` : ''}:\n` +
                `  - age:${formatValue(age)}\n` +
                `  - relationship:${formatValue(relationship)}\n` +
                `  - further_info:${formatValue(furtherInfo)}\n` +
                `  - info:${formatValue(info)}`;
        })
            .join('\n');
        const section = content.match(/## Chapter Relevant Information\s+([\s\S]*?)(?=##|$)/);
        const newSection = `## Chapter Relevant Information\n${entries}\n`;
        if (!section) {
            const append = `\n${newSection}`;
            const updated = `${content.trim()}\n\n${append}`;
            if (updated !== content) {
                await this.app.vault.modify(charFile, updated);
            }
            return;
        }
        if (section[0] === newSection)
            return;
        const updated = content.replace(section[0], newSection);
        if (updated !== content) {
            await this.app.vault.modify(charFile, updated);
        }
    }
    async getChapterDescriptions() {
        const folder = `${this.settings.projectPath}/${this.settings.chapterDescFolder}`;
        const files = this.app.vault.getFiles().filter(f => f.path.startsWith(folder) && f.extension === 'md' && !f.basename.startsWith('_'));
        const chapters = [];
        for (const file of files) {
            const content = await this.app.vault.read(file);
            const fm = this.parseFrontmatter(content);
            const name = (fm.name || file.basename || '').toString().trim();
            const order = fm.order ? fm.order.toString().trim() : undefined;
            if (name)
                chapters.push({ name, order, file });
        }
        chapters.sort((a, b) => {
            const ao = a.order ? Number(a.order) : NaN;
            const bo = b.order ? Number(b.order) : NaN;
            if (!Number.isNaN(ao) && !Number.isNaN(bo) && ao !== bo)
                return ao - bo;
            if (!Number.isNaN(ao) && Number.isNaN(bo))
                return -1;
            if (Number.isNaN(ao) && !Number.isNaN(bo))
                return 1;
            return a.name.localeCompare(b.name);
        });
        return chapters;
    }
    async getChapterNameForFile(file) {
        const descFolder = `${this.settings.projectPath}/${this.settings.chapterDescFolder}`;
        const descPath = `${descFolder}/${file.basename}.md`;
        const descFile = this.app.vault.getAbstractFileByPath(descPath);
        if (descFile instanceof obsidian_1.TFile) {
            const descContent = await this.app.vault.read(descFile);
            const fm = this.parseFrontmatter(descContent);
            const name = (fm.name || descFile.basename || '').toString().trim();
            if (name)
                return name;
        }
        const content = await this.app.vault.read(file);
        const fm = this.parseFrontmatter(content);
        const title = (fm.title || file.basename || '').toString().trim();
        return title || file.basename;
    }
    async parseChapterFile(file) {
        const content = await this.app.vault.read(file);
        const frontmatter = this.parseFrontmatter(content);
        // Also scan content for character/location mentions
        const textContent = content.replace(/---[\s\S]*?---/, ''); // Remove frontmatter
        const characters = frontmatter.characters || [];
        const locations = frontmatter.locations || [];
        // Scan for mentions and link them
        const charFolder = `${this.settings.projectPath}/${this.settings.characterFolder}`;
        const locFolder = `${this.settings.projectPath}/${this.settings.locationFolder}`;
        // Get all character files to check for mentions
        const charFiles = this.app.vault.getFiles().filter(f => f.path.startsWith(charFolder) && !this.isTemplateFile(f));
        const locFiles = this.app.vault.getFiles().filter(f => f.path.startsWith(locFolder) && !this.isTemplateFile(f));
        for (const charFile of charFiles) {
            const charData = await this.parseCharacterFile(charFile);
            const fullName = `${charData.name} ${charData.surname}`;
            const searchName = charData.name;
            const searchSurname = charData.surname;
            if ((textContent.includes(fullName) || textContent.includes(searchName) || textContent.includes(searchSurname))
                && !characters.includes(fullName)) {
                characters.push(fullName);
            }
        }
        for (const locFile of locFiles) {
            const locData = await this.parseLocationFile(locFile);
            if (textContent.includes(locData.name) && !locations.includes(locData.name)) {
                locations.push(locData.name);
            }
        }
        return { characters, locations };
    }
    parseFrontmatter(content) {
        const fmBlock = this.extractFrontmatter(content);
        if (!fmBlock)
            return {};
        const fm = {};
        const lines = fmBlock.split('\n');
        for (const line of lines) {
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const key = line.substring(0, colonIndex).trim();
                let value = line.substring(colonIndex + 1).trim();
                // Handle arrays
                if (value.startsWith('[') && value.endsWith(']')) {
                    value = value.slice(1, -1).split(',').map((v) => v.trim()).filter((v) => v);
                }
                fm[key] = value;
            }
        }
        return fm;
    }
    async findCharacterFile(name) {
        const folder = `${this.settings.projectPath}/${this.settings.characterFolder}`;
        const files = this.app.vault.getFiles().filter(f => f.path.startsWith(folder) && !this.isTemplateFile(f));
        for (const file of files) {
            const data = await this.parseCharacterFile(file);
            const fullName = `${data.name} ${data.surname}`;
            if (fullName === name || data.name === name || data.surname === name) {
                return file;
            }
        }
        return null;
    }
    async findLocationFile(name) {
        const folder = `${this.settings.projectPath}/${this.settings.locationFolder}`;
        const files = this.app.vault.getFiles().filter(f => f.path.startsWith(folder) && !this.isTemplateFile(f));
        for (const file of files) {
            const data = await this.parseLocationFile(file);
            if (data.name === name) {
                return file;
            }
        }
        return null;
    }
    // ==========================================
    // AUTO REPLACEMENT
    // ==========================================
    handleAutoReplacement() {
        const activeView = this.app.workspace.getActiveViewOfType(obsidian_1.MarkdownView);
        if (!activeView)
            return;
        const file = activeView.file;
        if (!file || !this.isChapterFile(file))
            return;
        const editor = activeView.editor;
        if (this.isCursorInFrontmatter(editor))
            return;
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        let modified = false;
        let newLine = line;
        for (const [shortcut, replacement] of Object.entries(this.settings.autoReplacements)) {
            if (newLine.includes(shortcut)) {
                newLine = newLine.replace(shortcut, replacement);
                modified = true;
            }
        }
        if (modified) {
            editor.setLine(cursor.line, newLine);
            // Restore cursor position
            const diff = newLine.length - line.length;
            editor.setCursor({ line: cursor.line, ch: cursor.ch + diff });
        }
    }
    isCursorInFrontmatter(editor) {
        var _a, _b;
        const cursor = editor.getCursor();
        let inFrontmatter = false;
        for (let i = 0; i <= cursor.line; i++) {
            const text = (_b = (_a = editor.getLine(i)) === null || _a === void 0 ? void 0 : _a.trim()) !== null && _b !== void 0 ? _b : '';
            if (text.length === 0)
                continue;
            if (/^[-—–]{3,}\s*$/.test(text)) {
                inFrontmatter = !inFrontmatter;
            }
            if (!inFrontmatter && i < cursor.line) {
                // past frontmatter
                break;
            }
        }
        return inFrontmatter;
    }
    // ==========================================
    // AUTO LINKING / HOVER SUPPORT
    // ==========================================
    async refreshEntityIndex() {
        const index = new Map();
        const charFolder = `${this.settings.projectPath}/${this.settings.characterFolder}`;
        const locFolder = `${this.settings.projectPath}/${this.settings.locationFolder}`;
        const charFiles = this.app.vault.getFiles().filter(f => f.path.startsWith(charFolder) && !this.isTemplateFile(f));
        const locFiles = this.app.vault.getFiles().filter(f => f.path.startsWith(locFolder) && !this.isTemplateFile(f));
        for (const charFile of charFiles) {
            try {
                const data = await this.parseCharacterFile(charFile);
                const fullName = `${data.name} ${data.surname}`.trim();
                if (fullName)
                    index.set(fullName.toLowerCase(), { path: charFile.path, display: fullName });
                if (data.name)
                    index.set(data.name.toLowerCase(), { path: charFile.path, display: data.name });
                if (data.surname)
                    index.set(data.surname.toLowerCase(), { path: charFile.path, display: data.surname });
                if (charFile.basename)
                    index.set(charFile.basename.toLowerCase(), { path: charFile.path, display: fullName || charFile.basename });
            }
            catch (e) {
                // ignore parse errors
            }
        }
        for (const locFile of locFiles) {
            try {
                const data = await this.parseLocationFile(locFile);
                if (data.name)
                    index.set(data.name.toLowerCase(), { path: locFile.path, display: data.name });
                if (locFile.basename)
                    index.set(locFile.basename.toLowerCase(), { path: locFile.path, display: data.name || locFile.basename });
            }
            catch (e) {
                // ignore parse errors
            }
        }
        this.entityIndex = index;
        this.entityRegex = this.buildEntityRegex([...index.keys()]);
    }
    buildEntityRegex(names) {
        if (names.length === 0)
            return null;
        const unique = Array.from(new Set(names))
            .filter(n => n.length > 0)
            .sort((a, b) => b.length - a.length)
            .map(n => this.escapeRegex(n));
        if (unique.length === 0)
            return null;
        return new RegExp(`(${unique.join('|')})`, 'gi');
    }
    escapeRegex(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    isWordChar(ch) {
        return !!ch && /[A-Za-z0-9_]/.test(ch);
    }
    getWordAtCursor(editor) {
        const cursor = editor.getCursor();
        const lineText = editor.getLine(cursor.line);
        if (!lineText)
            return null;
        let start = cursor.ch;
        let end = cursor.ch;
        while (start > 0 && this.isWordChar(lineText[start - 1]))
            start--;
        while (end < lineText.length && this.isWordChar(lineText[end]))
            end++;
        const word = lineText.slice(start, end).trim();
        return word.length > 0 ? word : null;
    }
    getEntityAtCursor(editor) {
        const cursor = editor.getCursor();
        const lineText = editor.getLine(cursor.line);
        if (!lineText)
            return null;
        return this.findEntityAtPosition(lineText, cursor.ch);
    }
    getWordAtCoords(editor, x, y) {
        const pos = this.getPosAtCoords(editor, x, y);
        if (!pos)
            return null;
        const { lineText, ch } = pos;
        let start = ch;
        let end = ch;
        while (start > 0 && this.isWordChar(lineText[start - 1]))
            start--;
        while (end < lineText.length && this.isWordChar(lineText[end]))
            end++;
        const word = lineText.slice(start, end).trim();
        return word.length > 0 ? word : null;
    }
    getEntityAtCoords(editor, x, y) {
        var _a;
        const pos = this.getPosAtCoords(editor, x, y);
        if (!pos)
            return null;
        const { lineText, ch } = pos;
        return (_a = this.findEntityAtPosition(lineText, ch)) !== null && _a !== void 0 ? _a : this.getWordAtCoords(editor, x, y);
    }
    getPosAtCoords(editor, x, y) {
        var _a;
        const cm = editor === null || editor === void 0 ? void 0 : editor.cm;
        if (!(cm === null || cm === void 0 ? void 0 : cm.posAtCoords) || !((_a = cm === null || cm === void 0 ? void 0 : cm.state) === null || _a === void 0 ? void 0 : _a.doc))
            return null;
        const pos = cm.posAtCoords({ x, y });
        if (pos == null)
            return null;
        const line = cm.state.doc.lineAt(pos);
        const lineText = line.text;
        const ch = pos - line.from;
        return { lineText, ch };
    }
    findEntityAtPosition(lineText, ch) {
        if (!this.entityRegex)
            return null;
        const regex = new RegExp(this.entityRegex.source, 'gi');
        let match;
        while ((match = regex.exec(lineText)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            if (ch < start || ch > end)
                continue;
            const before = start > 0 ? lineText[start - 1] : undefined;
            const after = end < lineText.length ? lineText[end] : undefined;
            if (this.isWordChar(before) || this.isWordChar(after))
                continue;
            return match[0];
        }
        return null;
    }
    stripFrontmatter(content) {
        const extracted = this.extractFrontmatterAndBody(content);
        return extracted ? extracted.body : content;
    }
    stripChapterRelevantSection(content) {
        return content.replace(/## Chapter Relevant Information\s+[\s\S]*?(?=##|$)/, '').trim();
    }
    stripImagesSection(content) {
        return content.replace(/## Images\s+[\s\S]*?(?=##|$)/, '').trim();
    }
    extractTitle(content) {
        const match = content.match(/^#\s+(.+)$/m);
        return match ? match[1].trim() : null;
    }
    removeTitle(content) {
        return content.replace(/^#\s+.+\n?/, '').trim();
    }
    applyCharacterOverridesToBody(content, overrides) {
        if (!overrides || Object.keys(overrides).length === 0)
            return content;
        return content.replace(/## General Information\s+([\s\S]*?)(?=##|$)/, (match, section) => {
            const lines = section.split('\n');
            const filtered = lines.filter(line => {
                const trimmed = line.trim();
                if (!trimmed)
                    return true;
                if (/\*\*Age\*\*:/i.test(trimmed))
                    return false;
                if (/\*\*Relationship\*\*:/i.test(trimmed))
                    return false;
                return true;
            });
            if (overrides.age) {
                filtered.push(`- **Age:** ${overrides.age}`);
            }
            if (overrides.relationship) {
                filtered.push(`- **Relationship:** ${overrides.relationship}`);
            }
            const updated = filtered.join('\n').trim();
            return `## General Information\n${updated}\n`;
        });
    }
    extractFrontmatter(content) {
        const extracted = this.extractFrontmatterAndBody(content);
        return extracted ? extracted.frontmatter : null;
    }
    extractFrontmatterAndBody(content) {
        const lines = content.split('\n');
        if (lines.length === 0)
            return null;
        const isDelimiter = (line) => /^[-—–]{3,}\s*$/.test(line.trim());
        if (!isDelimiter(lines[0]))
            return null;
        let endIndex = -1;
        for (let i = 1; i < lines.length; i++) {
            if (isDelimiter(lines[i])) {
                endIndex = i;
                break;
            }
        }
        if (endIndex === -1)
            return null;
        const frontmatter = lines.slice(1, endIndex).join('\n');
        const body = lines.slice(endIndex + 1).join('\n');
        return { frontmatter, body };
    }
    isChapterFile(file) {
        const folder = `${this.settings.projectPath}/${this.settings.chapterFolder}`;
        if (!file.path.startsWith(folder))
            return false;
        if (file.extension !== 'md')
            return false;
        if (file.basename.startsWith('_'))
            return false;
        return true;
    }
    isChapterPath(path) {
        const folder = `${this.settings.projectPath}/${this.settings.chapterFolder}`;
        if (!path.startsWith(folder))
            return false;
        if (!path.endsWith('.md'))
            return false;
        const base = path.split('/').pop() || '';
        if (base.startsWith('_'))
            return false;
        return true;
    }
    isTemplateFile(file) {
        if (file.basename.startsWith('_'))
            return true;
        const templatesPath = `${this.settings.projectPath}/Templates/`;
        if (file.path.startsWith(templatesPath))
            return true;
        return false;
    }
    async syncChapterDescriptionFromChapter(chapterFile) {
        if (!this.isChapterFile(chapterFile))
            return;
        const descFolder = `${this.settings.projectPath}/${this.settings.chapterDescFolder}`;
        const descPath = `${descFolder}/${chapterFile.basename}.md`;
        const descFile = this.app.vault.getAbstractFileByPath(descPath);
        if (!descFile || !(descFile instanceof obsidian_1.TFile))
            return;
        const chapterData = await this.parseChapterFile(chapterFile);
        const content = await this.app.vault.read(descFile);
        const fm = this.parseFrontmatter(content);
        fm.character_refs = chapterData.characters;
        fm.location_refs = chapterData.locations;
        const fmLines = Object.entries(fm)
            .map(([key, value]) => {
            if (Array.isArray(value))
                return `${key}: [${value.join(', ')}]`;
            return `${key}: ${value}`;
        })
            .join('\n');
        const newFrontmatter = `---\n${fmLines}\n---`;
        const body = this.stripFrontmatter(content);
        const charList = chapterData.characters.length
            ? chapterData.characters.map(c => `- [[${c}]]`).join('\n')
            : '- None';
        const locList = chapterData.locations.length
            ? chapterData.locations.map(l => `- [[${l}]]`).join('\n')
            : '- None';
        let newBody = body;
        if (/## Character References\s+[\s\S]*?(?=##|$)/.test(newBody)) {
            newBody = newBody.replace(/## Character References\s+[\s\S]*?(?=##|$)/, `## Character References\n${charList}\n\n`);
        }
        else {
            newBody += `\n## Character References\n${charList}\n`;
        }
        if (/## Location References\s+[\s\S]*?(?=##|$)/.test(newBody)) {
            newBody = newBody.replace(/## Location References\s+[\s\S]*?(?=##|$)/, `## Location References\n${locList}\n\n`);
        }
        else {
            newBody += `\n## Location References\n${locList}\n`;
        }
        const updated = `${newFrontmatter}\n\n${newBody.trim()}\n`;
        await this.app.vault.modify(descFile, updated);
    }
    isChapterDescriptionFile(file) {
        const folder = `${this.settings.projectPath}/${this.settings.chapterDescFolder}`;
        if (!file.path.startsWith(folder))
            return false;
        if (file.extension !== 'md')
            return false;
        if (file.basename.startsWith('_'))
            return false;
        return true;
    }
    async ensureChapterFileForDesc(descFile) {
        if (!this.isChapterDescriptionFile(descFile))
            return;
        const chapterFolder = `${this.settings.projectPath}/${this.settings.chapterFolder}`;
        const chapterPath = `${chapterFolder}/${descFile.basename}.md`;
        const existing = this.app.vault.getAbstractFileByPath(chapterPath);
        if (existing)
            return;
        let title = descFile.basename;
        let chapterNumber = '';
        let description = '';
        try {
            const content = await this.app.vault.read(descFile);
            const fm = this.parseFrontmatter(content);
            if (fm.name)
                title = fm.name;
            if (fm.order)
                chapterNumber = fm.order;
            if (fm.outline)
                description = fm.outline;
        }
        catch (e) {
            // ignore parsing errors
        }
        const chapterContent = `---
title: ${title}
chapter_number: ${chapterNumber}
description: ${description}
characters: []
locations: []
---

# ${title}

<!-- Write your chapter here -->
`;
        try {
            await this.app.vault.create(chapterPath, chapterContent);
            new obsidian_1.Notice(`Chapter created for ${descFile.basename}`);
        }
        catch (e) {
            const message = (e && e.message) ? e.message.toString() : '';
            if (message.toLowerCase().includes('already exists'))
                return;
            new obsidian_1.Notice('Error creating chapter file: ' + message);
        }
    }
    async openEntityFromEditor() {
        var _a;
        const view = this.app.workspace.getActiveViewOfType(obsidian_1.MarkdownView);
        if (!view)
            return;
        const editor = view.editor;
        const selection = (_a = editor.getSelection()) === null || _a === void 0 ? void 0 : _a.trim();
        const word = selection && selection.length > 0 ? selection : this.getWordAtCursor(editor);
        if (word)
            await this.openEntityInSidebar(word, { reveal: true });
    }
    async focusEntityByName(name, reveal = true) {
        return this.openEntityInSidebar(name, { reveal });
    }
    clearFocus() {
        if (!this.sidebarView)
            return;
        if (!this.sidebarView.selectedEntity)
            return;
        this.lastHoverEntity = null;
        this.sidebarView.setSelectedEntity(null, { forceFocus: false });
    }
    normalizeEntityName(name) {
        let n = name.trim();
        if (n.startsWith('[[') && n.endsWith(']]'))
            n = n.slice(2, -2);
        if (n.includes('|'))
            n = n.split('|')[0];
        n = n.replace(/\.md$/i, '');
        if (n.includes('/'))
            n = n.split('/').pop() || n;
        return n.trim();
    }
    async openEntityInSidebar(name, options) {
        const lookup = this.normalizeEntityName(name).toLowerCase();
        if (!lookup)
            return false;
        const entity = this.entityIndex.get(lookup);
        if (!entity)
            return false;
        const file = this.app.vault.getAbstractFileByPath(entity.path);
        if (!file || !(file instanceof obsidian_1.TFile))
            return false;
        const type = entity.path.includes(`/${this.settings.characterFolder}/`) ? 'character' : 'location';
        const sidebar = await this.ensureSidebarView();
        if (!sidebar)
            return false;
        sidebar.setSelectedEntity({ type, file, display: entity.display }, { forceFocus: true });
        if (options === null || options === void 0 ? void 0 : options.reveal) {
            await this.activateView();
        }
        return true;
    }
    linkifyElement(el) {
        var _a;
        if (!this.entityRegex || this.entityIndex.size === 0)
            return;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                const parent = node.parentElement;
                if (!parent)
                    return NodeFilter.FILTER_REJECT;
                if (parent.closest('a, code, pre, .cm-inline-code, .cm-hmd-codeblock'))
                    return NodeFilter.FILTER_REJECT;
                if (!node.nodeValue || !node.nodeValue.trim())
                    return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        const textNodes = [];
        while (walker.nextNode()) {
            textNodes.push(walker.currentNode);
        }
        for (const node of textNodes) {
            const text = node.nodeValue || '';
            const regex = this.entityRegex;
            if (!regex.test(text)) {
                regex.lastIndex = 0;
                continue;
            }
            regex.lastIndex = 0;
            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            let match;
            while ((match = regex.exec(text)) !== null) {
                const matchText = match[0];
                const start = match.index;
                const end = start + matchText.length;
                const before = start > 0 ? text[start - 1] : undefined;
                const after = end < text.length ? text[end] : undefined;
                if (this.isWordChar(before) || this.isWordChar(after)) {
                    continue;
                }
                if (start > lastIndex) {
                    fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
                }
                const key = matchText.toLowerCase();
                const entity = this.entityIndex.get(key);
                if (entity) {
                    const link = document.createElement('a');
                    link.className = 'internal-link';
                    link.setAttribute('data-href', entity.path);
                    link.setAttribute('href', entity.path);
                    link.textContent = matchText;
                    fragment.appendChild(link);
                }
                else {
                    fragment.appendChild(document.createTextNode(matchText));
                }
                lastIndex = end;
            }
            if (lastIndex < text.length) {
                fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
            }
            (_a = node.parentNode) === null || _a === void 0 ? void 0 : _a.replaceChild(fragment, node);
        }
    }
}
exports.default = NovalistPlugin;
//# sourceMappingURL=main.js.map