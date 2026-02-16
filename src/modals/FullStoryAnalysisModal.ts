import { App, Modal, Notice, TFile } from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';
import { OllamaService } from '../utils/ollamaService';
import type { AiFinding, AiFindingType, EntitySummary, EnabledChecks } from '../utils/ollamaService';

type FilterTab = 'all' | 'inconsistency' | 'suggestion';

interface ChapterResult {
  chapterName: string;
  file: TFile;
  findings: AiFinding[];
}

export class FullStoryAnalysisModal extends Modal {
  private plugin: NovalistPlugin;
  private findings: ChapterResult[] = [];
  private activeTab: FilterTab = 'all';
  private bodyEl!: HTMLElement;
  private isRunning = false;
  private isCancelled = false;
  private startTime = 0;

  constructor(app: App, plugin: NovalistPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass('novalist-ai-analysis-modal');
    contentEl.addClass('novalist-full-story-modal');

    contentEl.createEl('h2', { text: t('ollama.fullStoryTitle') });

    // Tab bar
    const tabBar = contentEl.createDiv('novalist-ai-tabs');
    const tabs: { key: FilterTab; label: string }[] = [
      { key: 'all', label: t('ollama.tabAll') },
      { key: 'inconsistency', label: t('ollama.tabInconsistencies') },
      { key: 'suggestion', label: t('ollama.tabSuggestions') },
    ];
    for (const tab of tabs) {
      const btn = tabBar.createEl('button', {
        text: tab.label,
        cls: `novalist-ai-tab${tab.key === this.activeTab ? ' is-active' : ''}`,
        attr: { 'data-tab': tab.key },
      });
      btn.addEventListener('click', () => {
        this.activeTab = tab.key;
        tabBar.querySelectorAll('.novalist-ai-tab').forEach(el => el.removeClass('is-active'));
        btn.addClass('is-active');
        this.renderFindings();
      });
    }

    this.bodyEl = contentEl.createDiv('novalist-ai-body');

    await this.runAnalysis();
  }

  onClose(): void {
    this.isCancelled = true;
    if (this.plugin.ollamaService) {
      this.plugin.ollamaService.cancel();
    }
    this.contentEl.empty();
  }

  private async runAnalysis(): Promise<void> {
    if (!this.plugin.ollamaService) {
      new Notice(t('ollama.notConfigured'));
      this.close();
      return;
    }

    this.isRunning = true;
    this.isCancelled = false;
    this.startTime = Date.now();

    // Get all chapters
    const chapters = this.plugin.getChapterDescriptionsSync();
    if (chapters.length === 0) {
      this.bodyEl.createEl('p', { text: t('ollama.noChapters'), cls: 'novalist-ai-empty' });
      return;
    }

    // Count total paragraphs across all chapters for progress
    const isChapterMode = this.plugin.settings.ollama.analysisMode === 'chapter';
    const chapterTexts: { file: TFile; name: string; body: string; paragraphs: string[] }[] = [];
    let totalParagraphs = 0;
    for (const ch of chapters) {
      const raw = await this.app.vault.read(ch.file);
      const body = this.plugin.stripFrontmatter(raw);
      const paragraphs = isChapterMode ? [] : OllamaService.splitParagraphs(body);
      chapterTexts.push({ file: ch.file, name: ch.name, body, paragraphs });
      totalParagraphs += isChapterMode ? 1 : paragraphs.length;
    }

    this.renderProgress(0, totalParagraphs, chapterTexts[0].name, 0);

    try {
      // Auto-load model if configured (Ollama only)
      if (this.plugin.settings.ollama.provider === 'ollama' && this.plugin.settings.ollama.autoManageModel) {
        const loaded = await this.plugin.ollamaService.isModelLoaded();
        if (!loaded) {
          await this.plugin.ollamaService.loadModel();
        }
      }

      const checks: EnabledChecks = {
        references: false,
        inconsistencies: this.plugin.settings.ollama.checkInconsistencies,
        suggestions: this.plugin.settings.ollama.checkSuggestions,
      };

      let doneSoFar = 0;

      for (const ch of chapterTexts) {
        if (this.isCancelled) break;

        const chapterName = this.plugin.getChapterNameForFileSync(ch.file);
        const actName = this.plugin.getActForFileSync(ch.file) || undefined;

        const entities: EntitySummary[] = await this.plugin.collectEntitySummaries(chapterName, undefined, actName);

        const mentions = this.plugin.scanMentions(ch.body);
        const alreadyFound = [
          ...mentions.characters,
          ...mentions.locations,
          ...mentions.items,
          ...mentions.lore,
        ];

        const result = await this.plugin.ollamaService.analyseChapter(
          ch.body, entities, alreadyFound,
          { chapterName, actName },
          checks,
          (done, _total) => {
            const globalDone = doneSoFar + done;
            this.renderProgress(globalDone, totalParagraphs, ch.name, this.computeEta(globalDone, totalParagraphs));
          },
        );

        doneSoFar += isChapterMode ? 1 : ch.paragraphs.length;

        if (result.findings.length > 0) {
          this.findings.push({
            chapterName: ch.name,
            file: ch.file,
            findings: result.findings,
          });
        }
      }

      this.isRunning = false;
      if (!this.isCancelled) {
        new Notice(t('ollama.analysisDone'));
        this.renderFindings();
      }
    } catch (err) {
      this.isRunning = false;
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(t('ollama.analysisError', { error: msg }));
      this.bodyEl.empty();
      this.bodyEl.createEl('p', { text: t('ollama.analysisError', { error: msg }), cls: 'novalist-ai-error' });
    }
  }

