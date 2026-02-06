import {
  Modal,
  App,
  Setting,
  ButtonComponent
} from 'obsidian';
import type NovalistPlugin from '../main';

export class ChapterDescriptionModal extends Modal {
  plugin: NovalistPlugin;
  name: string = '';
  order: string = '';
  outline: string = '';

  constructor(app: App, plugin: NovalistPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Create chapter description' });

    new Setting(contentEl)
      .setName('Name')
      .addText(text => text.onChange(value => this.name = value));

    new Setting(contentEl)
      .setName('Order')
      .addText(text => text.onChange(value => this.order = value));

    new Setting(contentEl)
      .setName('Outline')
      .addTextArea(text => text
        .setPlaceholder('Supports Markdown')
        .onChange(value => this.outline = value));

    const buttonDiv = contentEl.createDiv('modal-button-container');

    new ButtonComponent(buttonDiv)
      .setButtonText('Cancel')
      .onClick(() => this.close());

    new ButtonComponent(buttonDiv)
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
