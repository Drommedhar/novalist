import { App, ItemView, WorkspaceLeaf, TFile, setIcon } from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';
import type {
  TimelineEvent,
  TimelineViewMode,
  TimelineZoomLevel,
  TimelineEventSource,
  TimelineManualEvent,
} from '../types';
import {
  buildTimelineEvents,
  sortTimelineEvents,
  getUniqueCharacters,
  getUniqueLocations,
  getUsedDates,
  formatDateLabel,
  groupKey,
  groupLabel,
  SOURCE_COLORS,
} from '../utils/timelineUtils';
import { createDefaultTimelineData } from '../settings/NovalistSettings';

// ── Inline entity suggester (works for any vault folder) ───────────

class EntityInlineSuggest {
  private inputEl: HTMLInputElement;
  private plugin: NovalistPlugin;
  private app: App;
  private folder: string;
  private onSelect: (file: TFile) => void;
  private suggestionContainer: HTMLElement | null = null;
  private suggestions: TFile[] = [];
  private selectedIndex = -1;

  constructor(app: App, plugin: NovalistPlugin, folder: string, inputEl: HTMLInputElement, onSelect: (file: TFile) => void) {
    this.app = app;
    this.plugin = plugin;
    this.folder = folder;
    this.inputEl = inputEl;
    this.onSelect = onSelect;

    this.inputEl.addEventListener('input', () => this.onInput());
    this.inputEl.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.inputEl.addEventListener('blur', () => this.onBlur());
  }

  private onInput(): void {
    const query = this.inputEl.value;
    if (!query || query.length === 0) { this.close(); return; }

    this.suggestions = this.app.vault.getFiles().filter(f =>
      f.path.startsWith(this.folder) &&
      f.extension === 'md' &&
      f.basename.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 10);

    if (this.suggestions.length > 0) {
      this.selectedIndex = 0;
      this.showSuggestions();
    } else {
      this.close();
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.suggestionContainer) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex = Math.min(this.selectedIndex + 1, this.suggestions.length - 1);
      this.renderSuggestions();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this.renderSuggestions();
    } else if (e.key === 'Enter') {
      if (this.selectedIndex >= 0 && this.suggestions[this.selectedIndex]) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.selectSuggestion(this.suggestions[this.selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      this.close();
    }
  }

  private onBlur(): void {
    setTimeout(() => this.close(), 150);
  }

  private showSuggestions(): void {
    if (!this.suggestionContainer) {
      this.suggestionContainer = document.body.createDiv('character-sheet-suggestion-container');
    }
    const rect = this.inputEl.getBoundingClientRect();
    this.suggestionContainer.style.top = `${rect.bottom + window.scrollY}px`;
    this.suggestionContainer.style.left = `${rect.left + window.scrollX}px`;
    this.suggestionContainer.style.width = `${Math.max(rect.width, 200)}px`;
    this.renderSuggestions();
  }

  private renderSuggestions(): void {
    if (!this.suggestionContainer) return;
    this.suggestionContainer.empty();
    this.suggestions.forEach((file, index) => {
      const item = this.suggestionContainer.createDiv({
        cls: `character-sheet-suggestion-item${index === this.selectedIndex ? ' is-selected' : ''}`,
        text: file.basename,
      });
      item.addEventListener('mousedown', (e) => { e.preventDefault(); this.selectSuggestion(file); });
      item.addEventListener('mouseenter', () => { this.selectedIndex = index; this.renderSuggestions(); });
    });
  }

  private selectSuggestion(file: TFile): void {
    this.close();
    this.inputEl.value = '';
    this.onSelect(file);
  }

  private close(): void {
    if (this.suggestionContainer) { this.suggestionContainer.remove(); this.suggestionContainer = null; }
  }
}

export const TIMELINE_VIEW_TYPE = 'novalist-timeline';

/** Mapping from built-in category IDs to i18n keys. */
const CATEGORY_I18N: Record<string, string> = {
  plot: 'timeline.catPlot',
  character: 'timeline.catCharacter',
  world: 'timeline.catWorld',
};

/** Get a localized display name for a category. */
function categoryDisplayName(cat: { id: string; name: string }): string {
  const key = CATEGORY_I18N[cat.id];
  return key ? t(key) : cat.name;
}

/** Get a localized label for an event source. */
function sourceLabel(src: TimelineEventSource): string {
  switch (src) {
    case 'chapter': return t('timeline.chapterEvent');
    case 'scene':   return t('timeline.sceneEvent');
    case 'act':     return t('timeline.actEvent');
    case 'manual':  return t('timeline.manualEvent');
  }
}

export class TimelineView extends ItemView {
  plugin: NovalistPlugin;

