import {
  Modal,
  App,
  Setting,
  ButtonComponent
} from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';

export class LocationModal extends Modal {
  plugin: NovalistPlugin;
  name: string = '';
  description: string = '';
  parentName: string = '';
  templateId: string;
  useWorldBible: boolean = false;

  constructor(app: App, plugin: NovalistPlugin, initialParentName?: string) {
    super(app);
    this.plugin = plugin;
    this.templateId = plugin.settings.activeLocationTemplateId;
    if (initialParentName) this.parentName = initialParentName;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl('h2', { text: t('modal.createLocation') });
    
    new Setting(contentEl)
      .setName(t('modal.name'))
      .addText(text => text
        .setValue(this.name)
        .onChange(value => this.name = value));

    // Parent location selector
    const allLocations = this.plugin.getLocationList();
    const setting = new Setting(contentEl)
      .setName(t('locSheet.parent'));
    setting.addText(text => {
      text.setValue(this.parentName)
          .setPlaceholder(t('locSheet.parentPlaceholder'))
          .onChange(value => { this.parentName = value; });
      // datalist for autocomplete
      const listId = 'novalist-loc-parent-datalist';
      const datalist = contentEl.createEl('datalist');
      datalist.id = listId;
      for (const loc of allLocations) {
        datalist.createEl('option', { value: loc.name });
      }
      text.inputEl.setAttribute('list', listId);
    });
    
    const descArea = contentEl.createEl('textarea', {
      cls: 'novalist-modal-description',
      attr: { placeholder: t('modal.description'), rows: '4' },
    });
    descArea.value = this.description;
    descArea.addEventListener('input', () => { this.description = descArea.value; });

    // Template selector
    const templates = this.plugin.settings.locationTemplates;
    if (templates.length > 1) {
      new Setting(contentEl)
        .setName(t('modal.template'))
        .addDropdown(dropdown => {
          for (const tpl of templates) {
            dropdown.addOption(tpl.id, tpl.name);
          }
          dropdown.setValue(this.templateId);
          dropdown.onChange(value => { this.templateId = value; });
        });
    }

    // World Bible toggle (only if World Bible is configured)
    if (this.plugin.settings.worldBiblePath) {
      new Setting(contentEl)
        .setName(t('project.addToWorldBible'))
        .setDesc(t('project.addToWorldBibleDesc'))
        .addToggle(toggle => toggle
          .setValue(this.useWorldBible)
          .onChange(value => { this.useWorldBible = value; }));
    }
    
    const buttonDiv = contentEl.createDiv('modal-button-container');
    
    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.cancel'))
      .onClick(() => this.close());
    
    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.create'))
      .setCta()
      .onClick(async () => {
        await this.plugin.createLocation(this.name, this.description, this.templateId, this.useWorldBible, this.parentName.trim() || undefined);
        this.close();
      });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
