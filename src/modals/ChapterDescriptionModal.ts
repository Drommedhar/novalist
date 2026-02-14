import {
  Modal,
  App,
  Setting,
  ButtonComponent
} from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';
import { ChapterStatus, CHAPTER_STATUSES } from '../types';

export interface ChapterEditData {
  name: string;
  order: string;
  status: ChapterStatus;
  act: string;
  date: string;
}

export class ChapterDescriptionModal extends Modal {
  plugin: NovalistPlugin;
  private editData: ChapterEditData;
  private isEditMode: boolean;
  private onSave?: (data: ChapterEditData) => void;

  constructor(
    app: App,
    plugin: NovalistPlugin,
    existing?: ChapterEditData,
    onSave?: (data: ChapterEditData) => void
  ) {
    super(app);
    this.plugin = plugin;
    this.isEditMode = !!existing;
    this.onSave = onSave;
    this.editData = existing
      ? { ...existing }
      : { name: '', order: '', status: 'outline', act: '', date: '' };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', {
      text: this.isEditMode ? t('modal.editChapter') : t('modal.createChapter')
    });

    new Setting(contentEl)
      .setName(t('modal.name'))
      .addText(text => text
        .setValue(this.editData.name)
        .onChange(v => { this.editData.name = v; }));

    new Setting(contentEl)
      .setName(t('modal.order'))
      .addText(text => {
        text.setValue(this.editData.order);
        text.inputEl.type = 'number';
        text.onChange(v => { this.editData.order = v; });
      });

    new Setting(contentEl)
      .setName(t('modal.status'))
      .addDropdown(dd => {
        for (const s of CHAPTER_STATUSES) {
          dd.addOption(s.value, `${s.icon} ${s.label}`);
        }
        dd.setValue(this.editData.status);
        dd.onChange(v => { this.editData.status = v as ChapterStatus; });
      });

    // Act selector
    const acts = this.plugin.getActNames();
    new Setting(contentEl)
      .setName(t('modal.act'))
      .addDropdown(dd => {
        dd.addOption('', '\u2014');
        for (const act of acts) {
          dd.addOption(act, act);
        }
        dd.setValue(this.editData.act);
        dd.onChange(v => { this.editData.act = v; });
      });

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
      .onClick(async () => {
        if (this.isEditMode && this.onSave) {
          this.onSave(this.editData);
        } else {
          await this.plugin.createChapter(this.editData.name, this.editData.order);
          // Apply additional frontmatter fields after creation
          if (this.editData.status !== 'outline' || this.editData.act || this.editData.date) {
            await this.plugin.updateChapterMetadata(this.editData.name, {
              status: this.editData.status,
              act: this.editData.act,
              date: this.editData.date,
            });
          }
        }
        this.close();
      });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
