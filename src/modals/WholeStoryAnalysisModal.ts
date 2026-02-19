import { App, Modal, Notice, TFile } from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';
import type { AiFinding, AiFindingType } from '../utils/ollamaService';
import type { WholeStoryAnalysisResult, CachedAiFinding } from '../types';

type FilterTab = 'all' | 'inconsistency' | 'suggestion';

/**
 * Modal that performs (and displays) a whole-story cross-chapter AI analysis.
 *
 * Unlike FullStoryAnalysisModal (which analyses scene-by-scene), this modal
 * sends ALL chapter texts in a single LLM call together with the full detect
 * data cache, asking the model to verify and augment all findings across the
 * complete narrative.
 *
 * Results are persisted in ProjectData so re-opening the modal restores the
 * last result without re-running the analysis.
 */
export class WholeStoryAnalysisModal extends Modal {
  private plugin: NovalistPlugin;
  private findings: AiFinding[] = [];
  private activeTab: FilterTab = 'all';
  private bodyEl!: HTMLElement;
  private logEl!: HTMLElement;
  private logDetailEl!: HTMLElement;
  private isRunning = false;
  private isCancelled = false;

  /** Live-streamed content for the current analysis. */
  private liveThinking = '';
  private liveResponse = '';
  private liveThinkingEl: HTMLElement | null = null;
  private liveResponseEl: HTMLElement | null = null;
  private lastRunLabel!: HTMLElement;

  constructor(app: App, plugin: NovalistPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass('novalist-full-story-modal');
    contentEl.addClass('novalist-ai-analysis-modal');

    contentEl.createEl('h2', { text: t('ollama.wholeStoryTitle') });

    // Description
    contentEl.createEl('p', {
      text: t('ollama.wholeStoryDesc'),
      cls: 'novalist-whole-story-desc',
    });

    // Header row: last-run label + run button
    const headerRow = contentEl.createDiv('novalist-whole-story-header');
    this.lastRunLabel = headerRow.createEl('span', { cls: 'novalist-whole-story-last-run' });

    const runBtn = headerRow.createEl('button', {
      cls: 'mod-cta novalist-ai-action-btn',
    });

    const stored = this.plugin.getWholeStoryAnalysisResult();
    this.updateLastRunLabel(stored);
    runBtn.textContent = stored ? t('ollama.wholeStoryRerun') : t('ollama.wholeStoryRun');

    runBtn.addEventListener('click', () => {
      if (this.isRunning) return;
      runBtn.disabled = true;
      void this.runAnalysis().then(() => {
        runBtn.disabled = false;
        runBtn.textContent = t('ollama.wholeStoryRerun');
        this.updateLastRunLabel(this.plugin.getWholeStoryAnalysisResult());
      });
    });

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

    // Log panel (collapsed by default)
    this.logEl = contentEl.createEl('details', { cls: 'novalist-fullscan-log' });
    const logSummary = this.logEl.createEl('summary', { cls: 'novalist-fullscan-log-summary' });
    logSummary.textContent = t('ollama.logTitle');
    const logBody = this.logEl.createDiv('novalist-fullscan-log-body');
    this.logDetailEl = logBody.createDiv('novalist-fullscan-log-detail');

    // Display stored result immediately if available
    if (stored) {
      this.findings = stored.findings.map(f => f as AiFinding);
      this.renderFindings();
      this.renderStoredLog(stored);
    } else {
      this.bodyEl.createEl('p', {
        text: t('ollama.wholeStoryNeverRun'),
        cls: 'novalist-ai-empty',
      });
    }
  }

