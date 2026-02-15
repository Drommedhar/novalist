import { App, ButtonComponent, Modal, Notice, Setting, TFile } from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';
import {
  createSnapshot,
  listSnapshots,
  deleteSnapshot,
  getSnapshotBody,
  computeLineDiff,
  stripFrontmatter,
  type SnapshotInfo,
  type DiffLine,
} from '../utils/snapshotUtils';

// ─── Name-entry modal ───────────────────────────────────────────────

/**
 * Simple modal that asks for a snapshot name, then creates the snapshot.
 */
export class SnapshotNameModal extends Modal {
  private plugin: NovalistPlugin;
  private chapterFile: TFile;
  private onCreated?: () => void;

  constructor(app: App, plugin: NovalistPlugin, chapterFile: TFile, onCreated?: () => void) {
    super(app);
    this.plugin = plugin;
    this.chapterFile = chapterFile;
    this.onCreated = onCreated;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: t('snapshot.createTitle') });

    let snapshotName = '';

    new Setting(contentEl)
      .setName(t('snapshot.name'))
      .setDesc(t('snapshot.nameDesc'))
      .addText((text) => {
        text.setPlaceholder(t('snapshot.namePlaceholder'));
        text.onChange((value) => {
          snapshotName = value;
        });
        setTimeout(() => text.inputEl.focus(), 50);
        text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void doCreate();
          }
        });
      });

    const doCreate = async (): Promise<void> => {
      const name = snapshotName.trim();
      if (!name) {
        new Notice(t('snapshot.nameRequired'));
        return;
      }
      const root = this.plugin.resolvedProjectPath();
      const chapterGuid = this.plugin.getChapterIdForFileSync(this.chapterFile);
      await createSnapshot(this.app.vault, root, this.chapterFile, name, chapterGuid);
      new Notice(t('snapshot.created', { name }));
      this.onCreated?.();
      this.close();
    };

    const buttonDiv = contentEl.createDiv('modal-button-container');

    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.cancel'))
      .onClick(() => this.close());

    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.create'))
      .setCta()
      .onClick(() => void doCreate());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// ─── List / compare / restore modal ─────────────────────────────────

/**
 * Modal that lists all snapshots for a chapter, with compare, restore,
 * and delete actions.  The compare action shows a side-by-side diff
 * view inside the same modal.
 */
export class SnapshotListModal extends Modal {
  private plugin: NovalistPlugin;
  private chapterFile: TFile;

  constructor(app: App, plugin: NovalistPlugin, chapterFile: TFile) {
    super(app);
    this.plugin = plugin;
    this.chapterFile = chapterFile;
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass('novalist-snapshot-modal');
    await this.renderList();
  }

  // ── List view ──────────────────────────────────────────────────────

  private async renderList(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.classList.remove('novalist-snapshot-modal-wide');

    contentEl.createEl('h3', {
      text: t('snapshot.listTitle', { chapter: this.chapterFile.basename }),
    });

    const root = this.plugin.resolvedProjectPath();
    const chapterGuid = this.plugin.getChapterIdForFileSync(this.chapterFile);
    const snapshots = await listSnapshots(this.app.vault, root, chapterGuid, this.chapterFile.basename);

    if (snapshots.length === 0) {
      contentEl.createEl('p', {
        text: t('snapshot.noSnapshots'),
        cls: 'novalist-empty',
      });
    } else {
      const listEl = contentEl.createDiv('novalist-snapshot-list');

      for (const snap of snapshots) {
        const row = listEl.createDiv('novalist-snapshot-row');

        const info = row.createDiv('novalist-snapshot-info');
        info.createEl('strong', { text: snap.snapshotName });
        const dateStr = new Date(snap.createdAt).toLocaleString();
        info.createEl('span', { text: dateStr, cls: 'novalist-snapshot-date' });

        const actions = row.createDiv('novalist-snapshot-actions');

        new ButtonComponent(actions)
          .setButtonText(t('snapshot.compare'))
          .onClick(() => void this.showCompare(snap));

        new ButtonComponent(actions)
          .setButtonText(t('snapshot.restore'))
          .onClick(() => void this.doRestore(snap));

        new ButtonComponent(actions)
          .setButtonText(t('explorer.delete'))
          .setWarning()
          .onClick(() => void this.doDelete(snap));
      }
    }

    const buttonDiv = contentEl.createDiv('modal-button-container');

    new ButtonComponent(buttonDiv)
      .setButtonText(t('snapshot.createNew'))
      .setCta()
      .onClick(() => {
        this.close();
        new SnapshotNameModal(this.app, this.plugin, this.chapterFile).open();
      });

    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.cancel'))
      .onClick(() => this.close());
  }

  // ── Compare (diff) view ────────────────────────────────────────────

  private async showCompare(snapshot: SnapshotInfo): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.classList.add('novalist-snapshot-modal-wide');

    contentEl.createEl('h3', {
      text: t('snapshot.compareTitle', { name: snapshot.snapshotName }),
    });

    // Read both versions
    const currentContent = await this.app.vault.read(this.chapterFile);
    const currentBody = stripFrontmatter(currentContent);
    const snapshotBody = await getSnapshotBody(this.app.vault, snapshot);

    const diffLines = computeLineDiff(snapshotBody, currentBody);

    // Summary bar
    const added = diffLines.filter((l) => l.type === 'added').length;
    const removed = diffLines.filter((l) => l.type === 'removed').length;
    const unchanged = diffLines.filter((l) => l.type === 'unchanged').length;

