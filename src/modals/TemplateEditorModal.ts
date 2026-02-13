import {
  Modal,
  App,
  Setting,
  ButtonComponent,
  TextAreaComponent
} from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';
import type {
  CharacterTemplate,
  LocationTemplate
} from '../types';
import {
  CHARACTER_TEMPLATE_KNOWN_FIELDS,
  LOCATION_TEMPLATE_KNOWN_FIELDS,
} from '../types';

// ── Character Template Editor ─────────────────────────────────────────

export class CharacterTemplateEditorModal extends Modal {
  plugin: NovalistPlugin;
  template: CharacterTemplate;
  onSave: (template: CharacterTemplate) => void | Promise<void>;

  constructor(app: App, plugin: NovalistPlugin, template: CharacterTemplate, onSave: (t: CharacterTemplate) => void | Promise<void>) {
    super(app);
    this.plugin = plugin;
    // Deep clone so edits can be cancelled
    this.template = {
      ...template,
      fields: template.fields.map(f => ({ ...f })),
      customProperties: { ...template.customProperties },
      sections: template.sections.map(s => ({ ...s })),
    };
    this.onSave = onSave;
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const scrollEl = this.modalEl;
    const scrollTop = scrollEl.scrollTop;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('novalist-template-editor');

    contentEl.createEl('h2', { text: t('template.editCharacterTemplate') });

    // ── Template name ──────────────────────────────────────────────
    new Setting(contentEl)
      .setName(t('template.templateName'))
      .addText(text => text
        .setValue(this.template.name)
        .setDisabled(this.template.builtIn)
        .onChange(value => { this.template.name = value; }));

    // ── Fields ─────────────────────────────────────────────────────
    new Setting(contentEl)
      .setName(t('template.fields'))
      .setHeading();

    const activeKeys = new Set(this.template.fields.map(f => f.key));

    for (const knownKey of CHARACTER_TEMPLATE_KNOWN_FIELDS) {
      const isActive = activeKeys.has(knownKey);
      const field = this.template.fields.find(f => f.key === knownKey);

      const row = new Setting(contentEl)
        .setName(knownKey)
        .addToggle(toggle => toggle
          .setValue(isActive)
          .onChange(value => {
            if (value) {
              this.template.fields.push({ key: knownKey, defaultValue: '' });
            } else {
              this.template.fields = this.template.fields.filter(f => f.key !== knownKey);
            }
            this.render();
          }));

      if (isActive && field) {
        row.addText(text => text
          .setPlaceholder(t('template.defaultValue'))
          .setValue(field.defaultValue)
          .onChange(value => { field.defaultValue = value; }));
      }
    }

    // Custom fields (not in known list)
    const customFields = this.template.fields.filter(f => !CHARACTER_TEMPLATE_KNOWN_FIELDS.includes(f.key));
    for (const field of customFields) {
      new Setting(contentEl)
        .addText(text => text
          .setPlaceholder(t('template.fieldKey'))
          .setValue(field.key)
          .onChange(value => { field.key = value; }))
        .addText(text => text
          .setPlaceholder(t('template.defaultValue'))
          .setValue(field.defaultValue)
          .onChange(value => { field.defaultValue = value; }))
        .addButton(btn => btn
          .setIcon('trash')
          .setTooltip(t('template.removeField'))
          .onClick(() => {
            this.template.fields = this.template.fields.filter(f => f !== field);
            this.render();
          }));
    }

    new ButtonComponent(contentEl)
      .setButtonText(t('template.addCustomField'))
      .onClick(() => {
        this.template.fields.push({ key: '', defaultValue: '' });
        this.render();
      });

    // ── Options ────────────────────────────────────────────────────
    new Setting(contentEl)
      .setName(t('template.options'))
      .setHeading();

    new Setting(contentEl)
      .setName(t('template.includeRelationships'))
      .addToggle(toggle => toggle
        .setValue(this.template.includeRelationships)
        .onChange(value => { this.template.includeRelationships = value; }));

    new Setting(contentEl)
      .setName(t('template.includeImages'))
      .addToggle(toggle => toggle
        .setValue(this.template.includeImages)
        .onChange(value => { this.template.includeImages = value; }));

    new Setting(contentEl)
      .setName(t('template.includeChapterOverrides'))
      .addToggle(toggle => toggle
        .setValue(this.template.includeChapterOverrides)
        .onChange(value => { this.template.includeChapterOverrides = value; }));

    // ── Default custom properties ──────────────────────────────────
    this.renderCustomProperties(contentEl);

    // ── Sections ───────────────────────────────────────────────────
    this.renderSections(contentEl);

    // ── Buttons ────────────────────────────────────────────────────
    const buttonDiv = contentEl.createDiv('modal-button-container');

    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.cancel'))
      .onClick(() => this.close());

    new ButtonComponent(buttonDiv)
      .setButtonText(t('template.save'))
      .setCta()
      .onClick(() => {
        // Remove fields with empty keys
        this.template.fields = this.template.fields.filter(f => f.key.trim() !== '');
        void this.onSave(this.template);
        this.close();
      });

    // Restore scroll position after re-render
    window.requestAnimationFrame(() => {
      scrollEl.scrollTop = scrollTop;
    });
  }

