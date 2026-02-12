import {
  Modal,
  App,
  Setting,
  ButtonComponent
} from 'obsidian';
import { t } from '../i18n';

export class SceneNameModal extends Modal {
  name: string = '';
  private onSubmit: (name: string) => void;

  constructor(app: App, onSubmit: (name: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: t('modal.createScene') });

    new Setting(contentEl)
      .setName(t('modal.sceneName'))
      .addText(text => text.onChange(value => this.name = value));

    const buttonDiv = contentEl.createDiv('modal-button-container');

    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.cancel'))
      .onClick(() => this.close());

    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.create'))
      .setCta()
      .onClick(() => {
        if (this.name.trim()) {
          this.onSubmit(this.name.trim());
          this.close();
        }
      });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
