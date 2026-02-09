import { ItemView, WorkspaceLeaf, TextComponent, ButtonComponent } from 'obsidian';
import type NovalistPlugin from '../main';
import { 
  calculateProjectStatistics, 
  formatWordCount, 
  formatReadingTime,
  calculateDailyProgress,
  calculateProjectProgress
} from '../utils/statisticsUtils';
import { 
  getReadabilityColor, 
  formatReadabilityScore,
  ReadabilityScore
} from '../utils/readabilityUtils';

export const STATISTICS_VIEW_TYPE = 'novalist-statistics';

export class StatisticsView extends ItemView {
  plugin: NovalistPlugin;
  private refreshInterval: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: NovalistPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return STATISTICS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Novalist statistics';
  }

  getIcon(): string {
    return 'bar-chart-2';
  }

  async onOpen(): Promise<void> {
    this.containerEl.empty();
    await this.render();
    
    // Auto-refresh every 30 seconds
    this.refreshInterval = window.setInterval(() => {
      void this.render();
    }, 30000);
    
    // Refresh when files change
    this.registerEvent(this.app.vault.on('modify', () => {
      void this.render();
    }));
  }

  onClose(): Promise<void> {
    if (this.refreshInterval) {
      window.clearInterval(this.refreshInterval);
    }
    return Promise.resolve();
  }

  async render(): Promise<void> {
    const container = this.containerEl;
    container.empty();
    container.addClass('novalist-statistics');

    // Header
    container.createEl('h3', { text: 'Project statistics', cls: 'novalist-statistics-header' });
    
    // Refresh button
    const headerActions = container.createDiv('novalist-statistics-actions');
    new ButtonComponent(headerActions)
      .setButtonText('Refresh')
      .setIcon('refresh-cw')
      .onClick(() => void this.render());

    // Calculate stats
    const stats = await calculateProjectStatistics(this.plugin);
    const goals = this.plugin.settings.wordCountGoals;
    const dailyProgress = calculateDailyProgress(goals);
    const projectProgress = calculateProjectProgress(goals, stats.totalWords);

    // Goals Section
    const goalsSection = container.createDiv('novalist-statistics-section');
    goalsSection.createEl('h4', { text: 'Writing goals', cls: 'novalist-statistics-section-title' });
    
    // Daily Goal
    const dailyGoalEl = goalsSection.createDiv('novalist-goal-card');
    dailyGoalEl.createEl('div', { text: 'Daily goal', cls: 'novalist-goal-label' });
    const dailyProgressEl = dailyGoalEl.createDiv('novalist-goal-progress');
    dailyProgressEl.createEl('div', { 
      text: `${formatWordCount(dailyProgress.current)} / ${formatWordCount(dailyProgress.target)} words`,
      cls: 'novalist-goal-numbers'
    });
    const dailyBar = dailyProgressEl.createDiv('novalist-progress-bar');
    const dailyFill = dailyBar.createDiv('novalist-progress-fill');
    dailyFill.style.width = `${dailyProgress.percentage}%`;
    if (dailyProgress.percentage >= 100) {
      dailyFill.addClass('novalist-progress-complete');
    }
    
    // Project Goal
    const projectGoalEl = goalsSection.createDiv('novalist-goal-card');
    projectGoalEl.createEl('div', { text: 'Project goal', cls: 'novalist-goal-label' });
    const projectProgressEl = projectGoalEl.createDiv('novalist-goal-progress');
    projectProgressEl.createEl('div', { 
      text: `${formatWordCount(projectProgress.current)} / ${formatWordCount(projectProgress.target)} words`,
      cls: 'novalist-goal-numbers'
    });
    const projectBar = projectProgressEl.createDiv('novalist-progress-bar');
    const projectFill = projectBar.createDiv('novalist-progress-fill');
    projectFill.style.width = `${projectProgress.percentage}%`;
    if (projectProgress.percentage >= 100) {
      projectFill.addClass('novalist-progress-complete');
    }

    // Goal Settings
    const goalSettings = goalsSection.createDiv('novalist-goal-settings');
    
    const dailyInput = new TextComponent(goalSettings)
      .setPlaceholder('Daily word goal')
      .setValue(String(goals.dailyGoal));
    dailyInput.inputEl.addClass('novalist-goal-input');
    dailyInput.onChange(async (value) => {
      const num = parseInt(value, 10);
      if (!isNaN(num) && num > 0) {
        goals.dailyGoal = num;
        await this.plugin.saveSettings();
        void this.render();
      }
    });
    
    const projectInput = new TextComponent(goalSettings)
      .setPlaceholder('Project word goal')
      .setValue(String(goals.projectGoal));
    projectInput.inputEl.addClass('novalist-goal-input');
    projectInput.onChange(async (value) => {
      const num = parseInt(value, 10);
      if (!isNaN(num) && num > 0) {
        goals.projectGoal = num;
        await this.plugin.saveSettings();
        void this.render();
      }
    });

    // Overview Stats
    const overviewSection = container.createDiv('novalist-statistics-section');
    overviewSection.createEl('h4', { text: 'Overview', cls: 'novalist-statistics-section-title' });
    
    const statsGrid = overviewSection.createDiv('novalist-stats-grid');
    
    this.createStatCard(statsGrid, 'Total words', formatWordCount(stats.totalWords), 'pen-tool');
    this.createStatCard(statsGrid, 'Chapters', String(stats.totalChapters), 'book-open');
    this.createStatCard(statsGrid, 'Characters', String(stats.totalCharacters), 'users');
    this.createStatCard(statsGrid, 'Locations', String(stats.totalLocations), 'map-pin');
    this.createStatCard(statsGrid, 'Reading time', formatReadingTime(stats.estimatedReadingTime), 'clock');
    this.createStatCard(statsGrid, 'Avg chapter', formatWordCount(stats.averageChapterLength), 'align-left');

    // Readability Section
    const readabilitySection = container.createDiv('novalist-statistics-section');
    readabilitySection.createEl('h4', { text: 'Readability', cls: 'novalist-statistics-section-title' });
    
    if (stats.chapterStats.length === 0) {
      readabilitySection.createEl('p', { text: 'No chapters found.', cls: 'novalist-empty' });
    } else {
      const readabilityList = readabilitySection.createDiv('novalist-readability-list');
      
      // Sort by order (filename) for consistency
      const sortedChapters = [...stats.chapterStats].sort((a, b) => a.name.localeCompare(b.name));
      
      // Show method used
      const firstWithReadability = sortedChapters.find(c => c.readability);
      if (firstWithReadability?.readability) {
        readabilityList.createEl('div', { 
          text: `Using: ${firstWithReadability.readability.method}`,
          cls: 'novalist-readability-method'
        });
      }
      
      for (const chapter of sortedChapters) {
        const row = readabilityList.createDiv('novalist-readability-row');
        
        // Chapter name
        row.createEl('span', { 
          text: chapter.name, 
          cls: 'novalist-readability-name' 
        });
        
        // Readability display
        if (chapter.readability) {
          const readabilityEl = row.createDiv('novalist-readability-score');
          
          // Score badge
          const badge = readabilityEl.createEl('span', {
            text: formatReadabilityScore(chapter.readability),
            cls: 'novalist-readability-badge'
          });
          badge.style.backgroundColor = getReadabilityColor(chapter.readability.level);
          
          // Level label
          readabilityEl.createEl('span', {
            text: this.getLevelLabel(chapter.readability.level),
            cls: 'novalist-readability-level'
          });
          
          // Tooltip with details
          row.setAttribute('aria-label', 
            `${chapter.readability.description}\n` +
            `${chapter.readability.wordsPerSentence} words/sentence, ` +
            `${chapter.readability.charsPerWord} chars/word, ` +
            `${chapter.readability.sentenceCount} sentences`
          );
        } else {
          row.createEl('span', {
            text: '–',
            cls: 'novalist-readability-na'
          });
        }
        
        // Click to open chapter
        row.addEventListener('click', () => {
          const leaf = this.app.workspace.getLeaf(false);
          void leaf.openFile(chapter.file);
        });
      }
    }

    // Chapter Breakdown
    const chapterSection = container.createDiv('novalist-statistics-section');
    chapterSection.createEl('h4', { text: 'Chapter breakdown', cls: 'novalist-statistics-section-title' });
    
    if (stats.chapterStats.length === 0) {
      chapterSection.createEl('p', { text: 'No chapters found.', cls: 'novalist-empty' });
    } else {
      const chapterList = chapterSection.createDiv('novalist-chapter-stats-list');
      
      // Sort by order (filename) instead of word count for the list
      const sortedChapters = [...stats.chapterStats].sort((a, b) => a.name.localeCompare(b.name));
      
      for (const chapter of sortedChapters) {
        const row = chapterList.createDiv('novalist-chapter-stats-row');
        
        row.createEl('span', { 
          text: chapter.name, 
          cls: 'novalist-chapter-stats-name' 
        });
        
        row.createEl('span', { 
          text: `${formatWordCount(chapter.wordCount)} words`,
          cls: 'novalist-chapter-stats-count'
        });
        
        // Visual bar
        const maxWords = stats.longestChapter?.wordCount || 1;
        const percentage = (chapter.wordCount / maxWords) * 100;
        const barContainer = row.createDiv('novalist-chapter-stats-bar-container');
        const bar = barContainer.createDiv('novalist-chapter-stats-bar');
        bar.style.width = `${percentage}%`;
        
        // Click to open chapter
        row.addEventListener('click', () => {
          const leaf = this.app.workspace.getLeaf(false);
          void leaf.openFile(chapter.file);
        });
      }
    }

    // Extremes
    if (stats.longestChapter && stats.shortestChapter && stats.totalChapters > 1) {
      const extremesSection = container.createDiv('novalist-statistics-section');
      extremesSection.createEl('h4', { text: 'Chapter extremes', cls: 'novalist-statistics-section-title' });
      
      const extremesGrid = extremesSection.createDiv('novalist-extremes-grid');
      
      const longestEl = extremesGrid.createDiv('novalist-extreme-card');
      longestEl.createEl('div', { text: 'Longest', cls: 'novalist-extreme-label' });
      longestEl.createEl('div', { text: stats.longestChapter.name, cls: 'novalist-extreme-name' });
      longestEl.createEl('div', { 
        text: `${formatWordCount(stats.longestChapter.wordCount)} words`,
        cls: 'novalist-extreme-value'
      });
      longestEl.addEventListener('click', () => {
        const leaf = this.app.workspace.getLeaf(false);
        void leaf.openFile(stats.longestChapter.file);
      });
      
      const shortestEl = extremesGrid.createDiv('novalist-extreme-card');
      shortestEl.createEl('div', { text: 'Shortest', cls: 'novalist-extreme-label' });
      shortestEl.createEl('div', { text: stats.shortestChapter.name, cls: 'novalist-extreme-name' });
      shortestEl.createEl('div', { 
        text: `${formatWordCount(stats.shortestChapter.wordCount)} words`,
        cls: 'novalist-extreme-value'
      });
      shortestEl.addEventListener('click', () => {
        const leaf = this.app.workspace.getLeaf(false);
        void leaf.openFile(stats.shortestChapter.file);
      });
    }
  }

  private createStatCard(container: HTMLElement, label: string, value: string, icon: string): void {
    const card = container.createDiv('novalist-stat-card');
    card.addClass(`novalist-stat-card-${label.toLowerCase().replace(/\s+/g, '-')}`);
    
    const iconEl = card.createDiv('novalist-stat-icon');
    iconEl.appendChild(this.createIconElement(icon));
    
    card.createEl('div', { text: value, cls: 'novalist-stat-value' });
    card.createEl('div', { text: label, cls: 'novalist-stat-label' });
  }

  private getLevelLabel(level: ReadabilityScore['level']): string {
    switch (level) {
      case 'very_easy': return 'Very Easy';
      case 'easy': return 'Easy';
      case 'moderate': return 'Moderate';
      case 'difficult': return 'Difficult';
      case 'very_difficult': return 'Very Difficult';
      default: return 'Unknown';
    }
  }

  private createIconElement(name: string): SVGSVGElement {
    // Simple SVG icons (Lucide-style)
    const icons: Record<string, string> = {
      'pen-tool': '<path d="m12 19 7-7 3 3-7 7-3-3z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="m2 2 7.586 7.586"/><circle cx="11" cy="11" r="2"/>',
      'book-open': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
      'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
      'map-pin': '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
      'clock': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
      'align-left': '<line x1="21" x2="3" y1="6" y2="6"/><line x1="15" x2="3" y1="12" y2="12"/><line x1="17" x2="3" y1="18" y2="18"/>',
      'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'
    };
    
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML = icons[name] || '';
    return svg;
  }
}
