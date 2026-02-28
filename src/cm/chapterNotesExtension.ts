import {
  Facet,
  StateEffect,
  type Extension
} from '@codemirror/state';
import {
  ViewPlugin,
  EditorView,
  type ViewUpdate,
  type PluginValue
} from '@codemirror/view';
import { setIcon } from 'obsidian';
import type { TranslationKey } from '../i18n';

// ─── State effect for toggling visibility ───────────────────────────
export const setChapterNotesVisibleEffect = StateEffect.define<boolean>();

// ─── Callbacks from the plugin ──────────────────────────────────────
export interface ChapterNotesCallbacks {
  isChapterFile: () => boolean;
  getChapterGuid: () => string | null;
  getChapterNote: (guid: string) => string;
  getSceneNote: (guid: string, sceneName: string) => string;
  saveChapterNote: (guid: string, note: string) => void;
  saveSceneNote: (guid: string, sceneName: string, note: string) => void;
  moveContentToNotes: () => void;
  isEnabled: () => boolean;
  t: (key: TranslationKey) => string;
  renderMarkdown: (markdown: string, container: HTMLElement) => void;
}

export const chapterNotesCallbacks = Facet.define<ChapterNotesCallbacks, ChapterNotesCallbacks>({
  combine: (values) => values[0] ?? {
    isChapterFile: () => false,
    getChapterGuid: () => null,
    getChapterNote: () => '',
    getSceneNote: () => '',
    saveChapterNote: () => {/* no-op */},
    saveSceneNote: () => {/* no-op */},
    moveContentToNotes: () => {/* no-op */},
    isEnabled: () => false,
    t: (key: string) => key,
    renderMarkdown: () => {/* no-op */},
  }
});

// ─── Heading detection ──────────────────────────────────────────────
interface HeadingInfo {
  type: 'chapter' | 'scene';
  name: string;
  pos: number;
}

