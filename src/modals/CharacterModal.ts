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

  constructor(app: App, plugin: NovalistPlugin) {
    super(app);
    this.plugin = plugin;
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
          this.surname
        );
        this.close();
      });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
