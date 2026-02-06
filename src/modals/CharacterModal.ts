import {
  Modal,
  App,
  Setting,
  ButtonComponent,
  Component,
  MarkdownRenderer
} from 'obsidian';
import type NovalistPlugin from '../main';
import { CHARACTER_ROLE_LABELS, CharacterRole } from '../main';

export class CharacterModal extends Modal {
  plugin: NovalistPlugin;
  name: string = '';
  surname: string = '';
  gender: string = '';
  age: string = '';
  relationship: string = '';
  role: CharacterRole = 'main';
  furtherInfo: string = '';
  private previewEl: HTMLElement | null = null;
  private previewComponent = new Component();

  constructor(app: App, plugin: NovalistPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.previewComponent.load();
    
    contentEl.createEl('h2', { text: 'Create new character' });
    
    // Name
    new Setting(contentEl)
      .setName('Name')
      .addText(text => text.onChange(value => this.name = value));
    
    // Surname
    new Setting(contentEl)
      .setName('Surname')
      .addText(text => text.onChange(value => this.surname = value));
    
    // Gender
    new Setting(contentEl)
      .setName('Gender')
      .addText(text => text.onChange(value => this.gender = value));

    // Age
    new Setting(contentEl)
      .setName('Age')
      .addText(text => text.onChange(value => this.age = value));
    
    // Relationship
    new Setting(contentEl)
      .setName('Relationship')
      .addText(text => text.onChange(value => this.relationship = value));

    new Setting(contentEl)
      .setName('Character role')
      .addDropdown((dropdown) => {
        for (const [key, label] of Object.entries(CHARACTER_ROLE_LABELS)) {
          dropdown.addOption(key, label);
        }
        dropdown.setValue(this.role);
        dropdown.onChange((value) => {
          if (value in CHARACTER_ROLE_LABELS) {
            this.role = value as CharacterRole;
          }
        });
      });
    
    // Further Info
    new Setting(contentEl)
      .setName('Further information')
      .addTextArea(text => text
        .setPlaceholder('Supports Markdown')
        .onChange(async (value) => {
          this.furtherInfo = value;
          await this.renderPreview();
        }));

    // Markdown preview
    this.previewEl = contentEl.createDiv('novalist-markdown-preview');
    this.previewEl.createEl('small', { text: 'Preview' });
    await this.renderPreview();
    
    // Buttons
    const buttonDiv = contentEl.createDiv('modal-button-container');
    
    new ButtonComponent(buttonDiv)
      .setButtonText('Cancel')
      .onClick(() => this.close());
    
    new ButtonComponent(buttonDiv)
      .setButtonText('Create')
      .setCta()
      .onClick(async () => {
        await this.plugin.createCharacter(
          this.name,
          this.surname,
          this.age,
          this.gender,
          this.relationship,
          this.role,
          this.furtherInfo
        );
        this.close();
      });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
    this.previewComponent.unload();
  }

  private async renderPreview() {
    if (!this.previewEl) return;
    this.previewEl.empty();
    this.previewEl.createEl('small', { text: 'Preview' });
    const content = this.previewEl.createDiv('novalist-markdown-preview-content');
    await MarkdownRenderer.render(this.plugin.app, this.furtherInfo, content, '', this.previewComponent);
  }
}
