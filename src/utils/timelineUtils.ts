import type NovalistPlugin from '../main';
import type { TimelineEvent, TimelineEventSource, TimelineCategory } from '../types';

/**
 * Parse a date string into a Date object.
 * Supports:
 *   YYYY-MM-DD (ISO)
 *   YYYY-MM (month precision)
 *   YYYY (year precision)
 *   Month DD, YYYY (e.g. "January 15, 2024")
 *   DD.MM.YYYY (European)
 * Returns null for unrecognisable formats.
 */
export function parseTimelineDate(dateStr: string): Date | null {
  if (!dateStr || !dateStr.trim()) return null;
  const s = dateStr.trim();

  // ISO: YYYY-MM-DD
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!isNaN(d.getTime())) return d;
  }

  // Month precision: YYYY-MM
  const ym = /^(\d{4})-(\d{2})$/.exec(s);
  if (ym) {
    const d = new Date(Number(ym[1]), Number(ym[2]) - 1, 1);
    if (!isNaN(d.getTime())) return d;
  }

  // Year precision: YYYY
  const y = /^(\d{4})$/.exec(s);
  if (y) {
    const d = new Date(Number(y[1]), 0, 1);
    if (!isNaN(d.getTime())) return d;
  }

  // Month DD, YYYY
  const named = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (named) {
    const d = new Date(`${named[1]} ${named[2]}, ${named[3]}`);
    if (!isNaN(d.getTime())) return d;
  }

  // European DD.MM.YYYY
  const eu = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (eu) {
    const d = new Date(Number(eu[3]), Number(eu[2]) - 1, Number(eu[1]));
    if (!isNaN(d.getTime())) return d;
  }

  // Fallback: try native parse
  const fallback = new Date(s);
  if (!isNaN(fallback.getTime())) return fallback;

  return null;
}

/** Resolve a category color from the categories list. */
function resolveCategoryColor(categories: TimelineCategory[], categoryId: string): string {
  const cat = categories.find(c => c.id === categoryId);
  return cat?.color || 'var(--text-muted)';
}

/** Source-specific colors used for dots and badge accents. */
export const SOURCE_COLORS: Record<TimelineEventSource, string> = {
  act: '#9b59b6',
  chapter: '#3498db',
  scene: '#27ae60',
  manual: '#e67e22',
};

/**
 * Gather events from all sources —
 * chapter dates, scene dates, act markers, and manual events.
 */
export async function buildTimelineEvents(plugin: NovalistPlugin): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];
  const chapters = plugin.getChapterDescriptionsSync();
  const timelineData = plugin.settings.timeline;
  const categories = timelineData.categories;

  // Helper to get chapter-level mentions via the plugin's persistent cache
  async function getMentions(filePath: string): Promise<{ characters: string[]; locations: string[] }> {
    const file = plugin.app.vault.getAbstractFileByPath(filePath);
    if (!file || !('extension' in file)) return { characters: [], locations: [] };
    const parsed = await plugin.parseChapterFile(file as import('obsidian').TFile);
    return { characters: parsed.characters, locations: parsed.locations };
  }

  // Helper to get scene-level mentions via the plugin's persistent cache
  async function getSceneMentions(filePath: string, sceneName: string): Promise<{ characters: string[]; locations: string[] }> {
    const file = plugin.app.vault.getAbstractFileByPath(filePath);
    if (!file || !('extension' in file)) return { characters: [], locations: [] };
    const parsed = await plugin.getSceneMentions(file as import('obsidian').TFile, sceneName);
    return { characters: parsed.characters, locations: parsed.locations };
  }

  // Track seen acts to insert act markers at the first chapter of each act
  const seenActs = new Set<string>();

  // 1) Chapter events
  for (const ch of chapters) {
    // Act marker — emit once per unique act name
    if (ch.act && !seenActs.has(ch.act)) {
      seenActs.add(ch.act);
      const actDate = ch.date || '';
      events.push({
        id: `act-${ch.act}`,
        title: ch.act,
        date: actDate,
        sortDate: parseTimelineDate(actDate),
        description: '',
        source: 'act' as TimelineEventSource,
        categoryId: 'plot',
        categoryColor: resolveCategoryColor(categories, 'plot'),
        chapterPath: '',
        sceneName: '',
        actName: ch.act,
        chapterOrder: ch.order - 0.5, // sort slightly before first chapter
        characters: [],
        locations: [],
      });
    }

    if (ch.date) {
      const mentions = await getMentions(ch.file.path);
      events.push({
        id: `ch-${ch.id}`,
        title: ch.name,
        date: ch.date,
        sortDate: parseTimelineDate(ch.date),
        description: '',
        source: 'chapter' as TimelineEventSource,
        categoryId: 'plot',
        categoryColor: resolveCategoryColor(categories, 'plot'),
        chapterPath: ch.file.path,
        sceneName: '',
        actName: ch.act,
        chapterOrder: ch.order,
        characters: mentions.characters,
        locations: mentions.locations,
      });
    }

    // 2) Scene events
    for (const sceneName of ch.scenes) {
      const sceneDate = plugin.getSceneDateSync(ch.file, sceneName);
      // Only create a separate scene event if the scene has its own date
      // different from the chapter date (or if the chapter has no date)
      if (sceneDate && sceneDate !== ch.date) {
        const mentions = await getSceneMentions(ch.file.path, sceneName);
        events.push({
          id: `sc-${ch.id}-${sceneName}`,
          title: `${ch.name}: ${sceneName}`,
          date: sceneDate,
          sortDate: parseTimelineDate(sceneDate),
          description: '',
          source: 'scene' as TimelineEventSource,
          categoryId: 'plot',
          categoryColor: resolveCategoryColor(categories, 'plot'),
          chapterPath: ch.file.path,
          sceneName,
          actName: ch.act,
          chapterOrder: ch.order,
          characters: mentions.characters,
          locations: mentions.locations,
        });
      }
    }
  }

  // 3) Manual events
  for (const me of timelineData.manualEvents) {
    events.push({
      id: `manual-${me.id}`,
      title: me.title,
      date: me.date,
      sortDate: parseTimelineDate(me.date),
      description: me.description,
      source: 'manual' as TimelineEventSource,
      categoryId: me.categoryId,
      categoryColor: resolveCategoryColor(categories, me.categoryId),
      chapterPath: me.linkedChapterPath,
      sceneName: me.linkedSceneName,
      actName: '',
      chapterOrder: me.order,
      characters: me.characters ?? [],
      locations: me.locations ?? [],
    });
  }

  return events;
}

