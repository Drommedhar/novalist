import { ItemView, WorkspaceLeaf, TFile, setIcon } from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';
import type { PlotBoardColumn, PlotBoardLabel, ChapterStatus } from '../types';
import { CHAPTER_STATUSES } from '../types';

export const PLOT_BOARD_VIEW_TYPE = 'novalist-plot-board';

/** Lightweight chapter descriptor used exclusively inside the board. */
interface BoardChapter {
  id: string;
  name: string;
  order: number;
  status: ChapterStatus;
  act: string;
  file: TFile;
  scenes: string[];
}

export class PlotBoardView extends ItemView {
  plugin: NovalistPlugin;
  private editingCell: { chapterId: string; columnId: string } | null = null;
  private dragChapterId: string | null = null;
  private cachedChapters: BoardChapter[] = [];

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

  /* ─── label helpers ─────────────────────────────────────────────── */

  private get labels(): PlotBoardLabel[] {
    return this.board.labels;
  }

  private addLabel(name: string, color: string): void {
    this.board.labels.push({ id: globalThis.crypto.randomUUID(), name, color });
    void this.plugin.saveSettings();
  }

  private deleteLabel(labelId: string): void {
    this.board.labels = this.board.labels.filter(l => l.id !== labelId);
    for (const arr of Object.values(this.board.cardLabels)) {
      const idx = arr.indexOf(labelId);
      if (idx >= 0) arr.splice(idx, 1);
    }
    void this.plugin.saveSettings();
    void this.render();
  }

  private getCardLabels(chapterId: string): PlotBoardLabel[] {
    const ids = this.board.cardLabels[chapterId] ?? [];
    return ids.map(id => this.board.labels.find(l => l.id === id)).filter((l): l is PlotBoardLabel => !!l);
  }

  private toggleCardLabel(chapterId: string, labelId: string): void {
    if (!this.board.cardLabels[chapterId]) this.board.cardLabels[chapterId] = [];
    const arr = this.board.cardLabels[chapterId];
    const idx = arr.indexOf(labelId);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(labelId);
    if (arr.length === 0) delete this.board.cardLabels[chapterId];
    void this.plugin.saveSettings();
  }

  /* ─── card color helpers ────────────────────────────────────────── */

  private getCardColor(chapterId: string): string {
    return this.board.cardColors[chapterId] ?? '';
  }

  private setCardColor(chapterId: string, color: string): void {
    if (color) {
      this.board.cardColors[chapterId] = color;
    } else {
      delete this.board.cardColors[chapterId];
    }
    void this.plugin.saveSettings();
  }

  /* ─── view mode ─────────────────────────────────────────────────── */

  private get viewMode() {
    return this.board.viewMode;
  }

  private setViewMode(mode: 'board' | 'table'): void {
    this.board.viewMode = mode;
    void this.plugin.saveSettings();
    void this.render();
  }

  private isActCollapsed(act: string): boolean {
    return this.board.collapsedActs.includes(act);
  }

  private toggleActCollapsed(act: string): void {
    const idx = this.board.collapsedActs.indexOf(act);
    if (idx >= 0) this.board.collapsedActs.splice(idx, 1); else this.board.collapsedActs.push(act);
    void this.plugin.saveSettings();
    void this.render();
  }

  /* ──────────────────────────── render ───────────────────────────── */

  async render(): Promise<void> {
    const container = this.containerEl;
    container.empty();
    container.addClass('novalist-plot-board');

    this.cachedChapters = await this.plugin.getChapterDescriptions();

    this.renderHeader(container);

    if (this.cachedChapters.length === 0) {
      container.createEl('p', { text: t('plotBoard.noChapters'), cls: 'novalist-empty' });
      return;
    }

    if (this.viewMode === 'board') {
      this.renderBoardView(container);
    } else {
      this.renderTableView(container);
    }
  }

  /* ──────────────────────── header bar ───────────────────────────── */

  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv('novalist-plot-board-header');

    const left = header.createDiv('novalist-plot-board-header-left');
    left.createEl('h3', { text: t('plotBoard.displayName'), cls: 'novalist-plot-board-title' });

    const right = header.createDiv('novalist-plot-board-header-right');

    // View mode toggle
    const toggle = right.createDiv('novalist-plot-board-view-toggle');

