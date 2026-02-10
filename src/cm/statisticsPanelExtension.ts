import { Facet, type Extension } from '@codemirror/state';
import { showPanel, EditorView, type Panel, type ViewUpdate } from '@codemirror/view';
import { setIcon } from 'obsidian';
import type { LanguageKey, WordCountGoals } from '../types';
import { countWords, countCharacters, estimateReadingTime, formatWordCount, calculateDailyProgress, calculateProjectProgress } from '../utils/statisticsUtils';
import { calculateReadability, getReadabilityColor, formatReadabilityScore, type ReadabilityScore } from '../utils/readabilityUtils';

// ─── Facet: configuration from the plugin ──────────────────────────
export interface ChapterOverviewStat {
  name: string;
  words: number;
  readability: ReadabilityScore | null;
}

export interface ProjectOverview {
  totalWords: number;
  totalChapters: number;
  totalCharacters: number;
  totalLocations: number;
  readingTime: number;
  avgChapter: number;
  chapters: ChapterOverviewStat[];
}

export interface StatisticsPanelConfig {
  language: LanguageKey;
  getGoals: () => WordCountGoals;
  getProjectOverview: () => ProjectOverview;
}

export const statisticsPanelConfig = Facet.define<StatisticsPanelConfig, StatisticsPanelConfig>({
  combine: (values) => values[0] ?? {
    language: 'en' as LanguageKey,
    getGoals: () => ({ dailyGoal: 1000, projectGoal: 50000, dailyHistory: [] }),
    getProjectOverview: () => ({ totalWords: 0, totalChapters: 0, totalCharacters: 0, totalLocations: 0, readingTime: 0, avgChapter: 0, chapters: [] })
  }
});

// ─── Helpers ────────────────────────────────────────────────────────
function getLevelLabel(level: ReadabilityScore['level']): string {
  switch (level) {
    case 'very_easy': return 'Very Easy';
    case 'easy': return 'Easy';
    case 'moderate': return 'Moderate';
    case 'difficult': return 'Difficult';
    case 'very_difficult': return 'Very Difficult';
    default: return '';
  }
}