  // ── State ────────────────────────────────────────────────────────
  private currentMode: TimelineViewMode = 'vertical';
  private currentZoom: TimelineZoomLevel = 'month';
  private filterCharacter: string | null = null;
  private filterLocation: string | null = null;
  private filterSource: TimelineEventSource | null = null;
  private events: TimelineEvent[] = [];
  private refreshDebounceTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: NovalistPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return TIMELINE_VIEW_TYPE; }
  getDisplayText(): string { return t('timeline.displayName'); }
  getIcon(): string { return 'calendar-range'; }

  async onOpen(): Promise<void> {
    // Migrate: ensure timeline data exists
    if (!this.plugin.settings.timeline) {
      this.plugin.settings.timeline = createDefaultTimelineData();
    }
    this.currentMode = this.plugin.settings.timeline.viewMode;
    this.currentZoom = this.plugin.settings.timeline.zoomLevel;
    await this.render();
    this.registerVaultEvents();
  }

  async onClose(): Promise<void> {
    if (this.refreshDebounceTimer) clearTimeout(this.refreshDebounceTimer);
    await Promise.resolve();
  }

  private registerVaultEvents(): void {
    this.registerEvent(this.plugin.app.vault.on('modify', (file) => {
      if (file instanceof TFile && this.plugin.isFileInProject(file)) {
        this.scheduleRefresh();
      }
    }));
  }

  private scheduleRefresh(): void {
    if (this.refreshDebounceTimer) clearTimeout(this.refreshDebounceTimer);
    this.refreshDebounceTimer = window.setTimeout(() => void this.render(), 2000);
  }

  // ── Data helpers ─────────────────────────────────────────────────

  private get timelineData() {
    if (!this.plugin.settings.timeline) {
      this.plugin.settings.timeline = createDefaultTimelineData();
    }
    return this.plugin.settings.timeline;
  }

  private async buildEvents(): Promise<TimelineEvent[]> {
    const raw = await buildTimelineEvents(this.plugin);
    return sortTimelineEvents(raw);
  }

  private applyFilters(events: TimelineEvent[]): TimelineEvent[] {
    let result = events;
    if (this.filterCharacter) {
      const c = this.filterCharacter;
      result = result.filter(e => e.characters.includes(c));
    }
    if (this.filterLocation) {
      const loc = this.filterLocation;
      result = result.filter(e => e.locations.includes(loc));
    }
    if (this.filterSource) {
      const s = this.filterSource;
      result = result.filter(e => e.source === s);
    }
    return result;
  }

  // ── Rendering ────────────────────────────────────────────────────

  async render(): Promise<void> {
    const container = this.containerEl;
    container.empty();
    container.addClass('novalist-timeline');

    this.events = await this.buildEvents();
    const filtered = this.applyFilters(this.events);

    this.renderToolbar(container);

    if (filtered.length === 0) {
      const empty = container.createDiv('novalist-timeline-empty');
      empty.createEl('p', { text: t('timeline.noEvents') });
      return;
    }

    const content = container.createDiv('novalist-timeline-content');
    if (this.currentMode === 'vertical') {
      this.renderVerticalTimeline(content, filtered);
    } else {
      this.renderHorizontalTimeline(content, filtered);
    }
  }

  // ── Toolbar ──────────────────────────────────────────────────────

