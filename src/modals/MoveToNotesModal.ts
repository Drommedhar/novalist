import { App, Modal } from 'obsidian';
import type { TranslationKey } from '../i18n';

export class MoveToNotesModal extends Modal {
  private onConfirm: (createSnapshot: boolean) => Promise<void>;
  private chapterName: string | null;
  private chapterCount: number;
  private t: (key: TranslationKey) => string;

  constructor(
    app: App,
    chapterName: string | null,
    chapterCount: number,
    t: (key: TranslationKey) => string,
    onConfirm: (createSnapshot: boolean) => Promise<void>
  ) {
    super(app);
    this.chapterName = chapterName;
    this.chapterCount = chapterCount;
    this.t = t;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    const isBulk = this.chapterName === null;

    contentEl.createEl('h2', {
      text: isBulk ? this.t('chapterNotes.moveAllConfirmTitle') : this.t('chapterNotes.moveConfirmTitle')
    });

    const messageText = isBulk
      ? this.t('chapterNotes.moveAllConfirmMessage').replace('{count}', String(this.chapterCount))
      : this.t('chapterNotes.moveConfirmMessage');

    contentEl.createEl('p', { text: messageText });

    // Snapshot toggle
    let createSnapshot = true;
    const snapshotLabel = contentEl.createEl('label', { cls: 'novalist-move-to-notes-snapshot-label' });
    const checkbox = snapshotLabel.createEl('input', { type: 'checkbox' });
    checkbox.checked = true;
    snapshotLabel.createEl('span', {
      text: isBulk ? this.t('chapterNotes.moveAllSnapshotCheckbox') : this.t('chapterNotes.moveSnapshotCheckbox')
    });
    checkbox.addEventListener('change', () => { createSnapshot = checkbox.checked; });

    // Buttons
    const btnRow = contentEl.createDiv('novalist-move-to-notes-btn-row');

    const cancelBtn = btnRow.createEl('button', { text: this.t('modal.cancel') });
    cancelBtn.addEventListener('click', () => this.close());

    const confirmBtn = btnRow.createEl('button', {
      text: isBulk ? this.t('chapterNotes.moveAllConfirmTitle') : this.t('chapterNotes.moveConfirmTitle'),
      cls: 'mod-warning'
    });
    confirmBtn.addEventListener('click', () => {
      this.close();
      void this.onConfirm(createSnapshot);
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