  onClose(): void {
    this.isCancelled = true;
    if (this.plugin.ollamaService) {
      this.plugin.ollamaService.cancel();
    }
    this.contentEl.empty();
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private updateLastRunLabel(stored: WholeStoryAnalysisResult | undefined): void {
    if (stored) {
      const d = new Date(stored.timestamp);
      const formatted = d.toLocaleString();
      this.lastRunLabel.textContent = t('ollama.wholeStoryLastRun', { date: formatted });
    } else {
      this.lastRunLabel.textContent = '';
    }
  }

  // ── Analysis ─────────────────────────────────────────────────────

  private async runAnalysis(): Promise<void> {
    if (!this.plugin.ollamaService) {
      new Notice(t('ollama.notConfigured'));
      return;
    }

    this.isRunning = true;
    this.isCancelled = false;

    // Show progress spinner
    this.bodyEl.empty();
    const loadingWrap = this.bodyEl.createDiv('novalist-ai-loading');
    loadingWrap.createEl('div', { cls: 'novalist-ai-spinner' });
    const progressLabel = loadingWrap.createEl('p', { text: t('ollama.wholeStoryAnalysing') });

    const cancelBtn = loadingWrap.createEl('button', {
      text: t('ollama.cancel'),
      cls: 'novalist-ai-action-btn',
    });
    cancelBtn.addEventListener('click', () => {
      this.isCancelled = true;
      if (this.plugin.ollamaService) this.plugin.ollamaService.cancel();
      this.isRunning = false;
      progressLabel.textContent = t('ollama.cancel') + '…';
    });

    // Open log panel and show live streaming
    this.logEl.setAttribute('open', '');
    this.logDetailEl.empty();
    this.liveThinking = '';
    this.liveResponse = '';
    this.showLiveLog();

    try {
      // Auto-load model if needed (Ollama only)
      if (this.plugin.settings.ollama.provider === 'ollama' && this.plugin.settings.ollama.autoManageModel) {
        const loaded = await this.plugin.ollamaService.isModelLoaded();
        if (!loaded) {
          await this.plugin.ollamaService.loadModel();
        }
      }

      // Gather all chapter texts
      type ChapterDesc = { file: TFile; name: string };
      const chapterDescs = this.plugin.getChapterDescriptionsSync() as ChapterDesc[];
      if (chapterDescs.length === 0) {
        this.bodyEl.empty();
        this.bodyEl.createEl('p', { text: t('ollama.noChapters'), cls: 'novalist-ai-empty' });
        this.isRunning = false;
        return;
      }

      const chapters: Array<{ name: string; text: string }> = [];
      for (const ch of chapterDescs) {
        const raw = await this.app.vault.read(ch.file);
        const body = this.plugin.stripFrontmatter(raw);
        chapters.push({ name: ch.name, text: body });
      }

      // Collect all entity summaries (without chapter context for global view)
      const entities = await this.plugin.collectEntitySummaries();

      // Collect all cached AI findings from the detect cache
      const cachedFindings = this.plugin.getAllCachedAiFindings();

      if (this.isCancelled) {
        this.isRunning = false;
        return;
      }

      const result = await this.plugin.ollamaService.analyseWholeStory(
        chapters,
        entities,
        cachedFindings,
        (token) => {
          this.liveResponse += token;
          if (this.liveResponseEl) {
            this.liveResponseEl.textContent = this.liveResponse;
            this.autoScroll(this.liveResponseEl);
          }
        },
        (token) => {
          this.liveThinking += token;
          if (this.liveThinkingEl) {
            this.liveThinkingEl.textContent = this.liveThinking;
            this.autoScroll(this.liveThinkingEl);
          }
        },
      );

      this.isRunning = false;

      if (this.isCancelled) return;

      // Persist result
      const stored: WholeStoryAnalysisResult = {
        timestamp: new Date().toISOString(),
        findings: result.findings as CachedAiFinding[],
        thinking: this.liveThinking || result.thinking,
        rawResponse: this.liveResponse || result.rawResponse,
      };
      await this.plugin.saveWholeStoryAnalysisResult(stored);

      this.findings = result.findings;
      new Notice(t('ollama.analysisDone'));
      this.renderFindings();
      this.renderStoredLog(stored);
    } catch (err) {
      this.isRunning = false;
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(t('ollama.analysisError', { error: msg }));
      this.bodyEl.empty();
      this.bodyEl.createEl('p', {
        text: t('ollama.analysisError', { error: msg }),
        cls: 'novalist-ai-error',
      });
    }
  }

  // ── Live log ─────────────────────────────────────────────────────

  private showLiveLog(): void {
    this.logDetailEl.empty();

    // Thinking block
    const thinkDetails = this.logDetailEl.createEl('details', { cls: 'novalist-fullscan-log-thinking' });
    thinkDetails.setAttribute('open', '');
    const thinkSummary = thinkDetails.createEl('summary');
    thinkSummary.createSpan({ text: t('ollama.logThinking') });
    this.liveThinkingEl = thinkDetails.createDiv('novalist-fullscan-log-pre');

    // Raw response block
    const respDetails = this.logDetailEl.createEl('details', { cls: 'novalist-fullscan-log-response' });
    respDetails.setAttribute('open', '');
    respDetails.createEl('summary', { text: t('ollama.logResponse') });
    this.liveResponseEl = respDetails.createDiv('novalist-fullscan-log-pre');
  }

  /** Render the stored log (thinking + raw response) after analysis, with Copy All button. */
  private renderStoredLog(stored: WholeStoryAnalysisResult): void {
    this.liveThinkingEl = null;
    this.liveResponseEl = null;
    this.logDetailEl.empty();

    if (stored.thinking) {
      const thinkDetails = this.logDetailEl.createEl('details', { cls: 'novalist-fullscan-log-thinking' });
      const thinkSummary = thinkDetails.createEl('summary');
      thinkSummary.createSpan({ text: t('ollama.logThinking') });
      // Copy All button
      const copyBtn = thinkSummary.createEl('button', {
        text: t('ollama.copyThinking'),
        cls: 'novalist-copy-thinking-btn',
      });
      const thinkingText = stored.thinking;
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        void window.navigator.clipboard.writeText(thinkingText);
      });
      thinkDetails.createDiv({ cls: 'novalist-fullscan-log-pre', text: stored.thinking });
    }

