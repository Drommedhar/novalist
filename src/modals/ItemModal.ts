import {
  Modal,
  App,
  Setting,
  ButtonComponent
} from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';

export class ItemModal extends Modal {
  plugin: NovalistPlugin;
  name: string = '';
  description: string = '';
  templateId: string;
  useWorldBible: boolean = false;

  constructor(app: App, plugin: NovalistPlugin) {
    super(app);
    this.plugin = plugin;
    this.templateId = plugin.settings.activeItemTemplateId;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl('h2', { text: t('modal.createItem') });
    
    new Setting(contentEl)
      .setName(t('modal.name'))
      .addText(text => text
        .setValue(this.name)
        .onChange(value => this.name = value));
    
    const descArea = contentEl.createEl('textarea', {
      cls: 'novalist-modal-description',
      attr: { placeholder: t('modal.description'), rows: '4' },
    });
    descArea.value = this.description;
    descArea.addEventListener('input', () => { this.description = descArea.value; });

    // Template selector
    const templates = this.plugin.settings.itemTemplates;
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
        await this.plugin.createItem(this.name, this.description, this.templateId, this.useWorldBible);
        this.close();
      });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
