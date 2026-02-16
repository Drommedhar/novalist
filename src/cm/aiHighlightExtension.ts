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
  type DecorationSet,
} from '@codemirror/view';

// ─── Types ──────────────────────────────────────────────────────────

export type AiHighlightType = 'reference' | 'inconsistency' | 'suggestion';

export interface AiHighlight {
  /** Document offset — start. */
  from: number;
  /** Document offset — end. */
  to: number;
  /** Finding category. */
  type: AiHighlightType;
  /** Tooltip text shown on hover via CSS title. */
  title: string;
}

// ─── Callbacks facet ────────────────────────────────────────────────

export interface AiHighlightCallbacks {
  /** Whether the current file belongs to the active project. */
  isProjectFile: () => boolean;
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

const makeDecoration = (type: AiHighlightType, title: string) =>
  Decoration.mark({
    class: `novalist-ai-highlight novalist-ai-highlight--${type}`,
    attributes: { title },
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
        builder.add(h.from, h.to, makeDecoration(h.type, h.title));
      }
    }
    return builder.finish();
  },
  provide: (f) => EditorView.decorations.from(f),
});

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
  ];
}
