import {
  Modal,
  App,
  Setting,
  ButtonComponent
} from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';

export class ChapterDescriptionModal extends Modal {
  plugin: NovalistPlugin;
  name: string = '';
  order: string = '';

  constructor(app: App, plugin: NovalistPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: t('modal.createChapter') });

    new Setting(contentEl)
      .setName(t('modal.name'))
      .addText(text => text.onChange(value => this.name = value));

    new Setting(contentEl)
      .setName(t('modal.order'))
      .addText(text => text.onChange(value => this.order = value));

    const buttonDiv = contentEl.createDiv('modal-button-container');

    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.cancel'))
      .onClick(() => this.close());

    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.create'))
      .setCta()
      .onClick(async () => {
        await this.plugin.createChapter(this.name, this.order);
        this.close();
      });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