  private computeEta(done: number, total: number): number {
    if (done === 0) return 0;
    const elapsed = Date.now() - this.startTime;
    const avgPerItem = elapsed / done;
    return Math.round((avgPerItem * (total - done)) / 1000);
  }

  private renderProgress(done: number, total: number, currentChapter: string, etaSeconds: number): void {
    this.bodyEl.empty();
    const wrap = this.bodyEl.createDiv('novalist-ai-loading');
    wrap.createEl('div', { cls: 'novalist-ai-spinner' });
    wrap.createEl('p', { text: t('ollama.analysingChapter', { chapter: currentChapter }) });

    // Progress bar
    const progressWrap = wrap.createDiv('novalist-ai-progress');
    const fill = progressWrap.createDiv('novalist-ai-progress-fill');
    fill.style.width = `${total > 0 ? Math.round((done / total) * 100) : 0}%`;

    // Stats line
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const etaStr = etaSeconds > 0 ? this.formatEta(etaSeconds) : '…';
    wrap.createEl('p', {
      text: `${done} / ${total} (${pct}%)  —  ${t('ollama.eta')}: ${etaStr}`,
      cls: 'novalist-ai-progress-label',
    });

    // Cancel button
    const cancelBtn = wrap.createEl('button', { text: t('ollama.cancel'), cls: 'novalist-ai-action-btn' });
    cancelBtn.addEventListener('click', () => {
      this.isCancelled = true;
      if (this.plugin.ollamaService) this.plugin.ollamaService.cancel();
      this.isRunning = false;
      this.renderFindings();
    });
  }

  private formatEta(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }

  private renderFindings(): void {
    this.bodyEl.empty();

    const allFindings = this.findings.flatMap(cr => cr.findings);
    const filtered = this.activeTab === 'all'
      ? this.findings
      : this.findings.map(cr => ({
          ...cr,
          findings: cr.findings.filter(f => f.type === this.activeTab),
        })).filter(cr => cr.findings.length > 0);

    if (allFindings.length === 0) {
      this.bodyEl.createEl('p', { text: t('ollama.noFindings'), cls: 'novalist-ai-empty' });
      return;
    }

    // Summary counts
    const summary = this.bodyEl.createDiv('novalist-full-story-summary');
    const inconCount = allFindings.filter(f => f.type === 'inconsistency').length;
    const sugCount = allFindings.filter(f => f.type === 'suggestion').length;
    summary.createEl('span', {
      text: `${this.findings.length} ${this.findings.length === 1 ? 'chapter' : 'chapters'} · ${inconCount} issue · ${sugCount} sug`,
      cls: 'novalist-full-story-summary-text',
    });

    // Grouped by chapter
    for (const cr of filtered) {
      const group = this.bodyEl.createDiv('novalist-full-story-chapter-group');
      group.createEl('h3', { text: cr.chapterName, cls: 'novalist-full-story-chapter-heading' });

      const list = group.createDiv('novalist-ai-findings');
      for (const finding of cr.findings) {
        this.renderFinding(list, finding);
      }
    }
  }

  private renderFinding(container: HTMLElement, finding: AiFinding): void {
    const card = container.createDiv('novalist-ai-finding');
    card.addClass(`novalist-ai-finding--${finding.type}`);

    const badgeText = this.getBadgeLabel(finding.type);
    const badge = card.createEl('span', { text: badgeText, cls: 'novalist-ai-badge' });
    badge.addClass(`novalist-ai-badge--${finding.type}`);

    card.createEl('strong', { text: finding.title, cls: 'novalist-ai-finding-title' });
    card.createEl('p', { text: finding.description, cls: 'novalist-ai-finding-desc' });

    if (finding.excerpt) {
      card.createEl('blockquote', { text: finding.excerpt, cls: 'novalist-ai-excerpt' });
    }

    if (finding.entityName) {
      const entityInfo = card.createDiv('novalist-ai-entity-info');
      entityInfo.createEl('span', { text: finding.entityName, cls: 'novalist-ai-entity-name' });
      if (finding.entityType) {
        entityInfo.createEl('span', { text: ` (${finding.entityType})`, cls: 'novalist-ai-entity-type' });
      }
    }
  }

  private getBadgeLabel(type: AiFindingType): string {
    switch (type) {
      case 'reference': return t('ollama.findingReference');
      case 'inconsistency': return t('ollama.findingInconsistency');
      case 'suggestion': return t('ollama.findingSuggestion');
    }
  }
}
