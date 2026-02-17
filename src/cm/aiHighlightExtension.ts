import {
  StateField,
  StateEffect,
  RangeSetBuilder,
  Facet,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  type PluginValue,
  type DecorationSet,
} from '@codemirror/view';
import { setIcon } from 'obsidian';
import { t } from '../i18n';

// ─── Types ──────────────────────────────────────────────────────────

export type AiHighlightType = 'reference' | 'inconsistency' | 'suggestion';

export interface AiHighlight {
  /** Document offset — start. */
  from: number;
  /** Document offset — end. */
  to: number;
  /** Finding category. */
  type: AiHighlightType;
  /** Short heading for the finding. */
  title: string;
  /** Detailed description returned by the model. */
  description?: string;
  /** The relevant text excerpt from the chapter (if any). */
  excerpt?: string;
  /** Entity name this finding relates to (if any). */
  entityName?: string;
  /** Entity type (character / location / item / lore) if applicable. */
  entityType?: string;
}

// ─── Callbacks facet ────────────────────────────────────────────────

export interface AiHighlightCallbacks {
  /** Whether the current file belongs to the active project. */
  isProjectFile: () => boolean;
  /** Open the entity creation modal for a suggestion finding. */
  createEntity?: (highlight: AiHighlight) => void;
  /** Dismiss a finding (remove from sidebar + highlights). */
  dismissFinding?: (highlight: AiHighlight) => void;
}

export const aiHighlightCallbacks = Facet.define<AiHighlightCallbacks, AiHighlightCallbacks>({
  combine: (values) => values[0] ?? {
    isProjectFile: () => false,
  },
});

// ─── State effect: push a new set of highlights ─────────────────────

export const setAiHighlightsEffect = StateEffect.define<AiHighlight[]>();

export const clearAiHighlightsEffect = StateEffect.define<void>();

// ─── State field: current highlights ────────────────────────────────

export const aiHighlightsField = StateField.define<AiHighlight[]>({
  create: () => [],
  update(highlights, tr) {
    for (const e of tr.effects) {
      if (e.is(setAiHighlightsEffect)) return e.value;
      if (e.is(clearAiHighlightsEffect)) return [];
    }
    // Remap positions on doc changes
    if (tr.docChanged && highlights.length > 0) {
      return highlights.map(h => {
        const newFrom = tr.changes.mapPos(h.from, 1);
        const newTo = tr.changes.mapPos(h.to, -1);
        if (newFrom >= newTo) return null;
        return { ...h, from: newFrom, to: newTo };
      }).filter((h): h is AiHighlight => h !== null);
    }
    return highlights;
  },
});

// ─── Decorations derived from highlights ────────────────────────────

const makeDecoration = (type: AiHighlightType) =>
  Decoration.mark({
    class: `novalist-ai-highlight novalist-ai-highlight--${type}`,
  });

const aiDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(prev, tr) {
    const hasChange = tr.docChanged || tr.effects.some(
      e => e.is(setAiHighlightsEffect) || e.is(clearAiHighlightsEffect),
    );
    if (!hasChange) return prev;

    const highlights = tr.state.field(aiHighlightsField);
    if (highlights.length === 0) return Decoration.none;

    const sorted = [...highlights].sort((a, b) => a.from - b.from || a.to - b.to);
    const builder = new RangeSetBuilder<Decoration>();
    for (const h of sorted) {
      if (h.from < h.to && h.to <= tr.state.doc.length) {
        builder.add(h.from, h.to, makeDecoration(h.type));
      }
    }
    return builder.finish();
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ─── AI Highlight Peek Plugin ───────────────────────────────────────

class AiHighlightPeekPlugin implements PluginValue {
  private view: EditorView;
  private card: HTMLElement | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private currentHighlight: AiHighlight | null = null;
  private destroyed = false;
  private mouseInsideCard = false;
  private docClickHandler: ((e: MouseEvent) => void) | null = null;
  private lastHoverPos = -1;
  private readonly mouseMoveHandler: (e: MouseEvent) => void;
  private readonly mouseLeaveHandler: () => void;

  constructor(view: EditorView) {
    this.view = view;

    this.mouseMoveHandler = (e: MouseEvent) => {
      if (this.destroyed) return;
      if (e.buttons !== 0) return;

      const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos === null) return;
      if (pos === this.lastHoverPos) return;

      this.lastHoverPos = pos;
      this.schedulePeek(pos);
    };

    this.mouseLeaveHandler = () => {
      this.lastHoverPos = -1;
      this.hideCard();
    };

    this.view.dom.addEventListener('mousemove', this.mouseMoveHandler, { passive: true });
    this.view.dom.addEventListener('mouseleave', this.mouseLeaveHandler, { passive: true });
  }

  update(_update: ViewUpdate): void {
    // If highlights change while card is open, re-check validity
    if (this.card && this.currentHighlight) {
      const current = this.currentHighlight;
      const highlights = this.view.state.field(aiHighlightsField);
      const stillExists = highlights.some(
        h => h.from === current.from
          && h.to === current.to
          && h.type === current.type,
      );
      if (!stillExists) {
        this.removeCard();
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.clearDebounce();
    this.view.dom.removeEventListener('mousemove', this.mouseMoveHandler);
    this.view.dom.removeEventListener('mouseleave', this.mouseLeaveHandler);
    this.removeCard();
  }

  // ── Scheduling ────────────────────────────────────────────────────

  private schedulePeek(pos: number): void {
    this.clearDebounce();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.destroyed) return;
      this.checkHighlight(pos);
    }, 300);
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  // ── Highlight detection ───────────────────────────────────────────

  private checkHighlight(pos: number): void {
    if (this.destroyed) return;

    const cb = this.view.state.facet(aiHighlightCallbacks);
    if (!cb.isProjectFile()) {
      this.hideCard();
      return;
    }

    const highlight = this.getHighlightAtPos(pos);
    if (!highlight) {
      this.hideCard();
      return;
    }

    // Same highlight already showing → keep it
    if (
      this.currentHighlight
      && this.card
      && highlight.from === this.currentHighlight.from
      && highlight.to === this.currentHighlight.to
    ) {
      return;
    }

    this.showCard(highlight, pos);
  }

  private getHighlightAtPos(pos: number): AiHighlight | null {
    const highlights = this.view.state.field(aiHighlightsField);
    return highlights.find(h => pos >= h.from && pos <= h.to) ?? null;
  }

  private hideCard(): void {
    if (this.card) return; // Don't hide if card exists (user might move mouse to it)
    this.currentHighlight = null;
  }

  // ── Badge label ───────────────────────────────────────────────────

  private getBadgeLabel(type: AiHighlightType): string {
    switch (type) {
      case 'reference': return t('ollama.findingReference');
      case 'inconsistency': return t('ollama.findingInconsistency');
      case 'suggestion': return t('ollama.findingSuggestion');
    }
  }

  // ── Card rendering ────────────────────────────────────────────────

  private showCard(highlight: AiHighlight, pos: number): void {
    this.removeCard();
    this.currentHighlight = highlight;

    const coords = this.view.coordsAtPos(pos);
    if (!coords) return;

    const card = document.createElement('div');
    card.className = 'novalist-ai-peek-card';
    card.addClass(`novalist-ai-peek-card--${highlight.type}`);

    // Prevent editor stealing focus
    card.addEventListener('mousedown', (e) => {
      this.mouseInsideCard = true;
      e.stopPropagation();
    });

    // Keep card alive while mouse is inside
    card.addEventListener('mouseenter', () => {
      this.clearDebounce();
    });
    card.addEventListener('mouseleave', () => {
      this.hideCardDelayed();
    });

    // Header: badge + title
    const header = card.createDiv('novalist-ai-peek-header');
    const badgeLabel = this.getBadgeLabel(highlight.type);
    const badge = header.createEl('span', { text: badgeLabel, cls: 'novalist-ai-badge' });
    badge.addClass(`novalist-ai-badge--${highlight.type}`);

    header.createEl('span', { text: highlight.title, cls: 'novalist-ai-peek-title' });

    // Close button
    const closeBtn = header.createEl('button', {
      cls: 'novalist-ai-peek-close',
      attr: { 'aria-label': t('peek.close') },
    });
    setIcon(closeBtn, 'x');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.currentHighlight = null;
      this.removeCard();
    });

    // Description
    if (highlight.description) {
      card.createEl('p', { text: highlight.description, cls: 'novalist-ai-peek-desc' });
    }

    // Excerpt
    if (highlight.excerpt) {
      card.createEl('blockquote', { text: highlight.excerpt, cls: 'novalist-ai-peek-excerpt' });
    }

    // Entity info
    if (highlight.entityName) {
      const info = card.createDiv('novalist-ai-peek-entity');
      info.createEl('span', { text: highlight.entityName, cls: 'novalist-ai-entity-name' });
      if (highlight.entityType) {
        info.createEl('span', { text: ` (${highlight.entityType})`, cls: 'novalist-ai-entity-type' });
      }
    }

    // Action buttons
    const actions = card.createDiv('novalist-ai-peek-actions');
    const cb = this.view.state.facet(aiHighlightCallbacks);

    if (highlight.type === 'suggestion' && cb.createEntity) {
      const createBtn = actions.createEl('button', {
        text: t('ollama.createEntity'),
        cls: 'mod-cta novalist-ai-action-btn',
      });
      const createFn = cb.createEntity;
      createBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        createFn(highlight);
        this.currentHighlight = null;
        this.removeCard();
      });
    }

    if (cb.dismissFinding) {
      const dismissFn = cb.dismissFinding;
      const dismissBtn = actions.createEl('button', {
        text: t('ollama.dismiss'),
        cls: 'novalist-ai-action-btn',
      });
      dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissFn(highlight);
        this.currentHighlight = null;
        this.removeCard();
      });
    }

    // Position the card below the highlighted text
    const editorRect = this.view.dom.getBoundingClientRect();
    const cardWidth = 380;
    let left = coords.left;
    const top = coords.bottom + 6;

    // Ensure card doesn't overflow the right edge
    if (left + cardWidth > editorRect.right) {
      left = editorRect.right - cardWidth - 8;
    }
    if (left < editorRect.left) {
      left = editorRect.left + 8;
    }

    card.setCssStyles({
      top: `${top}px`,
      left: `${left}px`,
    });

    document.body.appendChild(card);
    this.card = card;

    // Dismiss when clicking outside
    this.docClickHandler = (e: MouseEvent) => {
      if (this.mouseInsideCard) {
        this.mouseInsideCard = false;
        return;
      }
      if (this.card && !this.card.contains(e.target as Node)) {
        this.currentHighlight = null;
        this.removeCard();
      }
    };
    setTimeout(() => {
      if (!this.destroyed && this.docClickHandler) {
        document.addEventListener('mousedown', this.docClickHandler, true);
      }
    }, 0);
  }

  private hideCardDelayed(): void {
    this.clearDebounce();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.destroyed) return;
      this.currentHighlight = null;
      this.removeCard();
    }, 300);
  }

  private removeCard(): void {
    if (this.card) {
      this.card.remove();
      this.card = null;
    }
    if (this.docClickHandler) {
      document.removeEventListener('mousedown', this.docClickHandler, true);
      this.docClickHandler = null;
    }
  }
}

const aiHighlightPeekPlugin = ViewPlugin.fromClass(AiHighlightPeekPlugin);

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Create the AI highlight extension.
 * Register it via `plugin.registerEditorExtension(aiHighlightExtension(callbacks))`.
 */
export function aiHighlightExtension(callbacks: AiHighlightCallbacks): Extension {
  return [
    aiHighlightCallbacks.of(callbacks),
    aiHighlightsField,
    aiDecorations,
    aiHighlightPeekPlugin,
  ];
}