  private renderCustomProperties(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t('template.defaultCustomProperties'))
      .setHeading();

    const entries = Object.entries(this.template.customProperties);
    for (const [key, value] of entries) {
      new Setting(containerEl)
        .addText(text => text
          .setPlaceholder(t('template.propertyName'))
          .setValue(key)
          .onChange(newKey => {
            const val = this.template.customProperties[key];
            delete this.template.customProperties[key];
            this.template.customProperties[newKey] = val;
          }))
        .addText(text => text
          .setPlaceholder(t('template.propertyValue'))
          .setValue(value)
          .onChange(newVal => {
            // Find the current key — it may have been renamed
            const currentKey = Object.keys(this.template.customProperties).find(k =>
              this.template.customProperties[k] === value
            ) ?? key;
            this.template.customProperties[currentKey] = newVal;
          }))
        .addButton(btn => btn
          .setIcon('trash')
          .setTooltip(t('template.removeProperty'))
          .onClick(() => {
            delete this.template.customProperties[key];
            this.render();
          }));
    }

    new ButtonComponent(containerEl)
      .setButtonText(t('template.addProperty'))
      .onClick(() => {
        const idx = Object.keys(this.template.customProperties).length + 1;
        this.template.customProperties[`prop${idx}`] = '';
        this.render();
      });
  }

  private renderSections(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t('template.sections'))
      .setHeading();

    for (let i = 0; i < this.template.sections.length; i++) {
      const section = this.template.sections[i];
      const sectionContainer = containerEl.createDiv('novalist-template-section');

      new Setting(sectionContainer)
        .setName(t('template.sectionTitle'))
        .addText(text => text
          .setValue(section.title)
          .onChange(value => { section.title = value; }))
        .addButton(btn => btn
          .setIcon('trash')
          .setTooltip(t('template.removeSection'))
          .onClick(() => {
            this.template.sections.splice(i, 1);
            this.render();
          }));

      const ta = new TextAreaComponent(sectionContainer);
      ta.setPlaceholder(t('template.sectionDefaultContent'));
      ta.setValue(section.defaultContent);
      ta.onChange(value => { section.defaultContent = value; });
      ta.inputEl.rows = 3;
      ta.inputEl.classList.add('novalist-template-textarea');
    }

    new ButtonComponent(containerEl)
      .setButtonText(t('template.addSection'))
      .onClick(() => {
        this.template.sections.push({ title: '', defaultContent: '' });
        this.render();
      });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// ── Location Template Editor ──────────────────────────────────────────

export class LocationTemplateEditorModal extends Modal {
  plugin: NovalistPlugin;
  template: LocationTemplate;
  onSave: (template: LocationTemplate) => void | Promise<void>;

