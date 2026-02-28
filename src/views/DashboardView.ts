import { ItemView, WorkspaceLeaf, TFile, MarkdownView, setIcon } from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';
import { 
  calculateProjectStatistics, 
  calculateDailyProgress, 
  calculateProjectProgress, 
  calculateWritingStreak,
  formatWordCount,
  formatReadingTime,
  formatTimeAgo
} from '../utils/statisticsUtils';
import { CHAPTER_STATUSES, type ChapterStatus, type RecentEditEntry } from '../types';

export const DASHBOARD_VIEW_TYPE = 'novalist-dashboard';

export class DashboardView extends ItemView {
  plugin: NovalistPlugin;
  private refreshDebounceTimer: number | null = null;
  private currentTrendRange: 30 | 90 | 365 = 30;

  constructor(leaf: WorkspaceLeaf, plugin: NovalistPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return DASHBOARD_VIEW_TYPE; }
  getDisplayText(): string { return t('dashboard.displayName'); }
  getIcon(): string { return 'layout-dashboard'; }

  async onOpen(): Promise<void> {
    await this.render();
    this.registerVaultEvents();
  }

  async onClose(): Promise<void> {
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
    }
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

  async render(): Promise<void> {
    const container = this.containerEl;
    container.empty();
    container.addClass('novalist-dashboard');

    // Header with project name and refresh button
    const header = container.createDiv('novalist-dashboard-header');
    const activeProject = this.plugin.getActiveProject();
    const projectName = activeProject?.name || t('dashboard.displayName');
    header.createEl('h2', { text: projectName });
    const refreshBtn = header.createEl('button', { cls: 'novalist-dashboard-refresh-btn' });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.setAttr('aria-label', t('dashboard.refresh'));
    refreshBtn.addEventListener('click', () => void this.render());

    // Toolbar ribbon
    if (this.plugin.toolbarManager) {
      const toolbarHost = container.createDiv('novalist-dashboard-toolbar');
      this.plugin.toolbarManager.renderToolbarInto(toolbarHost);
    }

    // Get all data
    const stats = await calculateProjectStatistics(this.plugin);
    const chapters = this.plugin.getChapterDescriptionsSync();
    const characters = await this.plugin.getCharacterList();
    const locations = this.plugin.getLocationList();
    const items = this.plugin.getItemList();
    const loreEntries = this.plugin.getLoreList();
    const goals = this.plugin.settings.wordCountGoals;
    const dailyProgress = calculateDailyProgress(goals);
    const projectProgress = calculateProjectProgress(goals, stats.totalWords);
    const streak = calculateWritingStreak(goals);
    const recentEdits = this.plugin.settings.recentEdits || [];

    // Section 1: Continue Writing (Recent Files)
    this.renderRecentFiles(container, recentEdits);

    // Section 2: Project Overview
    this.renderProjectOverview(container, stats, characters.length, locations.length, items.length, loreEntries.length);

    // Section 3: Daily Progress + Streak
    this.renderDailyProgress(container, dailyProgress, streak);

    // Section 4: Word Count Trends
    this.renderTrends(container, goals);

    // Section 5: Chapter Status Breakdown
    this.renderChapterStatus(container, chapters);

    // Section 6: Goal Tracking
    this.renderGoalTracking(container, dailyProgress, projectProgress, goals);

    // Section 7: Story Health
    this.renderStoryHealth(container);
  }

  private renderRecentFiles(container: HTMLElement, recentEdits: RecentEditEntry[]): void {
    const section = container.createDiv('novalist-dashboard-section');
    section.createEl('h3', { text: t('dashboard.continueWriting'), cls: 'novalist-dashboard-section-title' });

    if (recentEdits.length === 0) {
      section.createEl('p', { text: t('dashboard.noRecentFiles'), cls: 'novalist-dashboard-empty' });
      return;
    }

    const list = section.createDiv('novalist-dashboard-recent-list');
    for (const entry of recentEdits.slice(0, 5)) {
      const item = list.createDiv('novalist-dashboard-recent-item');
      item.createEl('span', { text: '▶', cls: 'novalist-dashboard-recent-icon' });
      
      item.createEl('span', { text: entry.displayName, cls: 'novalist-dashboard-recent-name' });
      const metaEl = item.createEl('span', { cls: 'novalist-dashboard-recent-meta' });
      metaEl.createEl('span', { text: t('dashboard.recentPosition', { line: entry.line + 1, col: entry.ch + 1 }) });
      metaEl.createEl('span', { text: ' · ' });
      metaEl.createEl('span', { text: formatTimeAgo(entry.timestamp) });

      item.addEventListener('click', () => void this.openFileAtPosition(entry));
    }
  }

