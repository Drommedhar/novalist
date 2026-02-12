import { ItemView, WorkspaceLeaf } from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';
import type { PlotBoardColumn } from '../types';

export const PLOT_BOARD_VIEW_TYPE = 'novalist-plot-board';

export class PlotBoardView extends ItemView {
  plugin: NovalistPlugin;
  private editingCell: { chapterId: string; columnId: string } | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: NovalistPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return PLOT_BOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t('plotBoard.displayName');
  }

  getIcon(): string {
    return 'table';
  }

  async onOpen(): Promise<void> {
    this.containerEl.empty();
    await this.render();

    this.registerEvent(this.app.vault.on('create', () => { void this.render(); }));
    this.registerEvent(this.app.vault.on('delete', () => { void this.render(); }));
    this.registerEvent(this.app.vault.on('rename', () => { void this.render(); }));
  }

  /* ──────────────────────────── helpers ──────────────────────────── */

  private get board() {
    return this.plugin.settings.plotBoard;
  }

  private getCellText(chapterId: string, columnId: string): string {
    return this.board.cells[chapterId]?.[columnId] ?? '';
  }

  private setCellText(chapterId: string, columnId: string, text: string): void {
    const { cells } = this.board;
    if (!cells[chapterId]) cells[chapterId] = {};
    if (text.trim()) {
      cells[chapterId][columnId] = text;
    } else {
      delete cells[chapterId][columnId];
      if (Object.keys(cells[chapterId]).length === 0) delete cells[chapterId];
    }
    void this.plugin.saveSettings();
  }

  private addColumn(name: string): void {
    this.board.columns.push({ id: globalThis.crypto.randomUUID(), name });
    void this.plugin.saveSettings();
    void this.render();
  }

  private renameColumn(colId: string, name: string): void {
    const col = this.board.columns.find(c => c.id === colId);
    if (col) {
      col.name = name;
      void this.plugin.saveSettings();
    }
  }

  private deleteColumn(colId: string): void {
    this.board.columns = this.board.columns.filter(c => c.id !== colId);
    // Clean up cells with this column
    for (const chId of Object.keys(this.board.cells)) {
      delete this.board.cells[chId][colId];
      if (Object.keys(this.board.cells[chId]).length === 0) delete this.board.cells[chId];
    }
    void this.plugin.saveSettings();
    void this.render();
  }

  private moveColumn(colId: string, direction: -1 | 1): void {
    const idx = this.board.columns.findIndex(c => c.id === colId);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= this.board.columns.length) return;
    const temp = this.board.columns[idx];
    this.board.columns[idx] = this.board.columns[newIdx];
    this.board.columns[newIdx] = temp;
    void this.plugin.saveSettings();
    void this.render();
  }

  /* ──────────────────────────── render ───────────────────────────── */

  async render(): Promise<void> {
    const container = this.containerEl;
    container.empty();
    container.addClass('novalist-plot-board');

    // Header
    const header = container.createDiv('novalist-plot-board-header');
    header.createEl('h3', { text: t('plotBoard.displayName'), cls: 'novalist-plot-board-title' });
    const addBtn = header.createEl('button', { text: t('plotBoard.addColumn'), cls: 'novalist-plot-board-add-col' });
    addBtn.addEventListener('click', () => this.promptNewColumn());

    // Chapters
    const chapters = await this.plugin.getChapterDescriptions();

    if (chapters.length === 0) {
      container.createEl('p', { text: t('plotBoard.noChapters'), cls: 'novalist-empty' });
      return;
    }

    const columns: PlotBoardColumn[] = this.board.columns;

    // Table wrapper (horizontal scroll)
    const wrapper = container.createDiv('novalist-plot-board-wrapper');
    const table = wrapper.createEl('table', { cls: 'novalist-plot-board-table' });

    // Thead
    const thead = table.createEl('thead');
    const headRow = thead.createEl('tr');
    headRow.createEl('th', { text: t('plotBoard.indexHeader'), cls: 'novalist-plot-board-th-index' });
    headRow.createEl('th', { text: t('plotBoard.chapterHeader'), cls: 'novalist-plot-board-th-chapter' });

    for (const col of columns) {
      const th = headRow.createEl('th', { cls: 'novalist-plot-board-th-custom' });
      this.renderColumnHeader(th, col);
    }

    // Tbody
    const tbody = table.createEl('tbody');
    for (const ch of chapters) {
      const tr = tbody.createEl('tr');

      // Order
      tr.createEl('td', { text: String(ch.order), cls: 'novalist-plot-board-td-index' });

      // Chapter name (clickable)
      const nameTd = tr.createEl('td', { cls: 'novalist-plot-board-td-chapter' });
      const nameLink = nameTd.createEl('a', { text: ch.name, cls: 'novalist-plot-board-chapter-link' });
      nameLink.addEventListener('click', (e) => {
        e.preventDefault();
        void this.app.workspace.openLinkText(ch.file.path, '', false);
      });

      // Custom columns
      for (const col of columns) {
        const td = tr.createEl('td', { cls: 'novalist-plot-board-td-cell' });
        this.renderCell(td, ch.id, col.id);
      }

      // Scene rows (nested under chapter)
      if (ch.scenes && ch.scenes.length > 0) {
        for (const scene of ch.scenes) {
          const sceneTr = tbody.createEl('tr', { cls: 'novalist-plot-board-scene-row' });
          sceneTr.createEl('td', { cls: 'novalist-plot-board-td-index' }); // empty index cell
          const sceneNameTd = sceneTr.createEl('td', { cls: 'novalist-plot-board-td-chapter novalist-plot-board-td-scene' });
          const sceneLink = sceneNameTd.createEl('a', { text: scene, cls: 'novalist-plot-board-scene-link' });
          sceneLink.addEventListener('click', (e) => {
            e.preventDefault();
            void this.plugin.openSceneInFile(ch.file, scene);
          });

          const sceneKey = `${ch.id}:${scene}`;
          for (const col of columns) {
            const td = sceneTr.createEl('td', { cls: 'novalist-plot-board-td-cell' });
            this.renderCell(td, sceneKey, col.id);
          }
        }
      }
    }
  }

  /* ──────────────────────── column header ────────────────────────── */

  private renderColumnHeader(th: HTMLElement, col: PlotBoardColumn): void {
    const label = th.createEl('span', { text: col.name, cls: 'novalist-plot-board-col-label' });

    // Inline rename on double-click
    label.addEventListener('dblclick', () => {
      th.empty();
      const input = th.createEl('input', { cls: 'novalist-plot-board-col-input', value: col.name });
      input.focus();
      input.select();

      const commitRename = () => {
        const v = input.value.trim();
        if (v && v !== col.name) {
          this.renameColumn(col.id, v);
        }
        void this.render();
      };

      input.addEventListener('blur', commitRename);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
        if (e.key === 'Escape') { void this.render(); }
      });
    });

    // Action buttons row
    const actions = th.createDiv('novalist-plot-board-col-actions');

    if (this.board.columns.indexOf(col) > 0) {
      const leftBtn = actions.createEl('button', { text: '←', cls: 'novalist-plot-board-col-btn', attr: { 'aria-label': t('plotBoard.moveLeft') } });
      leftBtn.addEventListener('click', () => this.moveColumn(col.id, -1));
    }

    if (this.board.columns.indexOf(col) < this.board.columns.length - 1) {
      const rightBtn = actions.createEl('button', { text: '→', cls: 'novalist-plot-board-col-btn', attr: { 'aria-label': t('plotBoard.moveRight') } });
      rightBtn.addEventListener('click', () => this.moveColumn(col.id, 1));
    }

    const delBtn = actions.createEl('button', { text: '✕', cls: 'novalist-plot-board-col-btn novalist-plot-board-col-del', attr: { 'aria-label': t('plotBoard.deleteColumn') } });
    delBtn.addEventListener('click', () => this.deleteColumn(col.id));
  }

  /* ─────────────────────── editable cell ─────────────────────────── */

  private renderCell(td: HTMLElement, chapterId: string, columnId: string): void {
    const text = this.getCellText(chapterId, columnId);
    const isEditing = this.editingCell?.chapterId === chapterId && this.editingCell?.columnId === columnId;

    if (isEditing) {
      const textarea = td.createEl('textarea', { cls: 'novalist-plot-board-cell-editor', text });
      textarea.rows = 3;

      // Schedule focus to next microtask so DOM has painted
      setTimeout(() => { textarea.focus(); }, 0);

      const commit = () => {
        this.editingCell = null;
        this.setCellText(chapterId, columnId, textarea.value);
        void this.render();
      };

      textarea.addEventListener('blur', commit);
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { this.editingCell = null; void this.render(); }
        // Ctrl/Cmd+Enter to commit
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
      });
    } else {
      const display = td.createDiv('novalist-plot-board-cell-display');
      if (text) {
        display.textContent = text;
      } else {
        display.classList.add('novalist-plot-board-cell-empty');
        display.textContent = t('plotBoard.emptyCellPlaceholder');
      }
      display.addEventListener('click', () => {
        this.editingCell = { chapterId, columnId };
        void this.render();
      });
    }
  }

  /* ─────────────────────── new column prompt ─────────────────────── */

  private promptNewColumn(): void {
    const container = this.containerEl;
    const existing = container.querySelector('.novalist-plot-board-new-col-row');
    if (existing) { existing.querySelector('input')?.focus(); return; }

    const row = container.createDiv('novalist-plot-board-new-col-row');
    const input = row.createEl('input', { cls: 'novalist-plot-board-new-col-input', attr: { placeholder: t('plotBoard.columnPlaceholder') } });
    const okBtn = row.createEl('button', { text: t('plotBoard.add'), cls: 'novalist-plot-board-new-col-ok' });
    const cancelBtn = row.createEl('button', { text: t('plotBoard.cancel'), cls: 'novalist-plot-board-new-col-cancel' });

    input.focus();

    const submit = () => {
      const val = input.value.trim();
      if (val) this.addColumn(val);
      row.remove();
    };

    okBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', () => row.remove());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') row.remove();
    });
  }
}
