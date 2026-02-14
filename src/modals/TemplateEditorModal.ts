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
  LocationTemplate,
  CustomPropertyDefinition,
  CustomPropertyType,
  IntervalUnit
} from '../types';
import {
  CHARACTER_TEMPLATE_KNOWN_FIELDS,
  LOCATION_TEMPLATE_KNOWN_FIELDS,
  CUSTOM_PROPERTY_TYPES,
  INTERVAL_UNITS,
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
      customPropertyDefs: (template.customPropertyDefs ?? []).map(clonePropertyDef),
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
              if (knownKey === 'Age') {
                this.template.ageMode = undefined;
                this.template.ageIntervalUnit = undefined;
              }
            }
            this.render();
          }));

      if (isActive && field) {
        // Age field gets a mode dropdown instead of a plain text default
        if (knownKey === 'Age') {
          row.addDropdown(dropdown => {
            const mode = this.template.ageMode ?? 'number';
            dropdown.addOption('number', t('template.ageMode.number'));
            dropdown.addOption('date', t('template.ageMode.date'));
            dropdown.setValue(mode);
            dropdown.onChange(value => {
              this.template.ageMode = value as 'number' | 'date';
              if (value === 'date' && !this.template.ageIntervalUnit) {
                this.template.ageIntervalUnit = 'years';
              }
              this.render();
            });
          });
        } else {
          row.addText(text => text
            .setPlaceholder(t('template.defaultValue'))
            .setValue(field.defaultValue)
            .onChange(value => { field.defaultValue = value; }));
        }
      }

      // Show interval unit dropdown for Age in date mode
      if (knownKey === 'Age' && isActive && this.template.ageMode === 'date') {
        new Setting(contentEl)
          .setClass('novalist-template-interval-row')
          .setName(t('template.intervalUnit'))
          .addDropdown(dropdown => {
            for (const u of INTERVAL_UNITS) {
              const labelKey = `template.intervalUnit.${u}` as Parameters<typeof t>[0];
              dropdown.addOption(u, t(labelKey));
            }
            dropdown.setValue(this.template.ageIntervalUnit ?? 'years');
            dropdown.onChange(val => {
              this.template.ageIntervalUnit = val as IntervalUnit;
            });
          });
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
        // Remove property defs with empty keys
        this.template.customPropertyDefs = this.template.customPropertyDefs.filter(d => d.key.trim() !== '');
        void this.onSave(this.template);
        this.close();
      });

    // Restore scroll position after re-render
    window.requestAnimationFrame(() => {
      scrollEl.scrollTop = scrollTop;
    });
  }

  private renderCustomProperties(containerEl: HTMLElement): void {
    renderCustomPropertyDefs(containerEl, this.template.customPropertyDefs, (defs) => {
      this.template.customPropertyDefs = defs;
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
      customPropertyDefs: (template.customPropertyDefs ?? []).map(clonePropertyDef),
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
        this.template.customPropertyDefs = this.template.customPropertyDefs.filter(d => d.key.trim() !== '');
        void this.onSave(this.template);
        this.close();
      });

    // Restore scroll position after re-render
    window.requestAnimationFrame(() => {
      scrollEl.scrollTop = scrollTop;
    });
  }

  private renderCustomProperties(containerEl: HTMLElement): void {
    renderCustomPropertyDefs(containerEl, this.template.customPropertyDefs, (defs) => {
      this.template.customPropertyDefs = defs;
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

// ── Shared helpers for typed custom-property definitions ──────────────

function clonePropertyDef(d: CustomPropertyDefinition): CustomPropertyDefinition {
  return { ...d, enumOptions: d.enumOptions ? [...d.enumOptions] : undefined };
}

/** Render the "Default custom properties" section shared by both template editors. */
function renderCustomPropertyDefs(
  containerEl: HTMLElement,
  defs: CustomPropertyDefinition[],
  onChange: (defs: CustomPropertyDefinition[]) => void
): void {
  new Setting(containerEl)
    .setName(t('template.defaultCustomProperties'))
    .setHeading();

  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    const wrapper = containerEl.createDiv('novalist-template-property-def');

    // Row 1: name + type + default value + delete
    const row = new Setting(wrapper);
    row.addText(text => text
      .setPlaceholder(t('template.propertyName'))
      .setValue(def.key)
      .onChange(v => { def.key = v; }));

    row.addDropdown(dd => {
      for (const pt of CUSTOM_PROPERTY_TYPES) {
        dd.addOption(pt, t(`template.propType.${pt}` as Parameters<typeof t>[0]));
      }
      dd.setValue(def.type);
      dd.onChange(v => {
        def.type = v as CustomPropertyType;
        // Reset default value when switching type
        if (v === 'bool') def.defaultValue = def.defaultValue || 'false';
        if (v === 'enum' && !def.enumOptions) def.enumOptions = [];
        if (v === 'timespan' && !def.intervalUnit) def.intervalUnit = 'years';
        onChange(defs);
      });
    });

    // Default value input (depends on type)
    switch (def.type) {
      case 'bool':
        row.addToggle(toggle => toggle
          .setValue(def.defaultValue === 'true')
          .onChange(v => { def.defaultValue = String(v); }));
        break;
      case 'date':
        row.addText(text => {
          text.setPlaceholder(t('template.datePlaceholder'));
          text.setValue(def.defaultValue);
          text.inputEl.type = 'date';
          text.onChange(v => { def.defaultValue = v; });
        });
        break;
      case 'int':
        row.addText(text => {
          text.setPlaceholder('0');
          text.setValue(def.defaultValue);
          text.inputEl.type = 'number';
          text.inputEl.step = '1';
          text.onChange(v => { def.defaultValue = v; });
        });
        break;
      case 'enum':
        if (def.enumOptions && def.enumOptions.length > 0) {
          row.addDropdown(dd => {
            for (const opt of def.enumOptions ?? []) {
              dd.addOption(opt, opt);
            }
            dd.setValue(def.defaultValue);
            dd.onChange(v => { def.defaultValue = v; });
          });
        } else {
          row.addText(text => text
            .setPlaceholder(t('template.propertyValue'))
            .setValue(def.defaultValue)
            .setDisabled(true));
        }
        break;
      case 'timespan':
        row.addText(text => {
          text.setPlaceholder(t('template.datePlaceholder'));
          text.setValue(def.defaultValue);
          text.inputEl.type = 'date';
          text.onChange(v => { def.defaultValue = v; });
        });
        break;
      default: // 'string'
        row.addText(text => text
          .setPlaceholder(t('template.propertyValue'))
          .setValue(def.defaultValue)
          .onChange(v => { def.defaultValue = v; }));
    }

    row.addButton(btn => btn
      .setIcon('trash')
      .setTooltip(t('template.removeProperty'))
      .onClick(() => {
        defs.splice(i, 1);
        onChange(defs);
      }));

    // Row 2: enum options (only when type === 'enum')
    if (def.type === 'enum') {
      renderEnumOptions(wrapper, def, () => onChange(defs));
    }

    // Row 2: interval unit selector (only when type === 'timespan')
    if (def.type === 'timespan') {
      new Setting(wrapper)
        .setName(t('template.intervalUnit'))
        .setClass('novalist-template-interval-row')
        .addDropdown(dd => {
          for (const unit of INTERVAL_UNITS) {
            dd.addOption(unit, t(`template.intervalUnit.${unit}` as Parameters<typeof t>[0]));
          }
          dd.setValue(def.intervalUnit ?? 'years');
          dd.onChange(v => {
            def.intervalUnit = v as IntervalUnit;
          });
        });
    }
  }

  new ButtonComponent(containerEl)
    .setButtonText(t('template.addProperty'))
    .onClick(() => {
      defs.push({ key: `prop${defs.length + 1}`, type: 'string', defaultValue: '' });
      onChange(defs);
    });
}

/** Render the enumeration option rows for a single custom-property definition. */
function renderEnumOptions(
  container: HTMLElement,
  def: CustomPropertyDefinition,
  onChange: () => void
): void {
  const enumContainer = container.createDiv('novalist-template-enum-options');
  const opts = def.enumOptions ?? [];

  for (let i = 0; i < opts.length; i++) {
    new Setting(enumContainer)
      .setClass('novalist-template-enum-row')
      .addText(text => text
        .setPlaceholder(t('template.enumOption'))
        .setValue(opts[i])
        .onChange(v => { opts[i] = v; }))
      .addButton(btn => btn
        .setIcon('trash')
        .setTooltip(t('template.removeEnumOption'))
        .onClick(() => {
          opts.splice(i, 1);
          onChange();
        }));
  }

  new ButtonComponent(enumContainer)
    .setButtonText(t('template.addEnumOption'))
    .onClick(() => {
      opts.push('');
      def.enumOptions = opts;
      onChange();
    });
}
