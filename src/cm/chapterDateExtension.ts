import {
  Facet,
  type Extension
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
  type PluginValue
} from '@codemirror/view';
import type { TranslationKey } from '../i18n';

// ─── Callbacks from the plugin ──────────────────────────────────────

export interface ChapterDateCallbacks {
  /** Whether the active file is a chapter file in the project. */
  isChapterFile: () => boolean;
  /** Get the chapter date (from frontmatter) for the active file. */
  getChapterDate: () => string;
  /** Get the scene date for a given scene name in the active file. Falls back to chapter date. */
  getSceneDate: (sceneName: string) => string;
  /** Translate a key. */
  t: (key: TranslationKey) => string;
}

export const chapterDateCallbacks = Facet.define<ChapterDateCallbacks, ChapterDateCallbacks>({
  combine: (values) => values[0] ?? {
    isChapterFile: () => false,
    getChapterDate: () => '',
    getSceneDate: () => '',
    t: (key: string) => key,
  }
});

// ─── Day-of-week helper ─────────────────────────────────────────────

const DAY_KEYS: TranslationKey[] = [
  'day.sunday',
  'day.monday',
  'day.tuesday',
  'day.wednesday',
  'day.thursday',
  'day.friday',
  'day.saturday',
];

/**
 * Parse a date string (YYYY-MM-DD or similar) and return the localised
 * day-of-week name, or empty string if unparseable.
 */
function getDayOfWeek(dateStr: string, translate: (key: TranslationKey) => string): string {
  if (!dateStr) return '';
  // Try parsing as ISO date
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return translate(DAY_KEYS[d.getUTCDay()]);
}

// ─── Widget ─────────────────────────────────────────────────────────

class DateBadgeWidget extends WidgetType {
  constructor(
    readonly dateStr: string,
    readonly dayOfWeek: string,
    readonly level: 'chapter' | 'scene'
  ) {
    super();
  }

  eq(other: DateBadgeWidget): boolean {
    return this.dateStr === other.dateStr && this.dayOfWeek === other.dayOfWeek && this.level === other.level;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = `novalist-heading-date novalist-heading-date-${this.level}`;
    wrap.setAttribute('aria-label', `${this.dayOfWeek}, ${this.dateStr}`);

    const dateEl = document.createElement('span');
    dateEl.className = 'novalist-heading-date-value';
    dateEl.textContent = this.dateStr;
    wrap.appendChild(dateEl);

    if (this.dayOfWeek) {
      const dayEl = document.createElement('span');
      dayEl.className = 'novalist-heading-date-day';
      dayEl.textContent = this.dayOfWeek;
      wrap.appendChild(dayEl);
    }

    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// ─── ViewPlugin ─────────────────────────────────────────────────────

function buildDecorations(view: EditorView): DecorationSet {
  const cb = view.state.facet(chapterDateCallbacks);
  if (!cb.isChapterFile()) return Decoration.none;

  const decorations: { pos: number; widget: DateBadgeWidget }[] = [];
  const doc = view.state.doc;

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text;

    // H1: chapter heading
    if (/^#\s+/.test(text) && !/^##/.test(text)) {
      const dateStr = cb.getChapterDate();
      if (dateStr) {
        const dayOfWeek = getDayOfWeek(dateStr, cb.t);
        decorations.push({
          pos: line.to,
          widget: new DateBadgeWidget(dateStr, dayOfWeek, 'chapter')
        });
      }
    }
    // H2: scene heading
    else if (/^##\s+/.test(text) && !/^###/.test(text)) {
      const sceneName = text.replace(/^##\s+/, '').trim();
      if (sceneName) {
        const dateStr = cb.getSceneDate(sceneName);
        if (dateStr) {
          const dayOfWeek = getDayOfWeek(dateStr, cb.t);
          decorations.push({
            pos: line.to,
            widget: new DateBadgeWidget(dateStr, dayOfWeek, 'scene')
          });
        }
      }
    }
  }

  if (decorations.length === 0) return Decoration.none;

  // Sort by position (should already be sorted, but be safe)
  decorations.sort((a, b) => a.pos - b.pos);

  return Decoration.set(
    decorations.map(d =>
      Decoration.widget({ widget: d.widget, side: 1 }).range(d.pos)
    )
  );
}

const chapterDatePlugin = ViewPlugin.fromClass(
  class implements PluginValue {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      // Rebuild when the document changes or the viewport changes
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations
  }
);

// ─── Extension factory ──────────────────────────────────────────────

export function chapterDateExtension(callbacks: ChapterDateCallbacks): Extension {
  return [
    chapterDateCallbacks.of(callbacks),
    chapterDatePlugin
  ];
}