function getHeadings(view: EditorView): HeadingInfo[] {
  const doc = view.state.doc;
  const headings: HeadingInfo[] = [];
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text;
    if (/^#\s+/.test(text) && !/^##/.test(text)) {
      const name = text.replace(/^#\s+/, '').trim();
      if (name) headings.push({ type: 'chapter', name, pos: line.from });
    } else if (/^##\s+/.test(text) && !/^###/.test(text)) {
      const name = text.replace(/^##\s+/, '').trim();
      if (name) headings.push({ type: 'scene', name, pos: line.from });
    }
  }
  return headings;
}

// ─── Y position helper (mirrors annotation extension) ───────────────
function getTopForPos(view: EditorView, pos: number, refEl: HTMLElement): number | null {
  try {
    const coords = view.coordsAtPos(pos);
    if (!coords) return null;
    const refRect = refEl.getBoundingClientRect();
    return coords.top - refRect.top + view.scrollDOM.scrollTop;
  } catch {
    return null;
  }
}

// ─── Left-side Notes Panel ──────────────────────────────────────────
// Wrapper is appended OUTSIDE the CM6 DOM tree (sibling of .cm-editor)
// to avoid CM6 mutation-triggered update loops.
class ChapterNotesPanelPlugin implements PluginValue {
  private wrapper: HTMLElement;
  private container: HTMLElement;
  private view: EditorView;
  private scrollHandler: () => void;
  private destroyed = false;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private heightTimerId: ReturnType<typeof setTimeout> | null = null;
  /** Track per-card collapsed state across re-renders. cardKey = '__chapter__' or scene name. */
  private collapsedCards = new Set<string>();

  constructor(view: EditorView) {
    this.view = view;

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'novalist-chapter-notes-wrapper';

    this.container = document.createElement('div');
    this.container.className = 'novalist-chapter-notes-container';
    this.wrapper.appendChild(this.container);

    const parent = view.dom.parentElement;
    if (parent) {
      parent.appendChild(this.wrapper);
    } else {
      view.dom.appendChild(this.wrapper);
    }

    this.scrollHandler = () => { if (!this.destroyed) this.syncScroll(); };
    view.scrollDOM.addEventListener('scroll', this.scrollHandler, { passive: true });

    this.scheduleRender();
  }

  update(update: ViewUpdate): void {
    if (this.destroyed) return;
    const hasVisibilityEffect = update.transactions.some(tr =>
      tr.effects.some(e => e.is(setChapterNotesVisibleEffect))
    );
    if (update.docChanged || update.viewportChanged || hasVisibilityEffect) {
      this.scheduleRender();
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timerId !== null) clearTimeout(this.timerId);
    if (this.heightTimerId !== null) clearTimeout(this.heightTimerId);
    this.view.scrollDOM.removeEventListener('scroll', this.scrollHandler);
    this.view.dom.classList.remove('novalist-has-chapter-notes');
    this.wrapper.remove();
  }

  private syncScroll(): void {
    const scrollTop = this.view.scrollDOM.scrollTop;
    this.container.setCssStyles({ transform: `translateY(${-scrollTop}px)` });

    // ── How far below the wrapper top does the visible scroller start? ──
    const wrapperRect = this.wrapper.getBoundingClientRect();
    const scrollerRect = this.view.scrollDOM.getBoundingClientRect();
    const ribbonOffset = Math.max(0, scrollerRect.top - wrapperRect.top);

    // Clip anything that renders above the ribbon (non-sticky cards scrolling up)
    this.wrapper.style.clipPath = `inset(${ribbonOffset}px 0 0 0)`;

    // ── Sticky card: pin the last card that has scrolled off the top ──
    const children = Array.from(this.container.children) as HTMLElement[];
    if (children.length === 0) return;

    // Find the last card whose natural position is above the visible top.
    let stickyIndex = -1;
    for (let i = 0; i < children.length; i++) {
      const layoutTop = parseFloat(children[i].dataset.layoutTop ?? '0');
      if (layoutTop < scrollTop + ribbonOffset) stickyIndex = i;
      else break;
    }

    const STICKY_GAP = 4;
    for (let i = 0; i < children.length; i++) {
      const el = children[i];
      const layoutTop = parseFloat(el.dataset.layoutTop ?? '0');
      if (i === stickyIndex) {
        // Pin the card so it sits just below the ribbon (edge of visible area)
        let stickyTop = scrollTop + ribbonOffset;
        // Don't overlap the next card
        if (i + 1 < children.length) {
          const nextEl = children[i + 1];
          const nextLayoutTop = parseFloat(nextEl.dataset.layoutTop ?? '0');
          const maxTop = nextLayoutTop - el.offsetHeight - STICKY_GAP;
          if (stickyTop > maxTop) stickyTop = maxTop;
        }
        el.setCssStyles({ top: `${stickyTop}px` });
        el.classList.add('is-sticky');
      } else {
        el.setCssStyles({ top: `${layoutTop}px` });
        el.classList.remove('is-sticky');
      }
    }
  }

  private scheduleRender(): void {
    if (this.timerId !== null) clearTimeout(this.timerId);
    this.timerId = setTimeout(() => {
      this.timerId = null;
      if (!this.destroyed) this.doRender();
    }, 0);
  }

  private scheduleRelayout(): void {
    if (this.heightTimerId !== null) clearTimeout(this.heightTimerId);
    this.heightTimerId = setTimeout(() => {
      this.heightTimerId = null;
      if (this.destroyed) return;
      const MIN_GAP = 8;
      let prevBottom = 0;
      const children = this.container.children;
      for (let i = 0; i < children.length; i++) {
        const el = children[i] as HTMLElement;
        const targetTop = parseFloat(el.dataset.targetTop ?? '0');
        let top = targetTop;
        if (top < prevBottom + MIN_GAP) top = prevBottom + MIN_GAP;
        el.dataset.layoutTop = String(top);
        el.setCssStyles({ top: `${top}px` });
        prevBottom = top + el.offsetHeight;
      }
      this.syncScroll();
    }, 0);
  }

  private doRender(): void {
    const cb = this.view.state.facet(chapterNotesCallbacks);
    const enabled = cb.isEnabled() && cb.isChapterFile();

    this.wrapper.classList.toggle('novalist-hidden', !enabled);
    this.view.dom.classList.toggle('novalist-has-chapter-notes', enabled);

    if (!enabled) {
      this.container.empty();
      return;
    }

    const guid = cb.getChapterGuid();
    if (!guid) {
      this.container.empty();
      return;
    }

    const headings = getHeadings(this.view);
    if (headings.length === 0) {
      this.container.empty();
      return;
    }

    const positions: Array<{ heading: HeadingInfo; top: number }> = [];
    for (const heading of headings) {
      const top = getTopForPos(this.view, heading.pos, this.wrapper);
      if (top !== null) positions.push({ heading, top });
    }

    this.renderCards(positions, guid, cb);
  }

  private renderCards(
    cards: Array<{ heading: HeadingInfo; top: number }>,
    guid: string,
    cb: ChapterNotesCallbacks
  ): void {
    this.container.empty();
    if (cards.length === 0) return;

    const MIN_GAP = 8;
    const entries: Array<{ el: HTMLElement; targetTop: number }> = [];

    for (const { heading, top } of cards) {
      const el = this.createCard(heading, guid, cb);
      el.dataset.targetTop = `${top}`;
      el.setCssStyles({ top: `${top}px` });
      this.container.appendChild(el);
      entries.push({ el, targetTop: top });
    }

    // Deferred relayout: push cards down if they overlap
    if (this.heightTimerId !== null) clearTimeout(this.heightTimerId);
    this.heightTimerId = setTimeout(() => {
      this.heightTimerId = null;
      if (this.destroyed) return;
      let prevBottom = 0;
      for (const entry of entries) {
        let top = entry.targetTop;
        if (top < prevBottom + MIN_GAP) top = prevBottom + MIN_GAP;
        entry.el.dataset.layoutTop = String(top);
        entry.el.setCssStyles({ top: `${top}px` });
        prevBottom = top + entry.el.offsetHeight;
      }
      this.syncScroll();
    }, 0);
  }

  private createCard(
    heading: HeadingInfo,
    guid: string,
    cb: ChapterNotesCallbacks
  ): HTMLElement {
    const cardKey = heading.type === 'chapter' ? '__chapter__' : heading.name;
    const isCollapsed = this.collapsedCards.has(cardKey);

    const note = heading.type === 'chapter'
      ? cb.getChapterNote(guid)
      : cb.getSceneNote(guid, heading.name);

    const card = document.createElement('div');
    card.className = `novalist-chapter-note-card${isCollapsed ? ' is-collapsed' : ''}`;
    card.dataset.cardKey = cardKey;

    // ── Header ──────────────────────────────────────────────────────
    const header = card.createDiv('novalist-chapter-note-card-header');

    // Collapse toggle
    const toggleBtn = header.createEl('button', {
      cls: 'novalist-chapter-note-toggle-btn',
      attr: { 'aria-label': isCollapsed ? cb.t('chapterNotes.expand') : cb.t('chapterNotes.collapse') }
    });
    setIcon(toggleBtn, isCollapsed ? 'chevron-right' : 'chevron-down');
    toggleBtn.addEventListener('click', () => {
      const nowCollapsed = card.classList.toggle('is-collapsed');
      if (nowCollapsed) {
        this.collapsedCards.add(cardKey);
      } else {
        this.collapsedCards.delete(cardKey);
      }
      setIcon(toggleBtn, nowCollapsed ? 'chevron-right' : 'chevron-down');
      toggleBtn.setAttribute('aria-label', nowCollapsed ? cb.t('chapterNotes.expand') : cb.t('chapterNotes.collapse'));
      this.scheduleRelayout();
    });

    // Icon + title
    const titleEl = header.createDiv('novalist-chapter-note-title');
    setIcon(titleEl, heading.type === 'chapter' ? 'book-open' : 'align-left');
    titleEl.createEl('span', {
      text: heading.name.length > 28 ? heading.name.substring(0, 28) + '…' : heading.name,
      cls: 'novalist-chapter-note-title-text'
    });

    // Header actions
    const actions = header.createDiv('novalist-chapter-note-actions');
    if (heading.type === 'chapter') {
      const moveBtn = actions.createEl('button', {
        cls: 'novalist-chapter-note-action-btn',
        attr: { 'aria-label': cb.t('chapterNotes.moveToNotes') }
      });
      setIcon(moveBtn, 'arrow-left-from-line');
      moveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cb.moveContentToNotes();
      });
    }

    // ── Body ────────────────────────────────────────────────────────
    const body = card.createDiv('novalist-chapter-note-card-body');

    let isEditing = false;
    let currentNote = note;

    // Read view
    const renderView = body.createDiv('novalist-chapter-note-render');
    this.renderNoteContent(renderView, currentNote, cb);

    // Edit textarea (hidden initially)
    const textarea = body.createEl('textarea', {
      cls: 'novalist-chapter-note-textarea novalist-hidden',
    });
    textarea.value = note;

    // Action bar (hidden initially)
    const actionBar = body.createDiv('novalist-chapter-note-action-bar novalist-hidden');
    const saveBtn = actionBar.createEl('button', {
      cls: 'novalist-chapter-note-save-btn mod-cta',
      text: cb.t('chapterNotes.save')
    });
    const cancelBtn = actionBar.createEl('button', {
      cls: 'novalist-chapter-note-cancel-btn',
      text: cb.t('chapterNotes.cancel')
    });

    const enterEditMode = () => {
      if (isEditing) return;
      isEditing = true;
      textarea.value = currentNote;
      renderView.addClass('novalist-hidden');
      textarea.removeClass('novalist-hidden');
      actionBar.removeClass('novalist-hidden');
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }, 0);
      this.scheduleRelayout();
    };

    const saveEdit = () => {
      if (!isEditing) return;
      isEditing = false;
      const newNote = textarea.value;
      currentNote = newNote;
      // Persist
      if (heading.type === 'chapter') {
        cb.saveChapterNote(guid, newNote);
      } else {
        cb.saveSceneNote(guid, heading.name, newNote);
      }
      // Re-render view
      renderView.empty();
      this.renderNoteContent(renderView, currentNote, cb);
      renderView.removeClass('novalist-hidden');
      textarea.addClass('novalist-hidden');
      actionBar.addClass('novalist-hidden');
      this.scheduleRelayout();
    };

    const cancelEdit = () => {
      if (!isEditing) return;
      isEditing = false;
      textarea.value = currentNote;
      renderView.removeClass('novalist-hidden');
      textarea.addClass('novalist-hidden');
      actionBar.addClass('novalist-hidden');
      this.scheduleRelayout();
    };

    // Click rendered view to enter edit mode
    renderView.addEventListener('click', enterEditMode);

    saveBtn.addEventListener('click', saveEdit);
    cancelBtn.addEventListener('click', cancelEdit);

    // Ctrl/Cmd+Enter to save; Escape to cancel
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    });

    // Auto-save on blur (e.g. clicking elsewhere)
    textarea.addEventListener('blur', () => {
      if (isEditing) saveEdit();
    });

    // Prevent CM editor from stealing focus when interacting with card inputs
    card.addEventListener('mousedown', (e) => {
      if (
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLButtonElement ||
        (e.target instanceof HTMLElement && e.target.closest('button'))
      ) {
        e.stopPropagation();
      }
    });

    return card;
  }

  private renderNoteContent(container: HTMLElement, note: string, cb: ChapterNotesCallbacks): void {
    if (note.trim()) {
      cb.renderMarkdown(note, container);
    } else {
      container.createEl('span', {
        cls: 'novalist-chapter-note-placeholder',
        text: cb.t('chapterNotes.placeholder')
      });
    }
  }
}

const chapterNotesPanelPlugin = ViewPlugin.fromClass(ChapterNotesPanelPlugin);

// ─── Public: create the full extension ─────────────────────────────
export function chapterNotesExtension(callbacks: ChapterNotesCallbacks): Extension {
  return [
    chapterNotesCallbacks.of(callbacks),
    chapterNotesPanelPlugin,
  ];
}
