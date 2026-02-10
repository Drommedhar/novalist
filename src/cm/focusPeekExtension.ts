import {
  Facet,
  type Extension
} from '@codemirror/state';
import {
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  type PluginValue
} from '@codemirror/view';
import { setIcon } from 'obsidian';
import { t } from '../i18n';

// ─── Data types ─────────────────────────────────────────────────────

/** A named image link (wiki-link or path). */
export interface PeekImage {
  name: string;
  path: string;
}

/** A titled free-form section (e.g. "Backstory", "Notes"). */
export interface PeekSection {
  title: string;
  content: string;
}

/** A relationship entry (role → character name). */
export interface PeekRelationship {
  role: string;
  character: string;
}

/** Compact entity info returned by the plugin for display in the peek card. */
export interface EntityPeekData {
  type: 'character' | 'location';
  name: string;
  /** File path of the entity (needed for image resolution). */
  entityFilePath: string;
  /** Named images attached to this entity. */
  images: PeekImage[];
  /** Free-form sections (Backstory, Notes, etc.). */
  sections: PeekSection[];
  // Character fields
  surname?: string;
  gender?: string;
  age?: string;
  role?: string;
  roleColor?: string;
  genderColor?: string;
  relationships?: PeekRelationship[];
  customProperties?: Record<string, string>;
  chapterInfo?: string;
  // Physical attributes
  eyeColor?: string;
  hairColor?: string;
  hairLength?: string;
  height?: string;
  build?: string;
  skinTone?: string;
  distinguishingFeatures?: string;
  // Location fields
  locationType?: string;
  description?: string;
}

// ─── Facet: callbacks from the plugin ───────────────────────────────

export interface FocusPeekCallbacks {
  /** Find entity at a line/ch position (reuses the plugin's existing logic). */
  getEntityAtPosition: (lineText: string, ch: number) => { display: string; type: 'character' | 'location' } | null;
  /** Fetch compact peek data for a named entity. */
  getEntityPeekData: (name: string) => Promise<EntityPeekData | null>;
  /** Resolve an image wiki-link path to a displayable src URL (or null). */
  resolveImageSrc: (imagePath: string, entityFilePath: string) => string | null;
  /** Open the entity's file in a new tab. */
  onOpenFile: (name: string) => void;
  /** Render markdown content into a container element. */
  renderMarkdown: (markdown: string, container: HTMLElement, sourcePath: string) => Promise<void>;
  /** Load a value from vault-scoped local storage. */
  loadLocalStorage: (key: string) => string | null;
  /** Save a value to vault-scoped local storage. */
  saveLocalStorage: (key: string, value: string) => void;
}

export const focusPeekCallbacks = Facet.define<FocusPeekCallbacks, FocusPeekCallbacks>({
  combine: (values) => values[0] ?? {
    getEntityAtPosition: () => null,
    getEntityPeekData: () => Promise.resolve(null),
    resolveImageSrc: () => null,
    onOpenFile: () => {/* no-op */},
    renderMarkdown: () => Promise.resolve(),
    loadLocalStorage: () => null,
    saveLocalStorage: () => {/* no-op */}
  }
});

// ─── ViewPlugin: hover detection + peek card rendering ──────────────

class FocusPeekPlugin implements PluginValue {
  private static readonly PEEK_SIZE_KEY = 'novalist-peek-card-size';

  private static readonly BASE_WIDTH = 340;

