import {
  StateField,
  StateEffect,
  RangeSetBuilder,
  Facet,
  type Extension,
  type EditorState
} from '@codemirror/state';
import {
  Decoration,
  ViewPlugin,
  EditorView,
  type DecorationSet,
  type ViewUpdate,
  type PluginValue
} from '@codemirror/view';
import { setIcon } from 'obsidian';
import type { CommentThread } from '../types';

// ─── Effects ────────────────────────────────────────────────────────
/** Replace the full set of threads visible in this editor. */
export const setThreadsEffect = StateEffect.define<CommentThread[]>();

/** Mark a thread resolved / unresolved. */
export const resolveThreadEffect = StateEffect.define<{ id: string; resolved: boolean }>();

// ─── Facet: callbacks the ViewPlugin can call back into the plugin ──
export interface AnnotationCallbacks {
  onAddThread: (anchorText: string, from: number, to: number) => void;
  onAddMessage: (threadId: string, content: string) => void;
  onResolveThread: (threadId: string, resolved: boolean) => void;
  onDeleteThread: (threadId: string) => void;
  onDeleteMessage: (threadId: string, messageId: string) => void;
  getActiveFilePath: () => string | null;
}

export const annotationCallbacks = Facet.define<AnnotationCallbacks, AnnotationCallbacks>({
  combine: (values) => values[0] ?? {
    onAddThread: () => {/* no-op */},
    onAddMessage: () => {/* no-op */},
    onResolveThread: () => {/* no-op */},
    onDeleteThread: () => {/* no-op */},
    onDeleteMessage: () => {/* no-op */},
    getActiveFilePath: () => null
  }
});

// ─── State field: list of threads ──────────────────────────────────
export const threadsField = StateField.define<CommentThread[]>({
  create: () => [],
  update(threads, tr) {
    for (const e of tr.effects) {
      if (e.is(setThreadsEffect)) return e.value;
      if (e.is(resolveThreadEffect)) {
        return threads.map(t =>
          t.id === e.value.id ? { ...t, resolved: e.value.resolved } : t
        );
      }
    }
    if (tr.docChanged) {
      return threads.map(t => {
        const newFrom = tr.changes.mapPos(t.from, 1);
        const newTo = tr.changes.mapPos(t.to, -1);
        if (newFrom >= newTo) return null;
        return { ...t, from: newFrom, to: newTo };
      }).filter((t): t is CommentThread => t !== null);
    }
    return threads;
  }
});

// ─── Decorations derived from threads state ─────────────────────────
const highlightDecoration = (threadId: string) =>
  Decoration.mark({
    class: 'novalist-annotation-highlight',
    attributes: {
      'data-thread-id': threadId
    }
  });

const threadDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(prev, tr) {
    const hasRelevantChange = tr.docChanged || tr.effects.some(
      e => e.is(setThreadsEffect) || e.is(resolveThreadEffect)
    );
    if (!hasRelevantChange) return prev;

    const threads = tr.state.field(threadsField);
    const sorted = threads
      .filter(t => !t.resolved)
      .sort((a, b) => a.from - b.from || a.to - b.to);

    if (sorted.length === 0 && prev === Decoration.none) return Decoration.none;

    const builder = new RangeSetBuilder<Decoration>();
    for (const t of sorted) {
      if (t.from < t.to && t.to <= tr.state.doc.length) {
        builder.add(t.from, t.to, highlightDecoration(t.id));
      }
    }
    return builder.finish();
  },
  provide: (f) => EditorView.decorations.from(f)
});

// ─── Annotation colours palette ────────────────────────────────────
const ANNOTATION_COLORS = [
  '#fbbf24', '#60a5fa', '#34d399', '#f472b6',
  '#a78bfa', '#fb923c', '#2dd4bf', '#e879f9'
];
let colorIdx = 0;
export function nextAnnotationColor(): string {
  const c = ANNOTATION_COLORS[colorIdx % ANNOTATION_COLORS.length];
  colorIdx++;
  return c;
}

// ─── Helper: compute Y position of a document offset ───────────────
// Positions are relative to a reference element + scroll offset,
// so that translateY(-scrollTop) gives the correct visual alignment.
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