    const boardBtn = toggle.createEl('button', {
      cls: `novalist-plot-board-toggle-btn ${this.viewMode === 'board' ? 'is-active' : ''}`,
      attr: { 'aria-label': t('plotBoard.boardView') }
    });
    setIcon(boardBtn, 'layout-dashboard');
    boardBtn.addEventListener('click', () => this.setViewMode('board'));

    const tableBtn = toggle.createEl('button', {
      cls: `novalist-plot-board-toggle-btn ${this.viewMode === 'table' ? 'is-active' : ''}`,
      attr: { 'aria-label': t('plotBoard.tableView') }
    });
    setIcon(tableBtn, 'table');
    tableBtn.addEventListener('click', () => this.setViewMode('table'));

    // Labels manager button
    const labelsBtn = right.createEl('button', {
      cls: 'novalist-plot-board-header-btn',
      attr: { 'aria-label': t('plotBoard.manageLabels') }
    });
    setIcon(labelsBtn, 'tags');
    labelsBtn.addEventListener('click', () => this.showLabelsPanel());

    // Add column button
    const addColBtn = right.createEl('button', {
      text: t('plotBoard.addColumn'),
      cls: 'novalist-plot-board-add-col'
    });
    addColBtn.addEventListener('click', () => this.promptNewColumn());
  }

  /* ════════════════════════════════════════════════════════════════════
     BOARD VIEW (Kanban — acts as lanes, chapters as cards)
     ════════════════════════════════════════════════════════════════════ */

  private renderBoardView(container: HTMLElement): void {
    const chapters = this.cachedChapters;

    // Group by act
    const actMap = new Map<string, BoardChapter[]>();
    const unassignedKey = '';
    for (const ch of chapters) {
      const key = ch.act || unassignedKey;
      if (!actMap.has(key)) actMap.set(key, []);
      const arr = actMap.get(key);
      if (arr) arr.push(ch);
    }

    // Build lane order: named acts first, unassigned last.
    // Always show the unassigned lane when named acts exist (as a drop
    // target for removing a chapter from its act) and vice-versa.
    const actOrder: string[] = [];
    for (const key of actMap.keys()) {
      if (key !== unassignedKey) actOrder.push(key);
    }
    const hasNamedActs = actOrder.length > 0;
    // Always append unassigned lane when there are named acts
    if (!actMap.has(unassignedKey) && hasNamedActs) {
      actMap.set(unassignedKey, []);
    }
    actOrder.push(unassignedKey);

    const board = container.createDiv('novalist-pb-board');

    for (const actKey of actOrder) {
      const actChapters = actMap.get(actKey) ?? [];
      this.renderActLane(board, actKey, actChapters);
    }
  }

  private renderActLane(board: HTMLElement, actKey: string, chapters: BoardChapter[]): void {
    const lane = board.createDiv('novalist-pb-lane');
    const collapseKey = actKey || '__unassigned__';
    const collapsed = this.isActCollapsed(collapseKey);

    // Lane header
    const laneHeader = lane.createDiv('novalist-pb-lane-header');

    const collapseBtn = laneHeader.createEl('button', {
      cls: 'novalist-pb-lane-collapse',
      attr: { 'aria-label': collapsed ? t('plotBoard.expand') : t('plotBoard.collapse') }
    });
    setIcon(collapseBtn, collapsed ? 'chevron-right' : 'chevron-down');
    collapseBtn.addEventListener('click', () => this.toggleActCollapsed(collapseKey));

    const label = actKey || t('general.unassigned');
    laneHeader.createEl('span', { text: label, cls: 'novalist-pb-lane-title' });
    laneHeader.createEl('span', { text: String(chapters.length), cls: 'novalist-pb-lane-count' });

    if (collapsed) return;

    // Card container (drop zone)
    const cardContainer = lane.createDiv('novalist-pb-card-container');
    cardContainer.dataset.act = actKey;

    cardContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      cardContainer.classList.add('novalist-pb-drop-active');
    });
    cardContainer.addEventListener('dragleave', (e) => {
      if (!cardContainer.contains(e.relatedTarget as Node)) {
        cardContainer.classList.remove('novalist-pb-drop-active');
      }
    });
    cardContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      cardContainer.classList.remove('novalist-pb-drop-active');
      void this.handleCardDrop(actKey, cardContainer);
    });

    for (const ch of chapters) {
      this.renderCard(cardContainer, ch);
    }
  }

  private renderCard(parent: HTMLElement, ch: BoardChapter): void {
    const card = parent.createDiv('novalist-pb-card');
    card.dataset.chapterId = ch.id;

    // Draggable
    card.draggable = true;
    card.addEventListener('dragstart', (e) => {
      this.dragChapterId = ch.id;
      card.classList.add('novalist-pb-card-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', ch.id);
      }
    });
    card.addEventListener('dragend', () => {
      this.dragChapterId = null;
      card.classList.remove('novalist-pb-card-dragging');
    });

    // Drag-over for card-level reorder
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (this.dragChapterId === ch.id) return;
      const rect = card.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      card.classList.toggle('novalist-pb-card-drop-above', e.clientY < mid);
      card.classList.toggle('novalist-pb-card-drop-below', e.clientY >= mid);
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('novalist-pb-card-drop-above', 'novalist-pb-card-drop-below');
    });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove('novalist-pb-card-drop-above', 'novalist-pb-card-drop-below');
      const rect = card.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const insertBefore = e.clientY < mid;
      void this.handleCardDropOnCard(ch, insertBefore);
    });

    // Color stripe
    const cardColor = this.getCardColor(ch.id);
    if (cardColor) {
      card.style.borderLeftColor = cardColor;
      card.classList.add('novalist-pb-card-colored');
    }

    // Card top row: status + name + order
    const topRow = card.createDiv('novalist-pb-card-top');
    const statusInfo = CHAPTER_STATUSES.find(s => s.value === ch.status);
    if (statusInfo) {
      const statusEl = topRow.createEl('span', {
        text: statusInfo.icon,
        cls: 'novalist-pb-card-status',
        attr: { 'aria-label': statusInfo.label, title: statusInfo.label }
      });
      statusEl.style.color = statusInfo.color;
    }
    const nameEl = topRow.createEl('a', { text: ch.name, cls: 'novalist-pb-card-name' });
    nameEl.addEventListener('click', (e) => {
      e.preventDefault();
      void this.app.workspace.openLinkText(ch.file.path, '', false);
    });
    topRow.createEl('span', { text: `#${ch.order}`, cls: 'novalist-pb-card-order' });

    // Labels row
    const assignedLabels = this.getCardLabels(ch.id);
    if (assignedLabels.length > 0) {
      const labelsRow = card.createDiv('novalist-pb-card-labels');
      for (const lbl of assignedLabels) {
        const badge = labelsRow.createEl('span', { text: lbl.name, cls: 'novalist-pb-label-badge' });
        badge.style.backgroundColor = lbl.color;
        badge.style.color = this.contrastText(lbl.color);
      }
    }

    // Scenes — expandable section
    if (ch.scenes.length > 0) {
      const scenesSection = card.createDiv('novalist-pb-card-scenes-section');
      const scenesToggle = scenesSection.createDiv('novalist-pb-card-scenes-toggle');
      const chevron = scenesToggle.createEl('span', { cls: 'novalist-pb-card-scenes-chevron' });
      setIcon(chevron, 'chevron-right');
      const sceneIcon = scenesToggle.createEl('span', { cls: 'novalist-pb-card-scene-icon' });
      setIcon(sceneIcon, 'list');
      scenesToggle.createEl('span', { text: t('plotBoard.sceneCount', { count: String(ch.scenes.length) }) });

      const scenesBody = scenesSection.createDiv('novalist-pb-card-scenes-body is-collapsed');

      for (const scene of ch.scenes) {
        const sceneKey = `${ch.id}:${scene}`;
        const sceneBlock = scenesBody.createDiv('novalist-pb-card-scene-block');
        const sceneLink = sceneBlock.createEl('a', { text: scene, cls: 'novalist-pb-card-scene-name' });
        sceneLink.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          void this.plugin.openSceneInFile(ch.file, scene);
        });

        // Scene note columns
        const columns = this.board.columns;
        const filledSceneCols = columns.filter(c => this.getCellText(sceneKey, c.id).trim());
        if (filledSceneCols.length > 0) {
          for (const col of filledSceneCols) {
            const row = sceneBlock.createDiv('novalist-pb-card-note-row');
            row.createEl('span', { text: col.name, cls: 'novalist-pb-card-note-col' });
            const val = this.getCellText(sceneKey, col.id);
            row.createEl('span', {
              text: val.length > 60 ? val.slice(0, 60) + '\u2026' : val,
              cls: 'novalist-pb-card-note-val'
            });
          }
        }
      }

      scenesToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const expanded = !scenesBody.classList.contains('is-collapsed');
        scenesBody.classList.toggle('is-collapsed', expanded);
        chevron.empty();
        setIcon(chevron, expanded ? 'chevron-right' : 'chevron-down');
      });
    }

    // Notes preview — show all columns that have text
    const columns = this.board.columns;
    const filledColumns = columns.filter(c => this.getCellText(ch.id, c.id).trim());
    if (filledColumns.length > 0) {
      const notesEl = card.createDiv('novalist-pb-card-notes');
      for (const col of filledColumns) {
        const row = notesEl.createDiv('novalist-pb-card-note-row');
        row.createEl('span', { text: col.name, cls: 'novalist-pb-card-note-col' });
        const val = this.getCellText(ch.id, col.id);
        row.createEl('span', {
          text: val.length > 60 ? val.slice(0, 60) + '\u2026' : val,
          cls: 'novalist-pb-card-note-val'
        });
      }
    }

    // Double-click opens notes editor
    card.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.showNotesEditor(ch);
    });

    // Context menu
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showCardContextMenu(e, ch);
    });
  }

  /* ─── drag-and-drop logic ───────────────────────────────────────── */

  private async handleCardDrop(actKey: string, container: HTMLElement): Promise<void> {
    const dragId = this.dragChapterId;
    if (!dragId) return;

    const ch = this.cachedChapters.find(c => c.id === dragId);
    if (!ch) return;

    // Move to target act
    if ((ch.act || '') !== actKey) {
      if (actKey === '') {
        await this.plugin.removeChapterFromAct(ch.file);
      } else {
        await this.plugin.assignChapterToAct(ch.file, actKey);
      }
    }

    // Reorder: dropped at end of container
    const cardsInLane = Array.from(container.querySelectorAll('.novalist-pb-card'))
      .map(el => (el as HTMLElement).dataset.chapterId)
      .filter((id): id is string => !!id && id !== dragId);
    cardsInLane.push(dragId);

    await this.reorderByIds(cardsInLane);
    void this.render();
  }

  private async handleCardDropOnCard(targetCh: BoardChapter, insertBefore: boolean): Promise<void> {
    const dragId = this.dragChapterId;
    if (!dragId || dragId === targetCh.id) return;

    const ch = this.cachedChapters.find(c => c.id === dragId);
    if (!ch) return;

    const targetAct = targetCh.act || '';

    // Move act if needed
    if ((ch.act || '') !== targetAct) {
      if (targetAct === '') {
        await this.plugin.removeChapterFromAct(ch.file);
      } else {
        await this.plugin.assignChapterToAct(ch.file, targetAct);
      }
    }

    // Determine new order in the lane
    const chaptersInAct = this.cachedChapters
      .filter(c => (c.act || '') === targetAct)
      .filter(c => c.id !== dragId);

    const targetIdx = chaptersInAct.findIndex(c => c.id === targetCh.id);
    const insertIdx = insertBefore ? targetIdx : targetIdx + 1;
    chaptersInAct.splice(insertIdx, 0, ch);

    await this.reorderByIds(chaptersInAct.map(c => c.id));
    void this.render();
  }

  private async reorderByIds(ids: string[]): Promise<void> {
    const allChapters = await this.plugin.getChapterDescriptions();
    const inSet = new Set(ids);
    const reordered = ids
      .map(id => allChapters.find(c => c.id === id)?.file)
      .filter((f): f is TFile => !!f);

    // Rebuild global list preserving others' positions
    const result: TFile[] = [];
    let ri = 0;
    for (const c of allChapters) {
      if (inSet.has(c.id)) {
        if (ri < reordered.length) {
          result.push(reordered[ri]);
          ri++;
        }
      } else {
        result.push(c.file);
      }
    }
    while (ri < reordered.length) {
      result.push(reordered[ri]);
      ri++;
    }

    await this.plugin.updateChapterOrder(result);
  }

  /* ─── card context menu ─────────────────────────────────────────── */

  private showCardContextMenu(e: MouseEvent, ch: BoardChapter): void {
    const menu = document.createElement('div');
    menu.classList.add('novalist-pb-context-menu');
    menu.style.left = `${e.pageX}px`;
    menu.style.top = `${e.pageY}px`;

    const colorItem = menu.createDiv('novalist-pb-ctx-item');
    colorItem.textContent = t('plotBoard.setColor');
    colorItem.addEventListener('click', () => {
      menu.remove();
      this.showColorPicker(ch);
    });

    const labelItem = menu.createDiv('novalist-pb-ctx-item');
    labelItem.textContent = t('plotBoard.assignLabels');
    labelItem.addEventListener('click', () => {
      menu.remove();
      this.showLabelAssigner(ch);
    });

    const notesItem = menu.createDiv('novalist-pb-ctx-item');
    notesItem.textContent = t('plotBoard.editNotes');
    notesItem.addEventListener('click', () => {
      menu.remove();
      this.showNotesEditor(ch);
    });

    const openItem = menu.createDiv('novalist-pb-ctx-item');
    openItem.textContent = t('plotBoard.openChapter');
    openItem.addEventListener('click', () => {
      menu.remove();
      void this.app.workspace.openLinkText(ch.file.path, '', false);
    });

    document.body.appendChild(menu);

    const close = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        document.removeEventListener('click', close, true);
      }
    };
    setTimeout(() => document.addEventListener('click', close, true), 0);
  }

  /* ─── color picker ──────────────────────────────────────────────── */

  private showColorPicker(ch: BoardChapter): void {
    const overlay = document.createElement('div');
    overlay.classList.add('novalist-pb-overlay');

    const panel = overlay.createDiv('novalist-pb-color-panel');
    panel.createEl('h4', { text: t('plotBoard.setColor') });

    const presets = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6', '#1abc9c', '#95a5a6'];
    const grid = panel.createDiv('novalist-pb-color-grid');
    for (const color of presets) {
      const swatch = grid.createDiv('novalist-pb-color-swatch');
      swatch.style.backgroundColor = color;
      if (this.getCardColor(ch.id) === color) swatch.classList.add('is-selected');
      swatch.addEventListener('click', () => {
        this.setCardColor(ch.id, color);
        overlay.remove();
        void this.render();
      });
    }

    const clearBtn = panel.createEl('button', { text: t('plotBoard.clearColor'), cls: 'novalist-pb-color-clear' });
    clearBtn.addEventListener('click', () => {
      this.setCardColor(ch.id, '');
      overlay.remove();
      void this.render();
    });

    const closeBtn = panel.createEl('button', { text: t('plotBoard.cancel'), cls: 'novalist-pb-color-close' });
    closeBtn.addEventListener('click', () => overlay.remove());

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  /* ─── label assigner ────────────────────────────────────────────── */

  private showLabelAssigner(ch: BoardChapter): void {
    const overlay = document.createElement('div');
    overlay.classList.add('novalist-pb-overlay');

    const panel = overlay.createDiv('novalist-pb-label-panel');
    panel.createEl('h4', { text: t('plotBoard.assignLabels') });

    if (this.labels.length === 0) {
      panel.createEl('p', { text: t('plotBoard.noLabels'), cls: 'novalist-text-muted' });
    } else {
      const list = panel.createDiv('novalist-pb-label-list');
      const currentIds = this.board.cardLabels[ch.id] ?? [];
      for (const lbl of this.labels) {
        const row = list.createDiv('novalist-pb-label-row');
        const cb = row.createEl('input', { type: 'checkbox' });
        cb.checked = currentIds.includes(lbl.id);
        cb.addEventListener('change', () => {
          this.toggleCardLabel(ch.id, lbl.id);
        });
        const badge = row.createEl('span', { text: lbl.name, cls: 'novalist-pb-label-badge' });
        badge.style.backgroundColor = lbl.color;
        badge.style.color = this.contrastText(lbl.color);
      }
    }

    const closeBtn = panel.createEl('button', { text: t('plotBoard.done'), cls: 'novalist-pb-panel-close' });
    closeBtn.addEventListener('click', () => { overlay.remove(); void this.render(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); void this.render(); } });
    document.body.appendChild(overlay);
  }

  /* ─── notes editor overlay ──────────────────────────────────────── */

  private showNotesEditor(ch: BoardChapter): void {
    const overlay = document.createElement('div');
    overlay.classList.add('novalist-pb-overlay');

    const panel = overlay.createDiv('novalist-pb-notes-panel');
    panel.createEl('h4', { text: `${ch.name} \u2014 ${t('plotBoard.editNotes')}` });

    const columns = this.board.columns;
    if (columns.length === 0) {
      panel.createEl('p', { text: t('plotBoard.noColumnsHint'), cls: 'novalist-text-muted' });
    }

    const fields: { colId: string; chapterKey: string; textarea: HTMLTextAreaElement }[] = [];
    for (const col of columns) {
      const group = panel.createDiv('novalist-pb-note-group');
      group.createEl('label', { text: col.name, cls: 'novalist-pb-note-label' });
      const ta = group.createEl('textarea', {
        cls: 'novalist-pb-note-textarea',
        text: this.getCellText(ch.id, col.id)
      });
      ta.rows = 3;
      fields.push({ colId: col.id, chapterKey: ch.id, textarea: ta });
    }

    // Scenes section
    if (ch.scenes.length > 0) {
      panel.createEl('h5', { text: t('plotBoard.scenes') });
      for (const scene of ch.scenes) {
        const sceneKey = `${ch.id}:${scene}`;
        const sceneGroup = panel.createDiv('novalist-pb-note-scene-group');
        sceneGroup.createEl('span', { text: scene, cls: 'novalist-pb-note-scene-name' });
        for (const col of columns) {
          const sGroup = sceneGroup.createDiv('novalist-pb-note-group');
          sGroup.createEl('label', { text: col.name, cls: 'novalist-pb-note-label' });
          const ta = sGroup.createEl('textarea', {
            cls: 'novalist-pb-note-textarea',
            text: this.getCellText(sceneKey, col.id)
          });
          ta.rows = 2;
          fields.push({ colId: col.id, chapterKey: sceneKey, textarea: ta });
        }
      }
    }

    const btnRow = panel.createDiv('novalist-pb-note-btns');
    const saveBtn = btnRow.createEl('button', { text: t('plotBoard.save'), cls: 'novalist-pb-note-save' });
    saveBtn.addEventListener('click', () => {
      for (const f of fields) {
        this.setCellText(f.chapterKey, f.colId, f.textarea.value);
      }
      overlay.remove();
      void this.render();
    });
    const cancelBtn = btnRow.createEl('button', { text: t('plotBoard.cancel'), cls: 'novalist-pb-note-cancel' });
    cancelBtn.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  /* ─── labels management panel ───────────────────────────────────── */

  private showLabelsPanel(): void {
    const overlay = document.createElement('div');
    overlay.classList.add('novalist-pb-overlay');

    const panel = overlay.createDiv('novalist-pb-labels-mgmt');
    panel.createEl('h4', { text: t('plotBoard.manageLabels') });

    const renderList = () => {
      const listEl = panel.querySelector('.novalist-pb-labels-list');
      if (listEl) listEl.remove();
      const list = panel.createDiv('novalist-pb-labels-list');
      for (const lbl of this.labels) {
        const row = list.createDiv('novalist-pb-labels-row');
        const badge = row.createEl('span', { text: lbl.name, cls: 'novalist-pb-label-badge' });
        badge.style.backgroundColor = lbl.color;
        badge.style.color = this.contrastText(lbl.color);
        const delBtn = row.createEl('button', { text: '\u2715', cls: 'novalist-pb-labels-del' });
        delBtn.addEventListener('click', () => {
          this.deleteLabel(lbl.id);
          renderList();
        });
      }
    };

    renderList();

    // Add new label
    const addRow = panel.createDiv('novalist-pb-labels-add');
    const nameInput = addRow.createEl('input', {
      cls: 'novalist-pb-labels-name',
      attr: { placeholder: t('plotBoard.labelNamePlaceholder') }
    });
    const colorInput = addRow.createEl('input', { type: 'color', cls: 'novalist-pb-labels-color', value: '#3498db' });
    const addBtn = addRow.createEl('button', { text: t('plotBoard.add'), cls: 'novalist-pb-labels-add-btn' });
    addBtn.addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) return;
      this.addLabel(name, colorInput.value);
      nameInput.value = '';
      renderList();
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
    });

    const closeBtn = panel.createEl('button', { text: t('plotBoard.done'), cls: 'novalist-pb-panel-close' });
    closeBtn.addEventListener('click', () => { overlay.remove(); void this.render(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); void this.render(); } });
    document.body.appendChild(overlay);
  }

  /* ════════════════════════════════════════════════════════════════════
     TABLE VIEW (original spreadsheet style, preserved & enhanced)
     ════════════════════════════════════════════════════════════════════ */

  private renderTableView(container: HTMLElement): void {
    const chapters = this.cachedChapters;
    const columns: PlotBoardColumn[] = this.board.columns;

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

      // Color stripe on row
      const cardColor = this.getCardColor(ch.id);
      if (cardColor) {
        tr.style.borderLeft = `4px solid ${cardColor}`;
      }

      tr.createEl('td', { text: String(ch.order), cls: 'novalist-plot-board-td-index' });

      const nameTd = tr.createEl('td', { cls: 'novalist-plot-board-td-chapter' });
      const nameLink = nameTd.createEl('a', { text: ch.name, cls: 'novalist-plot-board-chapter-link' });
      nameLink.addEventListener('click', (e) => {
        e.preventDefault();
        void this.app.workspace.openLinkText(ch.file.path, '', false);
      });

      // Labels inline
      const assignedLabels = this.getCardLabels(ch.id);
      if (assignedLabels.length > 0) {
        const lc = nameTd.createDiv('novalist-pb-card-labels novalist-pb-card-labels-inline');
        for (const lbl of assignedLabels) {
          const badge = lc.createEl('span', { text: lbl.name, cls: 'novalist-pb-label-badge novalist-pb-label-badge-sm' });
          badge.style.backgroundColor = lbl.color;
          badge.style.color = this.contrastText(lbl.color);
        }
      }

      // Custom columns
      for (const col of columns) {
        const td = tr.createEl('td', { cls: 'novalist-plot-board-td-cell' });
        this.renderCell(td, ch.id, col.id);
      }

      // Scene rows
      if (ch.scenes && ch.scenes.length > 0) {
        for (const scene of ch.scenes) {
          const sceneTr = tbody.createEl('tr', { cls: 'novalist-plot-board-scene-row' });
          sceneTr.createEl('td', { cls: 'novalist-plot-board-td-index' });
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

    const actions = th.createDiv('novalist-plot-board-col-actions');

    if (this.board.columns.indexOf(col) > 0) {
      const leftBtn = actions.createEl('button', { text: '\u2190', cls: 'novalist-plot-board-col-btn', attr: { 'aria-label': t('plotBoard.moveLeft') } });
      leftBtn.addEventListener('click', () => this.moveColumn(col.id, -1));
    }

    if (this.board.columns.indexOf(col) < this.board.columns.length - 1) {
      const rightBtn = actions.createEl('button', { text: '\u2192', cls: 'novalist-plot-board-col-btn', attr: { 'aria-label': t('plotBoard.moveRight') } });
      rightBtn.addEventListener('click', () => this.moveColumn(col.id, 1));
    }

    const delBtn = actions.createEl('button', { text: '\u2715', cls: 'novalist-plot-board-col-btn novalist-plot-board-col-del', attr: { 'aria-label': t('plotBoard.deleteColumn') } });
    delBtn.addEventListener('click', () => this.deleteColumn(col.id));
  }

  /* ─────────────────────── editable cell ─────────────────────────── */

  private renderCell(td: HTMLElement, chapterId: string, columnId: string): void {
    const text = this.getCellText(chapterId, columnId);
    const isEditing = this.editingCell?.chapterId === chapterId && this.editingCell?.columnId === columnId;

    if (isEditing) {
      const textarea = td.createEl('textarea', { cls: 'novalist-plot-board-cell-editor', text });
      textarea.rows = 3;
      setTimeout(() => { textarea.focus(); }, 0);

      const commit = () => {
        this.editingCell = null;
        this.setCellText(chapterId, columnId, textarea.value);
        void this.render();
      };

      textarea.addEventListener('blur', commit);
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { this.editingCell = null; void this.render(); }
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

  /* ─────────────────────── utility ───────────────────────────────── */

  /** Return black or white depending on background luminance. */
  private contrastText(hex: string): string {
    const rgb = parseInt(hex.replace('#', ''), 16);
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum > 160 ? '#000' : '#fff';
  }
}