  private static loadPersistedSize(cb: FocusPeekCallbacks): { width: number; height: number } | null {
    try {
      const raw = cb.loadLocalStorage(FocusPeekPlugin.PEEK_SIZE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { width: number; height: number };
      if (typeof parsed.width === 'number' && typeof parsed.height === 'number') return parsed;
    } catch { /* ignore */ }
    return null;
  }

  private static savePersistedSize(cb: FocusPeekCallbacks, width: number, height: number): void {
    cb.saveLocalStorage(FocusPeekPlugin.PEEK_SIZE_KEY, JSON.stringify({ width, height }));
  }

  private view: EditorView;
  private card: HTMLElement | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEntityName: string | null = null;
  private lastCursorPos = -1;
  private destroyed = false;
  private pinned = false;
  /** Track mousedown inside card to suppress the click-away handler. */
  private mouseInsideCard = false;
  private docClickHandler: ((e: MouseEvent) => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  /** Navigation history for back-navigation within the peek. */
  private navigationStack: string[] = [];
  /** The entity currently displayed in the card. */
  private currentEntityName: string | null = null;

  constructor(view: EditorView) {
    this.view = view;
  }

  update(update: ViewUpdate): void {
    if (this.destroyed) return;

    // React to cursor movement
    const sel = update.state.selection.main;
    if (sel.anchor !== this.lastCursorPos || update.docChanged) {
      this.lastCursorPos = sel.anchor;
      // If pinned, don't auto-update
      if (!this.pinned) {
        this.schedulePeek(sel.anchor);
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.clearDebounce();
    this.removeCard();
  }

  // ── Scheduling ────────────────────────────────────────────────────

  private schedulePeek(pos: number): void {
    this.clearDebounce();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.destroyed) return;
      void this.checkEntity(pos);
    }, 350);
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  // ── Entity detection ──────────────────────────────────────────────

  private async checkEntity(pos: number): Promise<void> {
    if (this.destroyed) return;

    const cb = this.view.state.facet(focusPeekCallbacks);
    const doc = this.view.state.doc;
    if (pos < 0 || pos > doc.length) { this.hideIfNotPinned(); return; }

    const line = doc.lineAt(pos);
    const ch = pos - line.from;
    const entity = cb.getEntityAtPosition(line.text, ch);

    if (!entity) {
      this.hideIfNotPinned();
      return;
    }

    // Same entity already showing → keep it
    if (entity.display === this.lastEntityName && this.card) return;

    // Fetch data
    const data = await cb.getEntityPeekData(entity.display);
    if (this.destroyed) return;
    if (!data) { this.hideIfNotPinned(); return; }

    this.lastEntityName = entity.display;
    this.navigationStack = [];
    this.currentEntityName = entity.display;
    this.showCard(data, pos);
  }

  private hideIfNotPinned(): void {
    if (!this.pinned) {
      this.lastEntityName = null;
      this.removeCard();
    }
  }

  // ── Card rendering ────────────────────────────────────────────────

  private showCard(data: EntityPeekData, pos: number): void {
    this.removeCard();

    const coords = this.view.coordsAtPos(pos);
    if (!coords) return;

    const card = document.createElement('div');
    card.className = 'novalist-peek-card';

    // Prevent editor stealing focus
    card.addEventListener('mousedown', (e) => {
      this.mouseInsideCard = true;
      e.stopPropagation();
    });

    // ── Header row: icon + name + type badge + actions
    const header = card.createDiv('novalist-peek-header');

    const typeIcon = header.createEl('span', { cls: 'novalist-peek-type-icon' });
    setIcon(typeIcon, data.type === 'character' ? 'user' : 'map-pin');

    this.renderCardContent(card, data, header);

    // Position the card below the cursor line, aligned left to entity
    const editorRect = this.view.dom.getBoundingClientRect();
    const top = coords.bottom + 6;
    let left = coords.left;

    // Ensure card doesn't overflow the right edge of the editor
    const defaultWidth = 420;
    if (left + defaultWidth > editorRect.right) {
      left = editorRect.right - defaultWidth - 8;
    }
    if (left < editorRect.left) {
      left = editorRect.left + 8;
    }

    // Apply persisted size if available, including scaling font-size
    const savedSize = FocusPeekPlugin.loadPersistedSize(this.view.state.facet(focusPeekCallbacks));
    const styles: Partial<CSSStyleDeclaration> = {
      top: `${top}px`,
      left: `${left}px`
    };
    if (savedSize) {
      styles.width = `${savedSize.width}px`;
      styles.height = `${savedSize.height}px`;
      const scale = savedSize.width / FocusPeekPlugin.BASE_WIDTH;
      styles.fontSize = `${Math.max(10, Math.min(24, 12 * scale)).toFixed(1)}px`;
    }
    card.setCssStyles(styles);

    document.body.appendChild(card);
    this.card = card;

    // Observe resize to persist size and scale content
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          FocusPeekPlugin.savePersistedSize(this.view.state.facet(focusPeekCallbacks), Math.round(width), Math.round(height));
          // Scale font-size proportionally to width (all children use em)
          const scale = width / FocusPeekPlugin.BASE_WIDTH;
          const fontSize = Math.max(10, Math.min(24, 12 * scale));
          (entry.target as HTMLElement).style.fontSize = `${fontSize.toFixed(1)}px`;
        }
      }
    });
    this.resizeObserver.observe(card);

    // Dismiss when clicking outside (delayed to not catch the current event)
    this.docClickHandler = (e: MouseEvent) => {
      if (this.mouseInsideCard) {
        this.mouseInsideCard = false;
        return;
      }
      if (this.card && !this.card.contains(e.target as Node)) {
        if (!this.pinned) {
          this.lastEntityName = null;
          this.removeCard();
        }
      }
    };
    setTimeout(() => {
      if (!this.destroyed) {
        if (this.docClickHandler) document.addEventListener('mousedown', this.docClickHandler, true);
      }
    }, 0);
  }

  /**
   * Render all card content (header details + body + sections) into a card element.
   * Called both by showCard (initial) and replaceCardContent (navigation).
   */
  private renderCardContent(card: HTMLElement, data: EntityPeekData, header: HTMLElement): void {
    const fullName = data.type === 'character' && data.surname
      ? `${data.name} ${data.surname}`.trim()
      : data.name;

    // Back button (only shown when there's navigation history)
    if (this.navigationStack.length > 0) {
      const backBtn = header.createEl('button', {
        cls: 'novalist-peek-action novalist-peek-back',
        attr: { 'aria-label': t('peek.goBack') }
      });
      setIcon(backBtn, 'arrow-left');
      backBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.navigateBack();
      });
    }

    header.createEl('span', { text: fullName, cls: 'novalist-peek-name' });

    const badge = header.createEl('span', {
      text: data.type === 'character' ? t('peek.character') : t('peek.location'),
      cls: 'novalist-peek-badge'
    });
    if (data.type === 'character') {
      badge.addClass('novalist-peek-badge--character');
      if (data.roleColor) badge.style.setProperty('--novalist-peek-badge-bg', data.roleColor);
    } else {
      badge.addClass('novalist-peek-badge--location');
    }

    // Spacer
    header.createDiv('novalist-peek-spacer');

    // Pin button
    const pinBtn = header.createEl('button', {
      cls: 'novalist-peek-action',
      attr: { 'aria-label': t('peek.pinCard') }
    });
    setIcon(pinBtn, 'pin');
    if (this.pinned) pinBtn.addClass('is-active');
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.pinned = !this.pinned;
      pinBtn.toggleClass('is-active', this.pinned);
      if (this.pinned && this.card) {
        this.positionPinned(this.card);
      }
    });

    // Open file button
    const openBtn = header.createEl('button', {
      cls: 'novalist-peek-action',
      attr: { 'aria-label': t('peek.openFile') }
    });
    setIcon(openBtn, 'external-link');
    openBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cb = this.view.state.facet(focusPeekCallbacks);
      cb.onOpenFile(this.currentEntityName ?? data.name);
      this.removeCard();
    });

    // Close button
    const closeBtn = header.createEl('button', {
      cls: 'novalist-peek-action',
      attr: { 'aria-label': t('peek.close') }
    });
    setIcon(closeBtn, 'x');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.pinned = false;
      this.lastEntityName = null;
      this.removeCard();
    });

    // ── Body: image on left, details on right (side-by-side if image present)
    const body = card.createDiv('novalist-peek-body');

    // Image column (portrait-friendly)
    this.renderImageArea(body, data);

    // Details column
    const details = body.createDiv('novalist-peek-details');

    // ── Properties row
    const props = details.createDiv('novalist-peek-props');

    if (data.type === 'character') {
      if (data.role) {
        const pill = props.createDiv('novalist-peek-pill');
        if (data.roleColor) pill.style.setProperty('--novalist-pill-color', data.roleColor);
        pill.createEl('span', { text: data.role, cls: 'novalist-peek-pill-value' });
      }
      if (data.gender) {
        const pill = props.createDiv('novalist-peek-pill');
        if (data.genderColor) pill.style.setProperty('--novalist-pill-color', data.genderColor);
        pill.createEl('span', { text: data.gender, cls: 'novalist-peek-pill-value' });
      }
      if (data.age) {
        const pill = props.createDiv('novalist-peek-pill');
        pill.createEl('span', { text: t('peek.age', { age: data.age }), cls: 'novalist-peek-pill-value' });
      }
      if (data.relationships && data.relationships.length > 0) {
        const pill = props.createDiv('novalist-peek-pill novalist-peek-pill--dim');
        const relIcon = pill.createEl('span', { cls: 'novalist-peek-pill-icon' });
        setIcon(relIcon, 'users');
        pill.createEl('span', {
          text: `${data.relationships.length}`,
          cls: 'novalist-peek-pill-value'
        });
      }
    } else {
      if (data.locationType) {
        const pill = props.createDiv('novalist-peek-pill');
        pill.createEl('span', { text: data.locationType, cls: 'novalist-peek-pill-value' });
      }
    }

    // ── Relationships (full list, clickable names)
    if (data.relationships && data.relationships.length > 0) {
      const relSection = details.createDiv('novalist-peek-rel');
      for (const rel of data.relationships) {
        const row = relSection.createDiv('novalist-peek-rel-row');
        row.createEl('span', { text: rel.role, cls: 'novalist-peek-rel-role' });

        // Split character field into individual names (may be comma-separated wiki-links)
        const nameContainer = row.createEl('span', { cls: 'novalist-peek-rel-name' });
        const names = rel.character
          .split(/,\s*/)
          .map(n => n.replace(/\[\[|\]\]/g, '').trim())
          .filter(n => n.length > 0);

        for (let ni = 0; ni < names.length; ni++) {
          if (ni > 0) nameContainer.appendText(', ');
          const linkEl = nameContainer.createEl('span', {
            text: names[ni],
            cls: 'novalist-peek-link'
          });
          const charName = names[ni];
          linkEl.addEventListener('click', (e) => {
            e.stopPropagation();
            void this.navigateToEntity(charName);
          });
        }
      }
    }

    // ── Physical attributes (only those with a value)
    if (data.type === 'character') {
      const physicalAttrs: { label: string; value: string | undefined }[] = [
        { label: t('peek.eyes'), value: data.eyeColor },
        { label: t('peek.hair'), value: data.hairColor },
        { label: t('peek.hairLength'), value: data.hairLength },
        { label: t('peek.height'), value: data.height },
        { label: t('peek.build'), value: data.build },
        { label: t('peek.skin'), value: data.skinTone },
        { label: t('peek.distinguishing'), value: data.distinguishingFeatures },
      ];
      const filled = physicalAttrs.filter((a): a is { label: string; value: string } => Boolean(a.value?.trim()));
      if (filled.length > 0) {
        const physRow = details.createDiv('novalist-peek-kv novalist-peek-physical');
        for (const attr of filled) {
          const item = physRow.createDiv('novalist-peek-kv-item');
          item.createEl('span', { text: attr.label, cls: 'novalist-peek-kv-key' });
          item.createEl('span', { text: attr.value, cls: 'novalist-peek-kv-val' });
        }
      }
    }

    // ── Custom properties (compact, max 3)
    if (data.customProperties) {
      const entries = Object.entries(data.customProperties).filter(([, v]) => v);
      if (entries.length > 0) {
        const kvRow = details.createDiv('novalist-peek-kv');
        const max = Math.min(entries.length, 3);
        for (let i = 0; i < max; i++) {
          const [key, val] = entries[i];
          const item = kvRow.createDiv('novalist-peek-kv-item');
          item.createEl('span', { text: key, cls: 'novalist-peek-kv-key' });
          item.createEl('span', { text: val, cls: 'novalist-peek-kv-val' });
        }
        if (entries.length > 3) {
          kvRow.createEl('span', { text: t('peek.more', { n: entries.length - 3 }), cls: 'novalist-peek-kv-more' });
        }
      }
    }

    // ── Chapter-specific info
    if (data.chapterInfo) {
      const chapterDiv = details.createDiv('novalist-peek-chapter');
      const chapterIcon = chapterDiv.createEl('span', { cls: 'novalist-peek-chapter-icon' });
      setIcon(chapterIcon, 'bookmark');
      chapterDiv.createEl('span', {
        text: data.chapterInfo.length > 120 ? data.chapterInfo.substring(0, 120) + '…' : data.chapterInfo,
        cls: 'novalist-peek-chapter-text'
      });
    }

    // ── Location description excerpt
    if (data.type === 'location' && data.description) {
      const descDiv = details.createDiv('novalist-peek-desc');
      descDiv.createEl('span', {
        text: data.description.length > 140 ? data.description.substring(0, 140) + '…' : data.description,
        cls: 'novalist-peek-desc-text'
      });
    }

    // ── Free-form sections (dropdown selector)
    if (data.sections.length > 0) {
      this.renderSections(card, data.sections, data);
    }

    // ── Intercept wiki-link clicks inside the card for in-peek navigation
    card.addEventListener('click', (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      const link = el.closest('a');
      if (!link || !card.contains(link)) return;
      const href = link.getAttribute('data-href') ?? link.getAttribute('href') ?? link.textContent ?? '';
      if (!href) return;
      // Only intercept internal wiki-links, not external URLs
      if (href.startsWith('http://') || href.startsWith('https://')) return;
      e.preventDefault();
      e.stopPropagation();
      void this.navigateToEntity(href.replace(/\[\[|\]\]/g, '').trim());
    });
  }

  /** Navigate the peek card to a different entity, pushing current onto the back stack. */
  private async navigateToEntity(name: string): Promise<void> {
    if (!this.card || this.destroyed) return;
    const cb = this.view.state.facet(focusPeekCallbacks);
    const data = await cb.getEntityPeekData(name);
    if (!data || this.destroyed) return;

    // Push current entity onto the back stack
    if (this.currentEntityName) {
      this.navigationStack.push(this.currentEntityName);
    }
    this.currentEntityName = name;
    this.lastEntityName = name;

    // Preserve card position and size — just replace inner content
    this.replaceCardContent(data);
  }

  /** Navigate back to the previous entity in the stack. */
  private navigateBack(): void {
    if (this.navigationStack.length === 0 || !this.card) return;
    const prevName = this.navigationStack.pop();
    if (!prevName) return;
    this.currentEntityName = prevName;
    this.lastEntityName = prevName;

    const cb = this.view.state.facet(focusPeekCallbacks);
    void cb.getEntityPeekData(prevName).then((data) => {
      if (!data || this.destroyed || !this.card) return;
      this.replaceCardContent(data);
    });
  }

  /** Replace all content inside the existing card element without changing position/size. */
  private replaceCardContent(data: EntityPeekData): void {
    if (!this.card) return;
    const card = this.card;

    // Save current dimensions and font-size
    const savedWidth = card.style.width;
    const savedHeight = card.style.height;
    const savedFontSize = card.style.fontSize;

    // Clear all children but keep the card element itself
    card.empty();

    // Re-render header + content
    const header = card.createDiv('novalist-peek-header');
    const typeIcon = header.createEl('span', { cls: 'novalist-peek-type-icon' });
    setIcon(typeIcon, data.type === 'character' ? 'user' : 'map-pin');

    this.renderCardContent(card, data, header);

    // Restore dimensions
    card.style.width = savedWidth;
    card.style.height = savedHeight;
    card.style.fontSize = savedFontSize;
  }

  /** Render scaled-down image preview with dropdown selector. */
  private renderImageArea(parent: HTMLElement, data: EntityPeekData): void {
    if (data.images.length === 0) return;

    const cb = this.view.state.facet(focusPeekCallbacks);
    const wrapper = parent.createDiv('novalist-peek-image-area');

    // Row: label + dropdown (only show dropdown if > 1 image)
    if (data.images.length > 1) {
      const row = wrapper.createDiv('novalist-peek-image-row');
      const select = row.createEl('select', { cls: 'novalist-peek-image-select' });
      for (const img of data.images) {
        select.createEl('option', { text: img.name, attr: { value: img.name } });
      }
      select.addEventListener('change', () => {
        renderImage(select.value);
      });
    }

    const container = wrapper.createDiv('novalist-peek-image-container');

    const renderImage = (name: string) => {
      const img = data.images.find(i => i.name === name) ?? data.images[0];
      container.empty();
      const src = cb.resolveImageSrc(img.path, data.entityFilePath);
      if (!src) {
        container.createEl('span', { text: t('peek.imageNotFound'), cls: 'novalist-peek-image-missing' });
        return;
      }
      container.createEl('img', { attr: { src, alt: img.name } });
    };

    renderImage(data.images[0].name);
  }

  /** Render free-form sections with a dropdown selector to pick which to display. */
  private renderSections(parent: HTMLElement, sections: PeekSection[], data: EntityPeekData | null): void {
    const wrapper = parent.createDiv('novalist-peek-sections');

    const headerRow = wrapper.createDiv('novalist-peek-sections-header');
    const sectionIcon = headerRow.createEl('span', { cls: 'novalist-peek-sections-icon' });
    setIcon(sectionIcon, 'file-text');

    if (sections.length === 1) {
      headerRow.createEl('span', { text: sections[0].title, cls: 'novalist-peek-sections-title' });
    } else {
      const select = headerRow.createEl('select', { cls: 'novalist-peek-sections-select' });
      for (const sec of sections) {
        select.createEl('option', { text: sec.title, attr: { value: sec.title } });
      }
      select.addEventListener('change', () => {
        renderContent(select.value);
      });
    }

    const contentEl = wrapper.createDiv('novalist-peek-sections-content');
    const cbs = this.view.state.facet(focusPeekCallbacks);
    const sourcePath = data?.entityFilePath ?? '';

    const renderContent = (title: string) => {
      const sec = sections.find(s => s.title === title) ?? sections[0];
      contentEl.empty();
      if (!sec.content) {
        contentEl.createEl('span', { text: t('peek.noContent'), cls: 'novalist-peek-sections-empty' });
        return;
      }
      void cbs.renderMarkdown(sec.content, contentEl, sourcePath);
    };

    renderContent(sections[0].title);
  }

  /** Position a pinned card at the bottom-left of the editor. */
  private positionPinned(card: HTMLElement): void {
    const editorRect = this.view.dom.getBoundingClientRect();
    const cardHeight = card.offsetHeight;
    card.setCssStyles({
      left: `${editorRect.left + 12}px`,
      top: `${editorRect.bottom - cardHeight - 12}px`
    });
  }

  private removeCard(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
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

const focusPeekPlugin = ViewPlugin.fromClass(FocusPeekPlugin);

// ─── Public: create the full extension ─────────────────────────────

export function focusPeekExtension(callbacks: FocusPeekCallbacks): Extension {
  return [
    focusPeekCallbacks.of(callbacks),
    focusPeekPlugin
  ];
}