  private renderToolbar(container: HTMLElement): void {
    const toolbar = container.createDiv('novalist-timeline-toolbar');

    // ── Left group: mode, zoom, filters ──
    const left = toolbar.createDiv('novalist-timeline-toolbar-group');

    // Mode toggle
    const modeBtn = left.createEl('button', {
      cls: 'novalist-timeline-mode-toggle',
      attr: { 'aria-label': this.currentMode === 'vertical' ? t('timeline.viewVertical') : t('timeline.viewHorizontal') },
    });
    setIcon(modeBtn, this.currentMode === 'vertical' ? 'list' : 'arrow-right');
    modeBtn.createEl('span', { text: this.currentMode === 'vertical' ? t('timeline.viewVertical') : t('timeline.viewHorizontal') });
    modeBtn.addEventListener('click', () => void this.onModeToggle());

    // Zoom selector
    const zoomBtn = left.createEl('button', { cls: 'novalist-timeline-zoom' });
    setIcon(zoomBtn, 'search');
    const zoomLabelMap: Record<TimelineZoomLevel, string> = {
      year: t('timeline.zoomYear'),
      month: t('timeline.zoomMonth'),
      day: t('timeline.zoomDay'),
    };
    zoomBtn.createEl('span', { text: zoomLabelMap[this.currentZoom] });
    zoomBtn.addEventListener('click', () => void this.onZoomCycle());

    // Character filter
    const chars = getUniqueCharacters(this.events);
    if (chars.length > 0) {
      const charSelect = left.createEl('select', { cls: 'novalist-timeline-filter' });
      charSelect.createEl('option', { value: '', text: t('timeline.filterCharacter') });
      for (const c of chars) {
        const opt = charSelect.createEl('option', { value: c, text: c });
        if (this.filterCharacter === c) opt.selected = true;
      }
      charSelect.addEventListener('change', () => {
        this.filterCharacter = charSelect.value || null;
        void this.render();
      });
    }

    // Location filter
    const locs = getUniqueLocations(this.events);
    if (locs.length > 0) {
      const locSelect = left.createEl('select', { cls: 'novalist-timeline-filter' });
      locSelect.createEl('option', { value: '', text: t('timeline.filterLocation') });
      for (const l of locs) {
        const opt = locSelect.createEl('option', { value: l, text: l });
        if (this.filterLocation === l) opt.selected = true;
      }
      locSelect.addEventListener('change', () => {
        this.filterLocation = locSelect.value || null;
        void this.render();
      });
    }

    // Source filter (replaces former event type filter)
    const sourceSelect = left.createEl('select', { cls: 'novalist-timeline-filter' });
    sourceSelect.createEl('option', { value: '', text: t('timeline.filterSource') });
    const sources: TimelineEventSource[] = ['act', 'chapter', 'scene', 'manual'];
    for (const src of sources) {
      const opt = sourceSelect.createEl('option', { value: src, text: sourceLabel(src) });
      if (this.filterSource === src) opt.selected = true;
    }
    sourceSelect.addEventListener('change', () => {
      this.filterSource = (sourceSelect.value as TimelineEventSource) || null;
      void this.render();
    });

    // ── Right group: add button ──
    const right = toolbar.createDiv('novalist-timeline-toolbar-group');
    const addBtn = right.createEl('button', { cls: 'novalist-timeline-add-btn' });
    setIcon(addBtn, 'plus');
    addBtn.createEl('span', { text: t('timeline.addEvent') });
    addBtn.addEventListener('click', () => this.showFormOverlay());
  }

  // ── Vertical timeline ────────────────────────────────────────────

  private renderVerticalTimeline(container: HTMLElement, events: TimelineEvent[]): void {
    const wrapper = container.createDiv('novalist-timeline-vertical');
    const axis = wrapper.createDiv('novalist-timeline-axis');

    // Group events
    const groups = new Map<string, TimelineEvent[]>();
    for (const event of events) {
      const key = groupKey(event.sortDate, this.currentZoom);
      const arr = groups.get(key) ?? [];
      arr.push(event);
      groups.set(key, arr);
    }

    for (const [key, groupEvents] of groups) {
      const header = axis.createDiv('novalist-timeline-year-header');
      header.createEl('span', { text: groupLabel(key, this.currentZoom) });

      for (const event of groupEvents) {
        this.renderEventCard(axis, event);
      }
    }
  }

  // ── Horizontal timeline ──────────────────────────────────────────