  private async openFileAtPosition(entry: RecentEditEntry): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(entry.filePath);
    if (!(file instanceof TFile)) return;

    const leaf = this.plugin.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (view) {
      const editor = view.editor;
      editor.setCursor({ line: entry.line, ch: entry.ch });
      editor.scrollIntoView({ from: { line: entry.line, ch: 0 }, to: { line: entry.line, ch: 0 } }, true);
    }
  }

  private renderProjectOverview(
    container: HTMLElement, 
    stats: { totalWords: number; totalChapters: number; estimatedReadingTime: number },
    charCount: number, 
    locCount: number, 
    itemCount: number, 
    loreCount: number
  ): void {
    const section = container.createDiv('novalist-dashboard-section');
    section.createEl('h3', { text: t('dashboard.projectOverview'), cls: 'novalist-dashboard-section-title' });

    const grid = section.createDiv('novalist-dashboard-grid');

    this.createStatCard(grid, 'file-text', formatWordCount(stats.totalWords), t('dashboard.words'));
    this.createStatCard(grid, 'book-open', stats.totalChapters.toString(), t('dashboard.chapters'));
    this.createStatCard(grid, 'clock', formatReadingTime(stats.estimatedReadingTime), t('dashboard.readingTime'));
    this.createStatCard(grid, 'users', charCount.toString(), t('dashboard.characters'));
    this.createStatCard(grid, 'map-pin', locCount.toString(), t('dashboard.locations'));
    this.createStatCard(grid, 'package', itemCount.toString(), t('dashboard.items'));
    this.createStatCard(grid, 'book', loreCount.toString(), t('dashboard.lore'));
  }

  private createStatCard(container: HTMLElement, icon: string, value: string, label: string): void {
    const card = container.createDiv('novalist-dashboard-card');
    const iconEl = card.createDiv('novalist-dashboard-card-icon');
    setIcon(iconEl, icon);
    card.createDiv('novalist-dashboard-card-value', el => el.setText(value));
    card.createDiv('novalist-dashboard-card-label', el => el.setText(label));
  }

  private renderDailyProgress(
    container: HTMLElement, 
    progress: { current: number; target: number; percentage: number },
    streak: number
  ): void {
    const section = container.createDiv('novalist-dashboard-section');
    section.createEl('h3', { text: t('dashboard.dailyProgress'), cls: 'novalist-dashboard-section-title' });

    // Progress bar
    const progressContainer = section.createDiv('novalist-dashboard-progress-container');
    const progressLabel = progressContainer.createDiv('novalist-dashboard-progress-label');
    progressLabel.createSpan({ text: t('dashboard.wordsOf', { current: progress.current.toLocaleString(), target: progress.target.toLocaleString() }) });
    progressLabel.createSpan({ text: ` (${progress.percentage}%)`, cls: 'novalist-dashboard-progress-pct' });

    const progressBar = progressContainer.createDiv('novalist-dashboard-progress-bar');
    const progressFill = progressBar.createDiv('novalist-dashboard-progress-fill');
    progressFill.style.width = `${Math.min(100, progress.percentage)}%`;
    if (progress.percentage >= 100) {
      progressFill.addClass('novalist-dashboard-progress-complete');
    }

    // Streak
    const streakEl = section.createDiv('novalist-dashboard-streak');
    setIcon(streakEl.createSpan('novalist-dashboard-streak-icon'), 'flame');
    const streakText = streak === 1 
      ? t('dashboard.streakDay') 
      : t('dashboard.streakDays', { n: streak });
    streakEl.createSpan({ text: `${t('dashboard.streak')}: ${streakText}` });
  }

  private renderTrends(container: HTMLElement, goals: { dailyHistory: Array<{ date: string; actualWords: number }> }): void {
    const section = container.createDiv('novalist-dashboard-section');
    section.createEl('h3', { text: t('dashboard.trends'), cls: 'novalist-dashboard-section-title' });

    // Range selector
    const controls = section.createDiv('novalist-dashboard-chart-controls');
    const ranges: Array<{ value: 30 | 90 | 365; label: string }> = [
      { value: 30, label: t('dashboard.days30') },
      { value: 90, label: t('dashboard.days90') },
      { value: 365, label: t('dashboard.days365') }
    ];

    for (const range of ranges) {
      const btn = controls.createEl('button', { 
        text: range.label, 
        cls: `novalist-dashboard-range-btn${this.currentTrendRange === range.value ? ' is-active' : ''}`
      });
      btn.addEventListener('click', () => {
        this.currentTrendRange = range.value;
        void this.render();
      });
    }

    // Chart container
    const chartContainer = section.createDiv('novalist-dashboard-chart');
    this.renderBarChart(chartContainer, goals.dailyHistory, this.currentTrendRange);
  }

  private renderBarChart(container: HTMLElement, history: Array<{ date: string; actualWords: number }>, days: number): void {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - days + 1);

    // Filter and pad data
    const data: Array<{ date: string; words: number }> = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const entry = history.find(h => h.date === dateStr);
      data.push({ date: dateStr, words: entry?.actualWords || 0 });
    }

    const maxWords = Math.max(...data.map(d => d.words), 1);
    const barWidth = Math.max(2, Math.floor(600 / days) - 1);
    const chartHeight = 120;

    const svg = container.createSvg('svg', {
      attr: {
        viewBox: `0 0 ${Math.max(600, days * (barWidth + 1))} ${chartHeight + 40}`,
        class: 'novalist-dashboard-bar-chart'
      }
    });

    // Bars
    data.forEach((d, i) => {
      const barHeight = (d.words / maxWords) * chartHeight;
      const x = i * (barWidth + 1);
      const y = chartHeight - barHeight;

      const rect = svg.createSvg('rect', {
        attr: {
          x: x.toString(),
          y: y.toString(),
          width: barWidth.toString(),
          height: Math.max(1, barHeight).toString(),
          class: 'novalist-dashboard-bar'
        }
      });

      // Tooltip
      const title = svg.createSvg('title', {});
      title.setText(`${d.date}: ${d.words.toLocaleString()} words`);
      rect.appendChild(title);
    });

    // X-axis labels (show every N days based on range)
    const labelInterval = days <= 30 ? 7 : days <= 90 ? 15 : 30;
    for (let i = 0; i < days; i += labelInterval) {
      const x = i * (barWidth + 1) + barWidth / 2;
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const label = `${d.getMonth() + 1}/${d.getDate()}`;
      
      const textEl = svg.createSvg('text', {
        attr: {
          x: x.toString(),
          y: (chartHeight + 15).toString(),
          class: 'novalist-dashboard-axis-label',
          'text-anchor': 'middle'
        }
      });
      textEl.setText(label);
    }
  }

  private renderChapterStatus(
    container: HTMLElement, 
    chapters: Array<{ status: ChapterStatus }>
  ): void {
    const section = container.createDiv('novalist-dashboard-section');
    section.createEl('h3', { text: t('dashboard.chapterStatus'), cls: 'novalist-dashboard-section-title' });

    if (chapters.length === 0) {
      section.createEl('p', { text: t('dashboard.noData'), cls: 'novalist-dashboard-empty' });
      return;
    }

    // Count by status
    const counts: Record<ChapterStatus, number> = {
      'outline': 0,
      'first-draft': 0,
      'revised': 0,
      'edited': 0,
      'final': 0
    };
    for (const ch of chapters) {
      counts[ch.status]++;
    }

    const chartContainer = section.createDiv('novalist-dashboard-donut-container');

    // Donut chart
    const donutEl = chartContainer.createDiv('novalist-dashboard-donut');
    this.renderDonutChart(donutEl, counts, chapters.length);

    // Legend
    const legend = chartContainer.createDiv('novalist-dashboard-legend');
    for (const statusDef of CHAPTER_STATUSES) {
      const count = counts[statusDef.value];
      const pct = chapters.length > 0 ? ((count / chapters.length) * 100).toFixed(1) : '0';
      
      const item = legend.createDiv('novalist-dashboard-legend-item');
      const color = item.createDiv('novalist-dashboard-legend-color');
      color.style.backgroundColor = `var(--text-${statusDef.value === 'outline' ? 'faint' : statusDef.value === 'first-draft' ? 'warning' : statusDef.value === 'revised' ? 'accent' : statusDef.value === 'edited' ? 'interactive-accent' : 'success'}, ${statusDef.color.replace('var(--', '').replace(')', '')})`;
      // Use inline color as fallback
      color.style.backgroundColor = statusDef.color;
      item.createSpan({ text: `${statusDef.icon} ${statusDef.label}: ${count} (${pct}%)` });
    }
  }

  private renderDonutChart(container: HTMLElement, counts: Record<ChapterStatus, number>, total: number): void {
    const size = 120;
    const strokeWidth = 20;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;

    const svg = container.createSvg('svg', {
      attr: {
        viewBox: `0 0 ${size} ${size}`,
        class: 'novalist-dashboard-donut-svg'
      }
    });

    // Background circle
    svg.createSvg('circle', {
      attr: {
        cx: (size / 2).toString(),
        cy: (size / 2).toString(),
        r: radius.toString(),
        fill: 'none',
        stroke: 'var(--background-modifier-border)',
        'stroke-width': strokeWidth.toString()
      }
    });

    // Draw segments
    let offset = 0;
    for (const statusDef of CHAPTER_STATUSES) {
      const count = counts[statusDef.value];
      if (count === 0) continue;

      const pct = count / total;
      const dashLength = pct * circumference;

      svg.createSvg('circle', {
        attr: {
          cx: (size / 2).toString(),
          cy: (size / 2).toString(),
          r: radius.toString(),
          fill: 'none',
          stroke: statusDef.color,
          'stroke-width': strokeWidth.toString(),
          'stroke-dasharray': `${dashLength} ${circumference - dashLength}`,
          'stroke-dashoffset': (-offset).toString(),
          class: 'novalist-dashboard-donut-segment'
        }
      });

      offset += dashLength;
    }

    // Center text
    const centerText = svg.createSvg('text', {
      attr: {
        x: (size / 2).toString(),
        y: (size / 2).toString(),
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        class: 'novalist-dashboard-donut-text'
      }
    });
    centerText.setText(total.toString());
  }

  private renderGoalTracking(
    container: HTMLElement, 
    daily: { current: number; target: number; percentage: number },
    project: { current: number; target: number; percentage: number },
    goals: { deadline?: string; projectGoal: number }
  ): void {
    const section = container.createDiv('novalist-dashboard-section');
    section.createEl('h3', { text: t('dashboard.goalTracking'), cls: 'novalist-dashboard-section-title' });

    // Daily goal
    const dailyContainer = section.createDiv('novalist-dashboard-goal-row');
    dailyContainer.createEl('span', { text: t('dashboard.dailyWordGoal'), cls: 'novalist-dashboard-goal-label' });
    const dailyBar = dailyContainer.createDiv('novalist-dashboard-progress-bar novalist-dashboard-progress-bar-small');
    const dailyFill = dailyBar.createDiv('novalist-dashboard-progress-fill');
    dailyFill.style.width = `${Math.min(100, daily.percentage)}%`;
    dailyContainer.createEl('span', { text: t('dashboard.complete', { pct: daily.percentage }), cls: 'novalist-dashboard-goal-pct' });

    // Project completion with ring
    const projectContainer = section.createDiv('novalist-dashboard-project-goal');
    
    const ringContainer = projectContainer.createDiv('novalist-dashboard-ring-container');
    this.renderProgressRing(ringContainer, project.percentage);

    const projectInfo = projectContainer.createDiv('novalist-dashboard-project-info');
    projectInfo.createEl('div', { text: t('dashboard.wordsOf', { current: project.current.toLocaleString(), target: project.target.toLocaleString() }), cls: 'novalist-dashboard-project-words' });
    projectInfo.createEl('div', { text: t('dashboard.complete', { pct: project.percentage }), cls: 'novalist-dashboard-project-pct' });

    // Deadline
    const deadlineContainer = section.createDiv('novalist-dashboard-deadline');
    if (goals.deadline) {
      const deadlineDate = new Date(goals.deadline);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const daysRemaining = Math.ceil((deadlineDate.getTime() - today.getTime()) / 86400000);
      
      deadlineContainer.createEl('span', { text: `${t('dashboard.deadline')}: ` });
      deadlineContainer.createEl('span', { text: goals.deadline, cls: 'novalist-dashboard-deadline-date' });
      
      const remainingEl = deadlineContainer.createEl('span', { cls: 'novalist-dashboard-deadline-remaining' });
      if (daysRemaining > 0) {
        remainingEl.setText(t('dashboard.daysRemaining', { n: daysRemaining }));
        if (daysRemaining < 7) {
          remainingEl.addClass('novalist-dashboard-deadline-urgent');
        }
      } else if (daysRemaining === 0) {
        remainingEl.setText(t('dashboard.daysRemaining', { n: 0 }));
        remainingEl.addClass('novalist-dashboard-deadline-urgent');
      } else {
        remainingEl.setText(t('dashboard.daysOverdue', { n: Math.abs(daysRemaining) }));
        remainingEl.addClass('novalist-dashboard-deadline-overdue');
      }
    } else {
      deadlineContainer.createEl('span', { text: t('dashboard.noDeadline'), cls: 'novalist-dashboard-no-deadline' });
    }
  }

  private renderProgressRing(container: HTMLElement, percentage: number): void {
    const size = 80;
    const strokeWidth = 8;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percentage / 100) * circumference;

    const svg = container.createSvg('svg', {
      attr: {
        viewBox: `0 0 ${size} ${size}`,
        class: 'novalist-dashboard-ring-svg'
      }
    });

    // Background
    svg.createSvg('circle', {
      attr: {
        cx: (size / 2).toString(),
        cy: (size / 2).toString(),
        r: radius.toString(),
        fill: 'none',
        stroke: 'var(--background-modifier-border)',
        'stroke-width': strokeWidth.toString()
      }
    });

    // Progress
    svg.createSvg('circle', {
      attr: {
        cx: (size / 2).toString(),
        cy: (size / 2).toString(),
        r: radius.toString(),
        fill: 'none',
        stroke: 'var(--interactive-accent)',
        'stroke-width': strokeWidth.toString(),
        'stroke-linecap': 'round',
        'stroke-dasharray': circumference.toString(),
        'stroke-dashoffset': offset.toString(),
        class: 'novalist-dashboard-ring-progress'
      }
    });

    // Percentage text
    const text = svg.createSvg('text', {
      attr: {
        x: (size / 2).toString(),
        y: (size / 2).toString(),
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        class: 'novalist-dashboard-ring-text'
      }
    });
    text.setText(`${percentage}%`);
  }

  private renderStoryHealth(container: HTMLElement): void {
    const section = container.createDiv('novalist-dashboard-section novalist-dashboard-health');
    const titleRow = section.createDiv('novalist-dashboard-section-title-row');
    titleRow.createEl('h3', { text: t('validator.dashboard.title'), cls: 'novalist-dashboard-section-title' });
    const validateBtn = titleRow.createEl('button', { cls: 'novalist-dashboard-health-run-btn' });
    setIcon(validateBtn.createSpan('novalist-btn-icon'), 'shield-check');
    validateBtn.createSpan({ text: t('validator.run') });
    validateBtn.addEventListener('click', () => {
      void this.plugin.validateStory().then(() => void this.render());
    });

    const result = this.plugin.getValidationResult();
    if (!result) {
      section.createEl('p', { text: t('validator.neverRun'), cls: 'novalist-dashboard-empty' });
      return;
    }

    // Summary badges row
    const badges = section.createDiv('novalist-dashboard-health-badges');
    const { errors, warnings, infos } = result.summary;
    const badgeDefs: Array<{ count: number; cls: string; icon: string; key: Parameters<typeof t>[0] }> = [
      { count: errors, cls: 'novalist-badge-error', icon: 'x-circle', key: 'validator.errors' },
      { count: warnings, cls: 'novalist-badge-warning', icon: 'alert-triangle', key: 'validator.warnings' },
      { count: infos, cls: 'novalist-badge-info', icon: 'info', key: 'validator.infos' },
    ];
    for (const bd of badgeDefs) {
      const badge = badges.createSpan(`novalist-validator-badge ${bd.cls}`);
      setIcon(badge.createSpan('novalist-badge-icon'), bd.icon);
      badge.createSpan({ text: ` ${t(bd.key, { n: bd.count })}` });
    }

    // Top 5 findings by severity
    const top = [...result.findings]
      .sort((a, b) => {
        const order = { error: 0, warning: 1, info: 2 };
        return order[a.severity] - order[b.severity];
      })
      .slice(0, 5);

    const list = section.createDiv('novalist-dashboard-health-list');
    for (const f of top) {
      const item = list.createDiv(`novalist-dashboard-health-item novalist-card-${f.severity}`);
      const icon = item.createSpan(`novalist-sev-icon novalist-sev-${f.severity}`);
      if (f.severity === 'error') setIcon(icon, 'x-circle');
      else if (f.severity === 'warning') setIcon(icon, 'alert-triangle');
      else setIcon(icon, 'info');
      item.createSpan({ text: f.title, cls: 'novalist-dashboard-health-item-title' });
    }

    const totalFindings = result.findings.length;
    if (totalFindings > 0) {
      const showAll = section.createEl('button', {
        text: t('validator.dashboard.showAll', { n: totalFindings }),
        cls: 'novalist-dashboard-health-show-all',
      });
      showAll.addEventListener('click', () => {
        void this.plugin.openValidatorModal();
      });
    }
  }
}
