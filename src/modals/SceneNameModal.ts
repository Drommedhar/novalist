import {
  Modal,
  App,
  Setting,
  ButtonComponent
} from 'obsidian';
import { t } from '../i18n';

export interface SceneEditData {
  name: string;
  date: string;
}

export class SceneNameModal extends Modal {
  private editData: SceneEditData;
  private isEditMode: boolean;
  private onSubmit: (data: SceneEditData) => void;

  constructor(app: App, onSubmit: (data: SceneEditData) => void, existing?: SceneEditData) {
    super(app);
    this.onSubmit = onSubmit;
    this.isEditMode = !!existing;
    this.editData = existing
      ? { ...existing }
      : { name: '', date: '' };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', {
      text: this.isEditMode ? t('modal.editScene') : t('modal.createScene')
    });

    new Setting(contentEl)
      .setName(t('modal.sceneName'))
      .addText(text => text
        .setValue(this.editData.name)
        .onChange(v => { this.editData.name = v; }));

    new Setting(contentEl)
      .setName(t('modal.date'))
      .addText(text => {
        text.setPlaceholder(t('template.datePlaceholder'));
        text.setValue(this.editData.date);
        text.inputEl.type = 'date';
        text.onChange(v => { this.editData.date = v; });
      });

    const buttonDiv = contentEl.createDiv('modal-button-container');

    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.cancel'))
      .onClick(() => this.close());

    new ButtonComponent(buttonDiv)
      .setButtonText(this.isEditMode ? t('modal.save') : t('modal.create'))
      .setCta()
      .onClick(() => {
        if (this.editData.name.trim()) {
          this.onSubmit(this.editData);
          this.close();
        }
      });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