  private renderHorizontalTimeline(container: HTMLElement, events: TimelineEvent[]): void {
    const wrapper = container.createDiv('novalist-timeline-horizontal');

    // Axis line
    const track = wrapper.createDiv('novalist-timeline-h-track');

    // Group events
    const groups = new Map<string, TimelineEvent[]>();
    for (const event of events) {
      const key = groupKey(event.sortDate, this.currentZoom);
      const arr = groups.get(key) ?? [];
      arr.push(event);
      groups.set(key, arr);
    }

    for (const [key, groupEvents] of groups) {
      const column = track.createDiv('novalist-timeline-h-column');

      const dot = column.createDiv('novalist-timeline-event-dot');
      dot.createEl('span', { text: groupLabel(key, this.currentZoom), cls: 'novalist-timeline-h-label' });

      for (const event of groupEvents) {
        this.renderEventCardCompact(column, event);
      }
    }
  }

  // ── Event cards ──────────────────────────────────────────────────

  private renderEventCard(parent: HTMLElement, event: TimelineEvent): void {
    const row = parent.createDiv('novalist-timeline-event');
    row.addClass(`is-${event.source}`);
    if (!event.sortDate) row.addClass('is-no-date');

    // Dot — color indicates the source type
    const dotColor = SOURCE_COLORS[event.source];
    const dot = row.createDiv('novalist-timeline-event-dot');
    dot.setCssProps({ '--dot-color': dotColor });
    dot.setAttr('aria-label', sourceLabel(event.source));
    dot.setAttr('title', sourceLabel(event.source));

    // Card body
    const card = row.createDiv('novalist-timeline-event-card');

    // Date label
    card.createDiv({ text: formatDateLabel(event.sortDate, event.date, this.currentZoom), cls: 'novalist-timeline-event-date' });

    // Title
    const titleRow = card.createDiv('novalist-timeline-event-title');
    titleRow.createEl('span', { text: event.title });

    // Source badge — colored per source
    const badge = titleRow.createEl('span', { text: sourceLabel(event.source), cls: 'novalist-timeline-event-source' });
    badge.setCssProps({ '--badge-color': dotColor });

    // Description
    if (event.description) {
      card.createDiv({ text: event.description, cls: 'novalist-timeline-event-desc' });
    }

    // Meta: characters & locations
    if (event.characters.length > 0 || event.locations.length > 0) {
      const meta = card.createDiv('novalist-timeline-event-meta');
      if (event.characters.length > 0) {
        const charLine = meta.createDiv('novalist-timeline-event-meta-row');
        charLine.createEl('span', { text: `${t('timeline.characters')}: `, cls: 'novalist-timeline-event-meta-label' });
        for (const c of event.characters) {
          charLine.createEl('span', { text: c, cls: 'novalist-timeline-event-badge' });
        }
      }
      if (event.locations.length > 0) {
        const locLine = meta.createDiv('novalist-timeline-event-meta-row');
        locLine.createEl('span', { text: `${t('timeline.locations')}: `, cls: 'novalist-timeline-event-meta-label' });
        for (const l of event.locations) {
          locLine.createEl('span', { text: l, cls: 'novalist-timeline-event-badge novalist-timeline-event-badge-loc' });
        }
      }
    }

    // Actions for manual events
    if (event.source === 'manual') {
      const actions = card.createDiv('novalist-timeline-event-actions');
      const editBtn = actions.createEl('button', { cls: 'novalist-timeline-event-action-btn', attr: { 'aria-label': t('timeline.editEvent') } });
      setIcon(editBtn, 'pencil');
      editBtn.createEl('span', { text: t('timeline.editEvent') });
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onEditEvent(event.id.replace('manual-', ''));
      });