/** Sort events chronologically — null dates sort to the end. */
export function sortTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => {
    // Both have dates
    if (a.sortDate && b.sortDate) {
      const diff = a.sortDate.getTime() - b.sortDate.getTime();
      if (diff !== 0) return diff;
      return a.chapterOrder - b.chapterOrder;
    }
    // a has date, b does not → a comes first
    if (a.sortDate && !b.sortDate) return -1;
    if (!a.sortDate && b.sortDate) return 1;
    // Neither has date — sort by chapter order
    return a.chapterOrder - b.chapterOrder;
  });
}

/** Extract unique character names from events for filter dropdown. */
export function getUniqueCharacters(events: TimelineEvent[]): string[] {
  const set = new Set<string>();
  for (const e of events) {
    for (const c of e.characters) set.add(c);
  }
  return [...set].sort();
}

/** Extract unique location names from events for filter dropdown. */
export function getUniqueLocations(events: TimelineEvent[]): string[] {
  const set = new Set<string>();
  for (const e of events) {
    for (const l of e.locations) set.add(l);
  }
  return [...set].sort();
}

/** Collect all unique ISO date strings already used across all events. */
export function getUsedDates(events: TimelineEvent[]): string[] {
  const set = new Set<string>();
  for (const e of events) {
    if (e.sortDate) {
      const iso = `${e.sortDate.getFullYear()}-${String(e.sortDate.getMonth() + 1).padStart(2, '0')}-${String(e.sortDate.getDate()).padStart(2, '0')}`;
      set.add(iso);
    }
  }
  return [...set].sort();
}

/** Format a Date for display at a given zoom level. */
export function formatDateLabel(date: Date | null, dateStr: string, zoom: 'year' | 'month' | 'day'): string {
  if (!date) return dateStr || '???';
  const yr = date.getFullYear();
  const mo = date.toLocaleString('default', { month: 'short' });
  const dy = date.getDate();
  switch (zoom) {
    case 'year':  return `${yr}`;
    case 'month': return `${mo} ${yr}`;
    case 'day':   return `${mo} ${dy}, ${yr}`;
  }
}

/** Group key for grouping events by zoom level. */
export function groupKey(date: Date | null, zoom: 'year' | 'month' | 'day'): string {
  if (!date) return 'no-date';
  const yr = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const dy = String(date.getDate()).padStart(2, '0');
  switch (zoom) {
    case 'year':  return `${yr}`;
    case 'month': return `${yr}-${mo}`;
    case 'day':   return `${yr}-${mo}-${dy}`;
  }
}

/** Label for a group key at the given zoom level. */
export function groupLabel(key: string, zoom: 'year' | 'month' | 'day'): string {
  if (key === 'no-date') return '???';
  const parts = key.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  switch (zoom) {
    case 'year':  return `${parts[0]}`;
    case 'month': return `${months[parts[1] - 1]} ${parts[0]}`;
    case 'day': {
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    }
  }
}
