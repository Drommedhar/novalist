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
  templateId: string;

  constructor(app: App, plugin: NovalistPlugin) {
    super(app);
    this.plugin = plugin;
    this.templateId = plugin.settings.activeLocationTemplateId;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl('h2', { text: t('modal.createLocation') });
    
    new Setting(contentEl)
      .setName(t('modal.name'))
      .addText(text => text.onChange(value => this.name = value));
    
    new Setting(contentEl)
      .setName(t('modal.description'))
      .addTextArea(text => text.onChange(value => this.description = value));

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
    
    const buttonDiv = contentEl.createDiv('modal-button-container');
    
    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.cancel'))
      .onClick(() => this.close());
    
    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.create'))
      .setCta()
      .onClick(async () => {
        await this.plugin.createLocation(this.name, this.description, this.templateId);
        this.close();
      });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