// ─── Selection tooltip: "+" button when text is selected ───────────
// Appended to document.body with position:fixed; zero CM6 DOM interaction.
let tooltipEl: HTMLElement | null = null;
let tooltipCleanup: (() => void) | null = null;
let pendingFocusThreadId: string | null = null;

function removeAnnotationTooltip(): void {
  if (tooltipEl) {
    tooltipEl.remove();
    tooltipEl = null;
  }
  if (tooltipCleanup) {
    tooltipCleanup();
    tooltipCleanup = null;
  }
}

function showAnnotationTooltip(view: EditorView): void {
  const sel = view.state.selection.main;
  if (sel.empty) { removeAnnotationTooltip(); return; }
  try {
    const coords = view.coordsAtPos(sel.to);
    if (!coords) { removeAnnotationTooltip(); return; }
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'novalist-annotation-tooltip';
      const btn = document.createElement('button');
      btn.className = 'novalist-annotation-tooltip-btn';
      btn.setAttribute('aria-label', 'Add comment');
      setIcon(btn, 'plus');
      tooltipEl.appendChild(btn);
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cb = view.state.facet(annotationCallbacks);
        const curSel = view.state.selection.main;
        if (!curSel.empty) {
          const text = view.state.sliceDoc(curSel.from, curSel.to);
          // Signal that the next new thread should receive input focus
          pendingFocusThreadId = 'pending';
          cb.onAddThread(text, curSel.from, curSel.to);
        }
        removeAnnotationTooltip();
      });
      document.body.appendChild(tooltipEl);
      // Auto-dismiss when clicking outside
      const onDocClick = (ev: MouseEvent) => {
        if (tooltipEl && !tooltipEl.contains(ev.target as Node)) {
          removeAnnotationTooltip();
        }
      };
      document.addEventListener('mousedown', onDocClick, true);
      tooltipCleanup = () => document.removeEventListener('mousedown', onDocClick, true);
    }
    tooltipEl.setCssStyles({
      top: `${coords.bottom + 4}px`,
      left: `${coords.left}px`
    });
  } catch {
    removeAnnotationTooltip();
  }
}

const tooltipHandlers = EditorView.domEventHandlers({
  mouseup(_e: MouseEvent, view: EditorView) {
    setTimeout(() => showAnnotationTooltip(view), 20);
    return false;
  },
  keyup(e: KeyboardEvent, view: EditorView) {
    if (e.shiftKey || e.key === 'Shift') {
      setTimeout(() => showAnnotationTooltip(view), 20);
    }
    return false;
  }
});

// ─── Right-side Comments Panel ─────────────────────────────────────
// Wrapper is appended OUTSIDE the CM6 DOM tree (sibling of .cm-editor)
// to avoid CM6 mutation-triggered update loops. Rendering is deferred
// to macro-tasks via setTimeout.
class AnnotationPanelPlugin implements PluginValue {
  private wrapper: HTMLElement;
  private container: HTMLElement;
  private view: EditorView;
  private activeThreadId: string | null = null;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private heightTimerId: ReturnType<typeof setTimeout> | null = null;
  private lastThreadKey = '';
  private scrollHandler: () => void;
  private destroyed = false;
  private expandedThreads = new Set<string>();
  private knownThreadIds = new Set<string>();

  constructor(view: EditorView) {
    this.view = view;

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'novalist-annotation-panel-wrapper';

    this.container = document.createElement('div');
    this.container.className = 'novalist-annotation-panel';
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
    const hasThreadEffect = update.transactions.some(tr =>
      tr.effects.some(e => e.is(setThreadsEffect) || e.is(resolveThreadEffect))
    );
    if (update.docChanged || hasThreadEffect) {
      this.scheduleRender();
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timerId !== null) clearTimeout(this.timerId);
    if (this.heightTimerId !== null) clearTimeout(this.heightTimerId);
    this.view.scrollDOM.removeEventListener('scroll', this.scrollHandler);
    this.wrapper.remove();
  }

  private syncScroll(): void {
    const scrollTop = this.view.scrollDOM.scrollTop;
    this.container.setCssStyles({ transform: `translateY(${-scrollTop}px)` });
  }

  private scheduleRender(): void {
    if (this.timerId !== null) clearTimeout(this.timerId);
    this.timerId = setTimeout(() => {
      this.timerId = null;
      if (!this.destroyed) this.doRender();
    }, 0);
  }

