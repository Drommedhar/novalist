import {
  Modal,
  App,
  Setting,
  ButtonComponent
} from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';

export class CharacterModal extends Modal {
  plugin: NovalistPlugin;
  name: string = '';
  surname: string = '';
  templateId: string;
  useWorldBible: boolean = false;

  constructor(app: App, plugin: NovalistPlugin) {
    super(app);
    this.plugin = plugin;
    this.templateId = plugin.settings.activeCharacterTemplateId;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl('h2', { text: t('modal.createCharacter') });
    
    // Name
    new Setting(contentEl)
      .setName(t('modal.name'))
      .addText(text => text.onChange(value => this.name = value));
    
    // Surname
    new Setting(contentEl)
      .setName(t('modal.surname'))
      .addText(text => text.onChange(value => this.surname = value));

    // Template selector
    const templates = this.plugin.settings.characterTemplates;
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
    
    // Buttons
    const buttonDiv = contentEl.createDiv('modal-button-container');
    
    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.cancel'))
      .onClick(() => this.close());
    
    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.create'))
      .setCta()
      .onClick(async () => {
        await this.plugin.createCharacter(
          this.name,
          this.surname,
          this.templateId,
          this.useWorldBible
        );
        this.close();
      });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