      const delBtn = actions.createEl('button', { cls: 'novalist-timeline-event-action-btn novalist-timeline-event-action-btn-danger', attr: { 'aria-label': t('timeline.deleteEvent') } });
      setIcon(delBtn, 'trash-2');
      delBtn.createEl('span', { text: t('timeline.deleteEvent') });
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.onDeleteEvent(event.id.replace('manual-', ''));
      });
    }

    // Click to open chapter
    if (event.chapterPath) {
      card.addClass('is-clickable');
      card.addEventListener('click', () => this.onEventClick(event));
    }
  }

  private renderEventCardCompact(parent: HTMLElement, event: TimelineEvent): void {
    const card = parent.createDiv('novalist-timeline-event-card novalist-timeline-h-card');
    const dotColor = SOURCE_COLORS[event.source];
    card.setCssProps({ '--card-accent': dotColor });

    card.createDiv({ text: event.title, cls: 'novalist-timeline-event-title' });

    const badge = card.createEl('span', { text: sourceLabel(event.source), cls: 'novalist-timeline-event-source' });
    badge.setCssProps({ '--badge-color': dotColor });

    if (event.chapterPath) {
      card.addClass('is-clickable');
      card.addEventListener('click', () => this.onEventClick(event));
    }
  }

  // ── Floating form overlay ────────────────────────────────────────

  private showFormOverlay(existing?: TimelineManualEvent): void {
    // Remove any existing overlay
    this.containerEl.querySelector('.novalist-timeline-form-overlay')?.remove();

    const overlay = this.containerEl.createDiv('novalist-timeline-form-overlay');
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    const form = overlay.createDiv('novalist-timeline-form');
    this.populateForm(form, existing);
  }

  private populateForm(form: HTMLElement, existing?: TimelineManualEvent): void {
    const categories = this.timelineData.categories;
    const chapters = this.plugin.getChapterDescriptionsSync();
    const usedDates = getUsedDates(this.events);

    // ── Title ──
    const titleRow = form.createDiv('novalist-timeline-form-row');
    titleRow.createEl('label', { text: t('timeline.eventTitle') });
    const titleInput = titleRow.createEl('input', { type: 'text', value: existing?.title || '' });

    // ── Date ── (native date picker + mini-calendar)
    const dateRow = form.createDiv('novalist-timeline-form-row');
    dateRow.createEl('label', { text: t('timeline.eventDate') });
    const dateInput = dateRow.createEl('input', { type: 'date', value: existing?.date || '' });
    if (usedDates.length > 0) {
      this.buildMiniCalendar(dateRow, dateInput, usedDates);
    }

    // ── Category (single dropdown, localized) ──
    const catRow = form.createDiv('novalist-timeline-form-row');
    catRow.createEl('label', { text: t('timeline.eventCategory') });
    const catSelect = catRow.createEl('select');
    for (const cat of categories) {
      const opt = catSelect.createEl('option', { value: cat.id, text: categoryDisplayName(cat) });
      if (existing?.categoryId === cat.id) opt.selected = true;
    }

    // ── Description ──
    const descRow = form.createDiv('novalist-timeline-form-row');
    descRow.createEl('label', { text: t('timeline.eventDescription') });
    const descInput = descRow.createEl('textarea', { text: existing?.description || '' });

    // ── Characters (badge + inline suggester) ──
    const charRow = form.createDiv('novalist-timeline-form-row');
    charRow.createEl('label', { text: t('timeline.selectCharacters') });
    const selectedChars = new Set<string>(existing?.characters ?? []);
    const charBadgeWrapper = charRow.createDiv('character-badges-container');

    const renderCharBadges = (): void => {
      charBadgeWrapper.empty();
      for (const name of selectedChars) {
        const badge = charBadgeWrapper.createDiv('character-badge');
        badge.setText(name);
        const removeBtn = badge.createSpan('character-badge-remove');
        setIcon(removeBtn, 'x');
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedChars.delete(name);
          renderCharBadges();
        });
      }
      const input = charBadgeWrapper.createEl('input', {
        type: 'text',
        cls: 'character-badge-input',
        placeholder: t('charSheet.addPlaceholder'),
      });
      const charFolder = `${this.plugin.settings.projectPath}/${this.plugin.settings.characterFolder}`;
      new EntityInlineSuggest(this.app, this.plugin, charFolder, input, (file) => {
        if (!selectedChars.has(file.basename)) {
          selectedChars.add(file.basename);
          renderCharBadges();
        }
      });
    };
    renderCharBadges();

    // ── Locations (badge + inline suggester) ──
    const locRow = form.createDiv('novalist-timeline-form-row');
    locRow.createEl('label', { text: t('timeline.selectLocations') });
    const selectedLocs = new Set<string>(existing?.locations ?? []);
    const locBadgeWrapper = locRow.createDiv('character-badges-container');

    const renderLocBadges = (): void => {
      locBadgeWrapper.empty();
      for (const name of selectedLocs) {
        const badge = locBadgeWrapper.createDiv('character-badge');
        badge.setText(name);
        const removeBtn = badge.createSpan('character-badge-remove');
        setIcon(removeBtn, 'x');
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedLocs.delete(name);
          renderLocBadges();
        });
      }
      const input = locBadgeWrapper.createEl('input', {
        type: 'text',
        cls: 'character-badge-input',
        placeholder: t('charSheet.addPlaceholder'),
      });
      const locFolder = `${this.plugin.settings.projectPath}/${this.plugin.settings.locationFolder}`;
      new EntityInlineSuggest(this.app, this.plugin, locFolder, input, (file) => {
        if (!selectedLocs.has(file.basename)) {
          selectedLocs.add(file.basename);
          renderLocBadges();
        }
      });
    };
    renderLocBadges();

    // ── Link to chapter ──
    const chapterRow = form.createDiv('novalist-timeline-form-row');
    chapterRow.createEl('label', { text: t('timeline.linkChapter') });
    const chapterSelect = chapterRow.createEl('select');
    chapterSelect.createEl('option', { value: '', text: t('timeline.noChapterLink') });
    for (const ch of chapters) {
      const opt = chapterSelect.createEl('option', { value: ch.file.path, text: ch.name });
      if (existing?.linkedChapterPath === ch.file.path) opt.selected = true;
    }

    // ── Link to scene ──
    const sceneRow = form.createDiv('novalist-timeline-form-row');
    sceneRow.createEl('label', { text: t('timeline.linkScene') });
    const sceneSelect = sceneRow.createEl('select');
    sceneSelect.createEl('option', { value: '', text: t('timeline.noChapterLink') });

    const updateScenes = () => {
      while (sceneSelect.options.length > 1) sceneSelect.remove(1);
      const selectedChapter = chapters.find(c => c.file.path === chapterSelect.value);
      if (selectedChapter) {
        for (const scene of selectedChapter.scenes) {
          const opt = sceneSelect.createEl('option', { value: scene, text: scene });
          if (existing?.linkedSceneName === scene) opt.selected = true;
        }
      }
    };
    updateScenes();
    chapterSelect.addEventListener('change', updateScenes);

    // ── Actions ──
    const actions = form.createDiv('novalist-timeline-form-actions');
    const cancelBtn = actions.createEl('button', { text: t('timeline.cancel') });
    cancelBtn.addEventListener('click', () => {
      this.containerEl.querySelector('.novalist-timeline-form-overlay')?.remove();
    });

    const saveBtn = actions.createEl('button', { text: t('timeline.save'), cls: 'mod-cta' });
    saveBtn.addEventListener('click', () => {
      const title = titleInput.value.trim();
      if (!title) return;

      const manualEvent: TimelineManualEvent = {
        id: existing?.id || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        title,
        date: dateInput.value.trim(),
        description: descInput.value.trim(),
        categoryId: catSelect.value,
        linkedChapterPath: chapterSelect.value,
        linkedSceneName: sceneSelect.value,
        order: existing?.order ?? this.timelineData.manualEvents.length,
        characters: [...selectedChars],
        locations: [...selectedLocs],
      };

      if (existing) {
        const idx = this.timelineData.manualEvents.findIndex(e => e.id === existing.id);
        if (idx >= 0) this.timelineData.manualEvents[idx] = manualEvent;
      } else {
        this.timelineData.manualEvents.push(manualEvent);
      }

      this.containerEl.querySelector('.novalist-timeline-form-overlay')?.remove();
      void this.plugin.saveSettings().then(() => this.render());
    });
  }

  // ── Mini-calendar for date picking ────────────────────────────────

  private buildMiniCalendar(parent: HTMLElement, dateInput: HTMLInputElement, usedDates: string[]): void {
    const usedSet = new Set(usedDates);
    const initial = dateInput.value ? new Date(dateInput.value + 'T12:00:00') : new Date();
    let currentYear = initial.getFullYear();
    let currentMonth = initial.getMonth();

    const cal = parent.createDiv('novalist-timeline-mini-cal');

    const renderMonth = (): void => {
      cal.empty();

      // Header: ‹ Month Year ›
      const header = cal.createDiv('novalist-timeline-mini-cal-header');
      const prevBtn = header.createEl('button', { cls: 'novalist-timeline-mini-cal-nav' });
      setIcon(prevBtn, 'chevron-left');
      header.createEl('span', {
        text: new Date(currentYear, currentMonth).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
        cls: 'novalist-timeline-mini-cal-title',
      });
      const nextBtn = header.createEl('button', { cls: 'novalist-timeline-mini-cal-nav' });
      setIcon(nextBtn, 'chevron-right');

      prevBtn.addEventListener('click', (e) => {
        e.preventDefault();
        currentMonth--;
        if (currentMonth < 0) { currentMonth = 11; currentYear--; }
        renderMonth();
      });
      nextBtn.addEventListener('click', (e) => {
        e.preventDefault();
        currentMonth++;
        if (currentMonth > 11) { currentMonth = 0; currentYear++; }
        renderMonth();
      });

      // Day-of-week headers
      const grid = cal.createDiv('novalist-timeline-mini-cal-grid');
      const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
      for (const d of dayNames) {
        grid.createDiv({ text: d, cls: 'novalist-timeline-mini-cal-dow' });
      }

      // Blank cells before first day of month
      const firstDow = new Date(currentYear, currentMonth, 1).getDay();
      for (let i = 0; i < firstDow; i++) {
        grid.createDiv('novalist-timeline-mini-cal-empty');
      }

      // Day cells
      const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const iso = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const cell = grid.createDiv('novalist-timeline-mini-cal-day');
        cell.setText(String(day));
        if (usedSet.has(iso)) cell.addClass('has-event');
        if (dateInput.value === iso) cell.addClass('is-selected');
        cell.addEventListener('click', (e) => {
          e.preventDefault();
          dateInput.value = iso;
          renderMonth();
        });
      }
    };

    renderMonth();

    // Keep calendar in sync when user types a date manually
    dateInput.addEventListener('change', () => {
      if (dateInput.value) {
        const d = new Date(dateInput.value + 'T12:00:00');
        currentYear = d.getFullYear();
        currentMonth = d.getMonth();
      }
      renderMonth();
    });
  }

  // ── Interactions ─────────────────────────────────────────────────

  private onEventClick(event: TimelineEvent): void {
    if (!event.chapterPath) return;
    const file = this.plugin.app.vault.getAbstractFileByPath(event.chapterPath);
    if (file instanceof TFile) {
      void this.plugin.app.workspace.getLeaf('tab').openFile(file);
    }
  }

  private onEditEvent(eventId: string): void {
    const event = this.timelineData.manualEvents.find(e => e.id === eventId);
    if (!event) return;
    this.showFormOverlay(event);
  }

  private async onDeleteEvent(eventId: string): Promise<void> {
    const idx = this.timelineData.manualEvents.findIndex(e => e.id === eventId);
    if (idx < 0) return;
    this.timelineData.manualEvents.splice(idx, 1);
    await this.plugin.saveSettings();
    await this.render();
  }

  private async onModeToggle(): Promise<void> {
    this.currentMode = this.currentMode === 'vertical' ? 'horizontal' : 'vertical';
    this.timelineData.viewMode = this.currentMode;
    await this.plugin.saveSettings();
    await this.render();
  }

  private async onZoomCycle(): Promise<void> {
    const levels: TimelineZoomLevel[] = ['year', 'month', 'day'];
    const idx = levels.indexOf(this.currentZoom);
    this.currentZoom = levels[(idx + 1) % levels.length];
    this.timelineData.zoomLevel = this.currentZoom;
    await this.plugin.saveSettings();
    await this.render();
  }
}