  /** Re-position existing cards without recreating them (e.g. after collapse/expand). */
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
        const targetTop = parseFloat(el.dataset.targetTop ?? el.style.top);
        let top = targetTop;
        if (top < prevBottom + MIN_GAP) {
          top = prevBottom + MIN_GAP;
        }
        el.setCssStyles({ top: `${top}px` });
        prevBottom = top + el.offsetHeight;
      }
      this.syncScroll();
    }, 0);
  }

  private doRender(): void {
    let threads: CommentThread[];
    try {
      threads = this.view.state.field(threadsField);
    } catch {
      return;
    }
    const unresolvedThreads = threads.filter(t => !t.resolved);

    const key = unresolvedThreads
      .map(t => `${t.id}:${t.from}:${t.to}:${t.messages.length}`)
      .join('|');
    if (key === this.lastThreadKey) return;
    this.lastThreadKey = key;

    // Auto-expand newly added threads
    for (const t of unresolvedThreads) {
      if (!this.knownThreadIds.has(t.id)) {
        this.expandedThreads.add(t.id);
        // If a focus was requested (+ button), assign the actual thread ID
        if (pendingFocusThreadId === 'pending') {
          pendingFocusThreadId = t.id;
        }
      }
    }
    // Update known set
    this.knownThreadIds = new Set(unresolvedThreads.map(t => t.id));

    const positions: Array<{ thread: CommentThread; top: number }> = [];
    for (const thread of unresolvedThreads) {
      const top = getTopForPos(this.view, thread.from, this.wrapper);
      if (top !== null) {
        positions.push({ thread, top });
      }
    }
    positions.sort((a, b) => a.top - b.top);
    this.renderCards(positions);
  }

  private renderCards(cards: Array<{ thread: CommentThread; top: number }>): void {
    const state = this.view.state;
    this.container.empty();

    if (cards.length === 0) return;

    const MIN_GAP = 8;

    // First pass: create all card elements and append them
    const entries: Array<{ el: HTMLElement; targetTop: number }> = [];
    for (const card of cards) {
      const el = this.createCard(card.thread, state);
      el.dataset.targetTop = `${card.top}`;
      el.setCssStyles({ top: `${card.top}px` });
      this.container.appendChild(el);
      entries.push({ el, targetTop: card.top });
    }

    // Second pass (after layout): position each card as close to its
    // target line as possible without overlapping the card above it.
    if (this.heightTimerId !== null) clearTimeout(this.heightTimerId);
    this.heightTimerId = setTimeout(() => {
      this.heightTimerId = null;
      if (this.destroyed) return;
      let prevBottom = 0;
      for (const entry of entries) {
        // Ideal position is the original target line
        let top = entry.targetTop;
        // But never overlap the previous card
        if (top < prevBottom + MIN_GAP) {
          top = prevBottom + MIN_GAP;
        }
        entry.el.setCssStyles({ top: `${top}px` });
        prevBottom = top + entry.el.offsetHeight;
      }
      this.syncScroll();
    }, 0);
  }

  private createCard(thread: CommentThread, state: EditorState): HTMLElement {
    const cb = state.facet(annotationCallbacks);
    const card = document.createElement('div');
    const isExpanded = this.expandedThreads.has(thread.id);
    card.className = `novalist-annotation-card${isExpanded ? '' : ' is-collapsed'}`;
    if (this.activeThreadId === thread.id) card.classList.add('is-active');
    card.dataset.threadId = thread.id;

    // ── Header: toggle + anchor text (clickable) ──
    const header = card.createDiv('novalist-annotation-card-header');

    const toggleBtn = header.createEl('button', {
      cls: 'novalist-annotation-toggle-btn',
      attr: { 'aria-label': 'Toggle thread' }
    });
    setIcon(toggleBtn, isExpanded ? 'chevron-down' : 'chevron-right');
    toggleBtn.addEventListener('click', () => {
      const collapsed = card.classList.toggle('is-collapsed');
      if (collapsed) {
        this.expandedThreads.delete(thread.id);
      } else {
        this.expandedThreads.add(thread.id);
      }
      setIcon(toggleBtn, collapsed ? 'chevron-right' : 'chevron-down');
      // Re-position cards after expand/collapse using actual heights
      this.scheduleRelayout();
    });

    const anchorSpan = header.createEl('span', {
      cls: 'novalist-annotation-anchor-text',
      text: thread.anchorText.length > 50
        ? thread.anchorText.substring(0, 50) + '…'
        : thread.anchorText
    });

    const msgCount = header.createEl('span', {
      cls: 'novalist-annotation-msg-count',
      text: `${thread.messages.length}`
    });
    setIcon(msgCount, 'message-square');
    msgCount.createSpan({ text: `${thread.messages.length}` });

    anchorSpan.addEventListener('click', () => {
      this.scrollToThread(thread);
    });

    // Action buttons in header
    const actions = header.createDiv('novalist-annotation-card-actions');

    const resolveBtn = actions.createEl('button', {
      cls: 'novalist-annotation-action-btn',
      attr: { 'aria-label': 'Resolve' }
    });
    setIcon(resolveBtn, 'check');
    resolveBtn.addEventListener('click', () => {
      cb.onResolveThread(thread.id, true);
    });

    const deleteBtn = actions.createEl('button', {
      cls: 'novalist-annotation-action-btn novalist-annotation-action-btn--danger',
      attr: { 'aria-label': 'Delete thread' }
    });
    setIcon(deleteBtn, 'x');
    deleteBtn.addEventListener('click', () => {
      cb.onDeleteThread(thread.id);
    });

    // ── Collapsible body: messages + input ──
    const body = card.createDiv('novalist-annotation-card-body');

    // ── Messages (chat-like) ──
    const messagesContainer = body.createDiv('novalist-annotation-messages');
    for (const msg of thread.messages) {
      const msgEl = messagesContainer.createDiv('novalist-annotation-message');

      const msgHeader = msgEl.createDiv('novalist-annotation-message-header');
      const timeStr = this.formatTime(msg.createdAt);
      msgHeader.createEl('span', { cls: 'novalist-annotation-message-time', text: timeStr });

      const msgDeleteBtn = msgHeader.createEl('button', {
        cls: 'novalist-annotation-action-btn novalist-annotation-action-btn--small',
        attr: { 'aria-label': 'Delete message' }
      });
      setIcon(msgDeleteBtn, 'x');
      msgDeleteBtn.addEventListener('click', () => {
        cb.onDeleteMessage(thread.id, msg.id);
      });

      msgEl.createDiv({ cls: 'novalist-annotation-message-text', text: msg.content });
    }

    // ── Input for new message ──
    const inputRow = body.createDiv('novalist-annotation-input-row');
    const input = inputRow.createEl('input', {
      cls: 'novalist-annotation-input',
      attr: { placeholder: 'Add a comment…', type: 'text' }
    });
    // Auto-focus input if this thread was just created via + button
    if (pendingFocusThreadId === thread.id) {
      pendingFocusThreadId = null;
      setTimeout(() => input.focus(), 0);
    }    const sendBtn = inputRow.createEl('button', {
      cls: 'novalist-annotation-send-btn',
      attr: { 'aria-label': 'Send' }
    });
    setIcon(sendBtn, 'send');

    const sendMessage = () => {
      const text = input.value.trim();
      if (!text) return;
      cb.onAddMessage(thread.id, text);
      input.value = '';
    };

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Prevent editor from stealing focus when interacting with card
    card.addEventListener('mousedown', (e) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLButtonElement ||
        (e.target instanceof HTMLElement && e.target.closest('button'))
      ) {
        e.stopPropagation();
      }
    });

    return card;
  }

  private scrollToThread(thread: CommentThread): void {
    const from = thread.from;
    const to = thread.to;
    if (from >= 0 && to <= this.view.state.doc.length) {
      this.view.dispatch({
        selection: { anchor: from, head: to },
        effects: EditorView.scrollIntoView(from, { y: 'center' })
      });
      this.view.focus();
    }
  }

  private formatTime(iso: string): string {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays < 7) return `${diffDays}d ago`;
      return d.toLocaleDateString();
    } catch {
      return '';
    }
  }
}

const annotationPanelPlugin = ViewPlugin.fromClass(AnnotationPanelPlugin);

// ─── Public: create the full extension ─────────────────────────────
export function annotationExtension(callbacks: AnnotationCallbacks): Extension {
  return [
    annotationCallbacks.of(callbacks),
    threadsField,
    threadDecorations,
    tooltipHandlers,
    annotationPanelPlugin
  ];
}