function formatReadingTime(minutes: number): string {
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours} hr` : `${hours}h ${rem}m`;
}

// ─── Panel builder ──────────────────────────────────────────────────
let activePopup: HTMLElement | null = null;
let activePopupCleanup: (() => void) | null = null;

function removePopup(): void {
  if (activePopup) { activePopup.remove(); activePopup = null; }
  if (activePopupCleanup) { activePopupCleanup(); activePopupCleanup = null; }
}

function showChapterPopup(overview: ProjectOverview, anchor: HTMLElement): void {
  // Toggle off if already open
  if (activePopup) { removePopup(); return; }

  const popup = document.createElement('div');
  popup.className = 'novalist-stats-popup';

  // Header
  popup.createEl('div', { text: 'Chapter breakdown', cls: 'novalist-stats-popup-title' });

  if (overview.chapters.length === 0) {
    popup.createEl('div', { text: 'No chapters found.', cls: 'novalist-stats-popup-empty' });
  } else {
    const table = popup.createEl('table', { cls: 'novalist-stats-popup-table' });
    const thead = table.createEl('thead');
    const headRow = thead.createEl('tr');
    headRow.createEl('th', { text: 'Chapter' });
    headRow.createEl('th', { text: 'Words' });
    headRow.createEl('th', { text: 'Readability' });

    const tbody = table.createEl('tbody');
    const maxWords = Math.max(...overview.chapters.map(c => c.words), 1);

    for (const ch of overview.chapters) {
      const row = tbody.createEl('tr');

      // Name
      row.createEl('td', { text: ch.name, cls: 'novalist-stats-popup-name' });

      // Words + mini bar
      const wordsTd = row.createEl('td', { cls: 'novalist-stats-popup-words' });
      wordsTd.createEl('span', { text: formatWordCount(ch.words) });
      const bar = wordsTd.createDiv('novalist-stats-popup-bar');
      const fill = bar.createDiv('novalist-stats-popup-bar-fill');
      fill.style.width = `${(ch.words / maxWords) * 100}%`;

      // Readability badge
      const readTd = row.createEl('td', { cls: 'novalist-stats-popup-read' });
      if (ch.readability && ch.readability.score > 0) {
        const badge = readTd.createEl('span', {
          text: formatReadabilityScore(ch.readability),
          cls: 'novalist-stats-panel-readability-badge'
        });
        badge.style.backgroundColor = getReadabilityColor(ch.readability.level);
        readTd.createEl('span', {
          text: getLevelLabel(ch.readability.level),
          cls: 'novalist-stats-popup-level'
        });
      } else {
        readTd.createEl('span', { text: '–', cls: 'novalist-stats-popup-na' });
      }
    }
  }

  // Position above the anchor
  const rect = anchor.getBoundingClientRect();
  popup.setCssStyles({
    bottom: `${window.innerHeight - rect.top + 4}px`,
    left: `${rect.left}px`
  });
  document.body.appendChild(popup);
  activePopup = popup;

  // Dismiss on outside click
  const onDocClick = (ev: MouseEvent) => {
    if (popup && !popup.contains(ev.target as Node) && !anchor.contains(ev.target as Node)) {
      removePopup();
    }
  };
  // Use setTimeout to avoid the current click triggering dismiss
  setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
  activePopupCleanup = () => document.removeEventListener('click', onDocClick, true);
}

function buildStatsPanel(view: EditorView): Panel {
  const dom = document.createElement('div');
  dom.className = 'novalist-stats-panel';

  function render(state: typeof view.state): void {
    const text = state.doc.toString();
    const cfg = state.facet(statisticsPanelConfig);

    // Current-file statistics
    const words = countWords(text);
    const chars = countCharacters(text, true);
    const charsNoSpace = countCharacters(text, false);
    const readingTime = estimateReadingTime(words);
    const readability = calculateReadability(text, cfg.language);

    // Goal progress
    const goals = cfg.getGoals();
    const overview = cfg.getProjectOverview();
    const daily = calculateDailyProgress(goals);
    const project = calculateProjectProgress(goals, overview.totalWords);

    dom.empty();

    // ── Left: file metrics ──
    const left = dom.createDiv('novalist-stats-panel-left');
    addStat(left, 'pen-tool', `${formatWordCount(words)} words`);
    addStat(left, 'type', `${chars.toLocaleString()} chars`);
    addStat(left, 'type', `${charsNoSpace.toLocaleString()} (no spaces)`, 'novalist-stats-panel-dim');
    addStat(left, 'clock', formatReadingTime(readingTime));

    if (readability.score > 0) {
      const readEl = left.createDiv('novalist-stats-panel-item');
      const badge = readEl.createEl('span', {
        text: formatReadabilityScore(readability),
        cls: 'novalist-stats-panel-readability-badge'
      });
      badge.style.backgroundColor = getReadabilityColor(readability.level);
      readEl.createEl('span', { text: getLevelLabel(readability.level) });
    }

    // ── Middle: project overview (clickable) ──
    const mid = dom.createDiv('novalist-stats-panel-mid novalist-stats-panel-clickable');
    addStat(mid, 'pen-tool', `${formatWordCount(overview.totalWords)}`, 'novalist-stats-panel-dim');
    addStat(mid, 'book-open', `${overview.totalChapters} ch`);
    addStat(mid, 'users', `${overview.totalCharacters} char`);
    addStat(mid, 'map-pin', `${overview.totalLocations} loc`);
    addStat(mid, 'clock', formatReadingTime(overview.readingTime), 'novalist-stats-panel-dim');
    addStat(mid, 'align-left', `~${formatWordCount(overview.avgChapter)}/ch`, 'novalist-stats-panel-dim');
    mid.addEventListener('click', (e) => {
      e.stopPropagation();
      showChapterPopup(overview, mid);
    });

    // ── Right: goal mini bars ──
    const right = dom.createDiv('novalist-stats-panel-right');

    // Daily goal
    if (goals.dailyGoal > 0) {
      const dailyEl = right.createDiv('novalist-stats-panel-goal');
      dailyEl.createEl('span', {
        text: `Daily ${daily.percentage}%`,
        cls: 'novalist-stats-panel-goal-label'
      });
      const bar = dailyEl.createDiv('novalist-stats-panel-bar');
      const fill = bar.createDiv('novalist-stats-panel-bar-fill');
      fill.style.width = `${Math.min(100, daily.percentage)}%`;
      if (daily.percentage >= 100) fill.addClass('novalist-stats-panel-bar-complete');
    }

    // Project goal
    if (goals.projectGoal > 0) {
      const projEl = right.createDiv('novalist-stats-panel-goal');
      projEl.createEl('span', {
        text: `Project ${project.percentage}%`,
        cls: 'novalist-stats-panel-goal-label'
      });
      const bar = projEl.createDiv('novalist-stats-panel-bar');
      const fill = bar.createDiv('novalist-stats-panel-bar-fill');
      fill.style.width = `${Math.min(100, project.percentage)}%`;
      if (project.percentage >= 100) fill.addClass('novalist-stats-panel-bar-complete');
    }
  }

  function addStat(
    parent: HTMLElement, icon: string, label: string, extraCls?: string
  ): void {
    const item = parent.createDiv('novalist-stats-panel-item');
    if (extraCls) item.addClass(extraCls);
    const iconEl = item.createEl('span', { cls: 'novalist-stats-panel-icon' });
    setIcon(iconEl, icon);
    item.createEl('span', { text: label });
  }

  // Initial render
  render(view.state);

  // Debounce updates to avoid running stats on every keystroke
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    dom,
    update(update: ViewUpdate) {
      if (!update.docChanged && !update.startState.facet(statisticsPanelConfig)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        render(update.state);
      }, 500);
    }
  };
}

const statsPanel = showPanel.of(buildStatsPanel);

// ─── Public: create the extension ──────────────────────────────────
export function statisticsPanelExtension(config: StatisticsPanelConfig): Extension {
  return [
    statisticsPanelConfig.of(config),
    statsPanel
  ];
}