    const stats = contentEl.createDiv('novalist-diff-stats');
    stats.createSpan({
      text: t('snapshot.diffStats', {
        added: added.toString(),
        removed: removed.toString(),
        unchanged: unchanged.toString(),
      }),
      cls: 'novalist-diff-stats-text',
    });

    // Diff table inside a single scrollable container
    const diffContainer = contentEl.createDiv('novalist-diff-container');

    // Column headers
    const headerRow = diffContainer.createDiv('novalist-diff-header-row');
    headerRow.createDiv({
      text: t('snapshot.snapshotVersion', { name: snapshot.snapshotName }),
      cls: 'novalist-diff-header novalist-diff-header-left',
    });
    headerRow.createDiv({
      text: t('snapshot.currentVersion'),
      cls: 'novalist-diff-header novalist-diff-header-right',
    });

    // Scrollable body with a table
    const scrollArea = diffContainer.createDiv('novalist-diff-scroll');
    const table = scrollArea.createEl('table', { cls: 'novalist-diff-table' });

    for (const line of diffLines) {
      const tr = table.createEl('tr', {
        cls: `novalist-diff-row novalist-diff-${line.type}`,
      });

      // Left side
      tr.createEl('td', {
        text: line.type !== 'added' ? (line.leftLineNo?.toString() ?? '') : '',
        cls: 'novalist-diff-linenum',
      });
      tr.createEl('td', {
        text: line.type !== 'added' ? (line.content || '\u00A0') : '',
        cls: 'novalist-diff-content',
      });

      // Right side
      tr.createEl('td', {
        text: line.type !== 'removed' ? (line.rightLineNo?.toString() ?? '') : '',
        cls: 'novalist-diff-linenum',
      });
      tr.createEl('td', {
        text: line.type !== 'removed' ? (line.content || '\u00A0') : '',
        cls: 'novalist-diff-content',
      });

      // Click-to-restore for added/removed rows
      if (line.type === 'added' || line.type === 'removed') {
        tr.classList.add('novalist-diff-clickable');
        tr.title = t('snapshot.lineRestoreTooltip');
        tr.addEventListener('click', () => {
          void this.applyLineDiff(line, diffLines, snapshot);
        });
      }
    }

    // Back button
    const buttonDiv = contentEl.createDiv('modal-button-container');

    new ButtonComponent(buttonDiv)
      .setButtonText(t('snapshot.restore'))
      .onClick(() => void this.doRestore(snapshot));

    new ButtonComponent(buttonDiv)
      .setButtonText(t('modal.cancel'))
      .onClick(() => void this.renderList());
  }

  // ── Single-line apply ───────────────────────────────────────────────

  /**
   * Apply a single diff line change to the current chapter:
   * - "removed" → re-insert the line at the correct position
   * - "added"   → delete the line from the current body
   * Then re-render the compare view.
   */
  private async applyLineDiff(
    target: DiffLine,
    allDiff: DiffLine[],
    snapshot: SnapshotInfo,
  ): Promise<void> {
    const currentContent = await this.app.vault.read(this.chapterFile);
    const fmMatch = currentContent.match(/^(---\n[\s\S]*?\n---\n?)/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    const currentBody = stripFrontmatter(currentContent);
    const bodyLines = currentBody.split('\n');

    if (target.type === 'added' && target.rightLineNo != null) {
      // Remove this line from the current body
      const idx = target.rightLineNo - 1;
      if (idx >= 0 && idx < bodyLines.length && bodyLines[idx] === target.content) {
        bodyLines.splice(idx, 1);
      }
    } else if (target.type === 'removed' && target.leftLineNo != null) {
      // Re-insert this line into the current body.
      // Find the insertion point by looking at the surrounding context in
      // the diff.  We locate the nearest 'unchanged' or 'added' line that
      // precedes `target` in the diff sequence and use its rightLineNo as
      // the anchor.  We then account for any other 'removed' lines between
      // that anchor and the target so they stack correctly.
      const targetIdx = allDiff.indexOf(target);
      let insertAfterRight = 0; // 0 means insert at the very start
      let removedBetween = 0;

      for (let k = targetIdx - 1; k >= 0; k--) {
        const prev = allDiff[k];
        if (prev.type === 'removed') {
          removedBetween++;
          continue;
        }
        // unchanged or added – both have a rightLineNo
        insertAfterRight = prev.rightLineNo ?? 0;
        break;
      }

      const insertPos = insertAfterRight + removedBetween;
      bodyLines.splice(insertPos, 0, target.content);
    }

    const newContent = frontmatter + bodyLines.join('\n');
    await this.app.vault.modify(this.chapterFile, newContent);

    new Notice(t('snapshot.lineRestored'));
    await this.showCompare(snapshot);
  }

  // ── Actions ────────────────────────────────────────────────────────

  private async doRestore(snapshot: SnapshotInfo): Promise<void> {
    const snapshotBody = await getSnapshotBody(this.app.vault, snapshot);

    // Preserve the chapter's existing frontmatter
    const currentContent = await this.app.vault.read(this.chapterFile);
    const fmMatch = currentContent.match(/^(---\n[\s\S]*?\n---\n?)/);
    const frontmatter = fmMatch ? fmMatch[1] : '';

    const newContent = frontmatter + snapshotBody;
    await this.app.vault.modify(this.chapterFile, newContent);

    new Notice(t('snapshot.restored', { name: snapshot.snapshotName }));
    this.close();
  }

  private async doDelete(snapshot: SnapshotInfo): Promise<void> {
    await deleteSnapshot(this.app, snapshot);
    new Notice(t('snapshot.deleted', { name: snapshot.snapshotName }));
    await this.renderList();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