    if (stored.rawResponse) {
      const respDetails = this.logDetailEl.createEl('details', { cls: 'novalist-fullscan-log-response' });
      respDetails.createEl('summary', { text: t('ollama.logResponse') });
      respDetails.createDiv({ cls: 'novalist-fullscan-log-pre', text: stored.rawResponse });
    }
  }

  private autoScroll(el: HTMLElement): void {
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }

  // ── Findings rendering ────────────────────────────────────────────

  private renderFindings(): void {
    this.bodyEl.empty();

    const filtered: AiFinding[] = this.activeTab === 'all'
      ? this.findings
      : this.findings.filter(f => f.type === this.activeTab);

    if (this.findings.length === 0) {
      this.bodyEl.createEl('p', { text: t('ollama.noFindings'), cls: 'novalist-ai-empty' });
      return;
    }

    // Summary row
    const summary = this.bodyEl.createDiv('novalist-full-story-summary');
    const inconCount = this.findings.filter(f => f.type === 'inconsistency').length;
    const sugCount = this.findings.filter(f => f.type === 'suggestion').length;
    summary.createEl('span', {
      text: `${this.findings.length} finding(s) · ${inconCount} inconsistenc${inconCount === 1 ? 'y' : 'ies'} · ${sugCount} suggestion${sugCount === 1 ? '' : 's'}`,
      cls: 'novalist-full-story-summary-text',
    });

    if (filtered.length === 0) {
      this.bodyEl.createEl('p', { text: t('ollama.noFindings'), cls: 'novalist-ai-empty' });
      return;
    }

    const list = this.bodyEl.createDiv('novalist-ai-findings');
    for (const finding of filtered) {
      this.renderFinding(list, finding);
    }
  }

  private renderFinding(container: HTMLElement, finding: AiFinding): void {
    const card = container.createDiv('novalist-ai-finding');
    card.addClass(`novalist-ai-finding--${finding.type}`);

    const badge = card.createEl('span', {
      text: this.getBadgeLabel(finding.type),
      cls: 'novalist-ai-badge',
    });
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
        entityInfo.createEl('span', {
          text: ` (${finding.entityType})`,
          cls: 'novalist-ai-entity-type',
        });
      }
    }

    const actions = card.createDiv('novalist-ai-actions');

    if (finding.type === 'suggestion') {
      const createBtn = actions.createEl('button', {
        text: t('ollama.createEntity'),
        cls: 'mod-cta novalist-ai-action-btn',
      });
      createBtn.addEventListener('click', () => {
        this.createEntityFromSuggestion(finding);
        card.addClass('is-dismissed');
      });
    }

    const dismissBtn = actions.createEl('button', {
      text: t('ollama.dismiss'),
      cls: 'novalist-ai-action-btn',
    });
    dismissBtn.addEventListener('click', () => {
      this.findings = this.findings.filter(f => f !== finding);
      this.renderFindings();
    });
  }

  private createEntityFromSuggestion(finding: AiFinding): void {
    const name = finding.entityName || undefined;
    const desc = finding.description || undefined;
    const entityType = finding.entityType || 'character';
    switch (entityType) {
      case 'character':
        this.plugin.openCharacterModal(name);
        break;
      case 'location':
        this.plugin.openLocationModal(name, desc);
        break;
      case 'item':
        this.plugin.openItemModal(name, desc);
        break;
      case 'lore':
        this.plugin.openLoreModal(name, desc);
        break;
      default:
        this.plugin.openCharacterModal(name);
        break;
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
