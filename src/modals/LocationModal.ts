import {
  Modal,
  App,
  Setting,
  ButtonComponent
} from 'obsidian';
import type NovalistPlugin from '../main';

export class LocationModal extends Modal {
  plugin: NovalistPlugin;
  name: string = '';
  description: string = '';

  constructor(app: App, plugin: NovalistPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl('h2', { text: 'Create new location' });
    
    new Setting(contentEl)
      .setName('Name')
      .addText(text => text.onChange(value => this.name = value));
    
    new Setting(contentEl)
      .setName('Description')
      .addTextArea(text => text.onChange(value => this.description = value));
    
    const buttonDiv = contentEl.createDiv('modal-button-container');
    
    new ButtonComponent(buttonDiv)
      .setButtonText('Cancel')
      .onClick(() => this.close());
    
    new ButtonComponent(buttonDiv)
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