  constructor(app: App, plugin: NovalistPlugin, template: LocationTemplate, onSave: (t: LocationTemplate) => void | Promise<void>) {
    super(app);
    this.plugin = plugin;
    this.template = {
      ...template,
      fields: template.fields.map(f => ({ ...f })),
      customProperties: { ...template.customProperties },
      sections: template.sections.map(s => ({ ...s })),
    };
    this.onSave = onSave;
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const scrollEl = this.modalEl;
    const scrollTop = scrollEl.scrollTop;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('novalist-template-editor');

    contentEl.createEl('h2', { text: t('template.editLocationTemplate') });

    // ── Template name ──────────────────────────────────────────────
    new Setting(contentEl)
      .setName(t('template.templateName'))
      .addText(text => text
        .setValue(this.template.name)
        .setDisabled(this.template.builtIn)
        .onChange(value => { this.template.name = value; }));

    // ── Fields ─────────────────────────────────────────────────────
    new Setting(contentEl)
      .setName(t('template.fields'))
      .setHeading();

    const activeKeys = new Set(this.template.fields.map(f => f.key));

    for (const knownKey of LOCATION_TEMPLATE_KNOWN_FIELDS) {
      const isActive = activeKeys.has(knownKey);
      const field = this.template.fields.find(f => f.key === knownKey);

      const row = new Setting(contentEl)
        .setName(knownKey)
        .addToggle(toggle => toggle
          .setValue(isActive)
          .onChange(value => {
            if (value) {
              this.template.fields.push({ key: knownKey, defaultValue: '' });
            } else {
              this.template.fields = this.template.fields.filter(f => f.key !== knownKey);
            }
            this.render();
          }));

      if (isActive && field) {
        row.addText(text => text
          .setPlaceholder(t('template.defaultValue'))
          .setValue(field.defaultValue)
          .onChange(value => { field.defaultValue = value; }));
      }
    }

    // Custom fields
    const customFields = this.template.fields.filter(f => !LOCATION_TEMPLATE_KNOWN_FIELDS.includes(f.key));
    for (const field of customFields) {
      new Setting(contentEl)
        .addText(text => text
          .setPlaceholder(t('template.fieldKey'))
          .setValue(field.key)
          .onChange(value => { field.key = value; }))
        .addText(text => text
          .setPlaceholder(t('template.defaultValue'))
          .setValue(field.defaultValue)
          .onChange(value => { field.defaultValue = value; }))
        .addButton(btn => btn
          .setIcon('trash')
          .setTooltip(t('template.removeField'))
          .onClick(() => {
            this.template.fields = this.template.fields.filter(f => f !== field);
            this.render();
          }));
    }

    new ButtonComponent(contentEl)
      .setButtonText(t('template.addCustomField'))
      .onClick(() => {
        this.template.fields.push({ key: '', defaultValue: '' });
        this.render();
      });

    // ── Options ────────────────────────────────────────────────────
    new Setting(contentEl)
      .setName(t('template.options'))
      .setHeading();

    new Setting(contentEl)
      .setName(t('template.includeImages'))
      .addToggle(toggle => toggle
        .setValue(this.template.includeImages)
        .onChange(value => { this.template.includeImages = value; }));

    // ── Default custom properties ──────────────────────────────────
    this.renderCustomProperties(contentEl);

    // ── Sections ───────────────────────────────────────────────────
    this.renderSections(contentEl);

    // ── Buttons ────────────────────────────────────────────────────
    const buttonDiv = contentEl.createDiv('modal-button-container');

    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.cancel'))
      .onClick(() => this.close());

    new ButtonComponent(buttonDiv)
      .setButtonText(t('template.save'))
      .setCta()
      .onClick(() => {
        this.template.fields = this.template.fields.filter(f => f.key.trim() !== '');
        void this.onSave(this.template);
        this.close();
      });

    // Restore scroll position after re-render
    window.requestAnimationFrame(() => {
      scrollEl.scrollTop = scrollTop;
    });
  }

  private renderCustomProperties(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t('template.defaultCustomProperties'))
      .setHeading();

    const entries = Object.entries(this.template.customProperties);
    for (const [key, value] of entries) {
      new Setting(containerEl)
        .addText(text => text
          .setPlaceholder(t('template.propertyName'))
          .setValue(key)
          .onChange(newKey => {
            const val = this.template.customProperties[key];
            delete this.template.customProperties[key];
            this.template.customProperties[newKey] = val;
          }))
        .addText(text => text
          .setPlaceholder(t('template.propertyValue'))
          .setValue(value)
          .onChange(newVal => {
            const currentKey = Object.keys(this.template.customProperties).find(k =>
              this.template.customProperties[k] === value
            ) ?? key;
            this.template.customProperties[currentKey] = newVal;
          }))
        .addButton(btn => btn
          .setIcon('trash')
          .setTooltip(t('template.removeProperty'))
          .onClick(() => {
            delete this.template.customProperties[key];
            this.render();
          }));
    }

    new ButtonComponent(containerEl)
      .setButtonText(t('template.addProperty'))
      .onClick(() => {
        const idx = Object.keys(this.template.customProperties).length + 1;
        this.template.customProperties[`prop${idx}`] = '';
        this.render();
      });
  }

  private renderSections(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t('template.sections'))
      .setHeading();

    for (let i = 0; i < this.template.sections.length; i++) {
      const section = this.template.sections[i];
      const sectionContainer = containerEl.createDiv('novalist-template-section');

      new Setting(sectionContainer)
        .setName(t('template.sectionTitle'))
        .addText(text => text
          .setValue(section.title)
          .onChange(value => { section.title = value; }))
        .addButton(btn => btn
          .setIcon('trash')
          .setTooltip(t('template.removeSection'))
          .onClick(() => {
            this.template.sections.splice(i, 1);
            this.render();
          }));

      const ta = new TextAreaComponent(sectionContainer);
      ta.setPlaceholder(t('template.sectionDefaultContent'));
      ta.setValue(section.defaultContent);
      ta.onChange(value => { section.defaultContent = value; });
      ta.inputEl.rows = 3;
      ta.inputEl.classList.add('novalist-template-textarea');
    }

    new ButtonComponent(containerEl)
      .setButtonText(t('template.addSection'))
      .onClick(() => {
        this.template.sections.push({ title: '', defaultContent: '' });
        this.render();
      });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
