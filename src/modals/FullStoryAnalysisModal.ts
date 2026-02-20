import { App, Modal, Notice, TFile } from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';
import type { MentionResult } from '../types';
import type { AiFinding, AiFindingType, EntitySummary, EnabledChecks } from '../utils/ollamaService';

type FilterTab = 'all' | 'inconsistency' | 'suggestion';

interface ChapterResult {
  chapterName: string;
  file: TFile;
  findings: AiFinding[];
}

/** Log entry for a single scene (or chapter if no scenes) analysed by the LLM. */
interface SceneLog {
  chapterName: string;
  sceneName: string; // '' when the chapter has no scenes
  thinking: string;
  rawResponse: string;
  findings: AiFinding[];
}

export class FullStoryAnalysisModal extends Modal {
  private plugin: NovalistPlugin;
  private findings: ChapterResult[] = [];
  private sceneLogs: SceneLog[] = [];
  private activeTab: FilterTab = 'all';
  private bodyEl!: HTMLElement;
  private logEl!: HTMLElement;
  private logSelectorRow!: HTMLElement;
  private logDetailEl!: HTMLElement;
  private logChapterSelect!: HTMLSelectElement;
  private logSceneSelect!: HTMLSelectElement;
  private isRunning = false;
  private isCancelled = false;
  private startTime = 0;
  /** When true the log panel follows the live scene instead of user selection. */
  private logFollowLive = true;

  /** Live-streamed content for the scene currently being analysed. */
  private liveThinking = '';
  private liveResponse = '';
  private liveThinkingEl: HTMLElement | null = null;
  private liveResponseEl: HTMLElement | null = null;
  /** Track which chapter/scene is currently being analysed (for live view). */
  private liveChapterName = '';
  private liveSceneName = '';

  private chapterFile?: TFile;

  constructor(app: App, plugin: NovalistPlugin, chapterFile?: TFile) {
    super(app);
    this.plugin = plugin;
    this.chapterFile = chapterFile;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    this.modalEl.addClass('novalist-full-story-modal');
    contentEl.addClass('novalist-ai-analysis-modal');

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

    // Log panel — collapsed by default, expanded during & after analysis
    this.logEl = contentEl.createEl('details', { cls: 'novalist-fullscan-log' });
    const logSummary = this.logEl.createEl('summary', { cls: 'novalist-fullscan-log-summary' });
    logSummary.textContent = t('ollama.logTitle');

    const logBody = this.logEl.createDiv('novalist-fullscan-log-body');

    // Selector row (chapter + scene dropdowns) — always present
    this.logSelectorRow = logBody.createDiv('novalist-fullscan-log-selectors');
    this.logChapterSelect = this.logSelectorRow.createEl('select', { cls: 'dropdown novalist-fullscan-log-select' });
    this.logSceneSelect = this.logSelectorRow.createEl('select', { cls: 'dropdown novalist-fullscan-log-select' });
    this.logSelectorRow.addClass('novalist-hidden');

    this.logChapterSelect.addEventListener('change', () => {
      this.logFollowLive = false;
      this.populateSceneSelect();
      this.renderSelectedLog();
    });
    this.logSceneSelect.addEventListener('change', () => {
      this.logFollowLive = false;
      this.renderSelectedLog();
    });

    // Detail area below selectors
    this.logDetailEl = logBody.createDiv('novalist-fullscan-log-detail');

    await this.runAnalysis();
  }

  onClose(): void {
    this.isCancelled = true;
    if (this.plugin.ollamaService) {
      this.plugin.ollamaService.cancel();
    }
    this.contentEl.empty();
  }

  // ── Analysis ────────────────────────────────────────────────────

  private async runAnalysis(): Promise<void> {
    if (!this.plugin.ollamaService) {
      new Notice(t('ollama.notConfigured'));
      this.close();
      return;
    }

    this.isRunning = true;
    this.isCancelled = false;
    this.startTime = Date.now();

    // Get chapters: if chapterFile is set, only analyze that chapter
    type ChapterDesc = { file: TFile; name: string };
    let chapters: ChapterDesc[];
    if (this.chapterFile) {
      chapters = (this.plugin.getChapterDescriptionsSync() as ChapterDesc[]).filter((ch: ChapterDesc) => ch.file === this.chapterFile);
    } else {
      chapters = this.plugin.getChapterDescriptionsSync() as ChapterDesc[];
    }
    if (chapters.length === 0) {
      this.bodyEl.createEl('p', { text: t('ollama.noChapters'), cls: 'novalist-ai-empty' });
      return;
    }

    // Pre-read chapter bodies and discover scenes so we can count total units
    interface SceneUnit { name: string; text: string }
    interface ChapterUnit { file: TFile; name: string; body: string; scenes: SceneUnit[] }
    const chapterUnits: ChapterUnit[] = [];
    let totalUnits = 0;
    for (const ch of chapters) {
      const raw = await this.app.vault.read(ch.file);
      const body = this.plugin.stripFrontmatter(raw);
      const sceneNames = this.plugin.getScenesForChapter(ch.file);
      const scenes: SceneUnit[] = [];
      if (sceneNames.length > 0) {
        for (const sn of sceneNames) {
          scenes.push({ name: sn, text: this.extractSceneText(body, sn) });
        }
      } else {
        scenes.push({ name: '', text: body });
      }
      chapterUnits.push({ file: ch.file, name: ch.name, body, scenes });
      totalUnits += scenes.length;
    }

    // Open the log panel during analysis so the user can watch
    this.logEl.setAttribute('open', '');
    this.renderProgress(0, totalUnits, chapterUnits[0].name, 0);

    try {
      // Auto-load model if configured (Ollama only)
      if (this.plugin.settings.ollama.provider === 'ollama' && this.plugin.settings.ollama.autoManageModel) {
        const loaded = await this.plugin.ollamaService.isModelLoaded();
        if (!loaded) {
          await this.plugin.ollamaService.loadModel();
        }
      }

      const checks: EnabledChecks = {
        references: true,
        inconsistencies: true,
        suggestions: true,
      };

      let doneSoFar = 0;

      for (const ch of chapterUnits) {
        if (this.isCancelled) break;

        const chapterName = this.plugin.getChapterNameForFileSync(ch.file);
        const actName = this.plugin.getActForFileSync(ch.file) || undefined;

        const regexDisabled = this.plugin.settings.ollama.disableRegexReferences;
        const mentions = regexDisabled
          ? { characters: [] as string[], locations: [] as string[], items: [] as string[], lore: [] as string[] }
          : this.plugin.scanMentions(ch.body);
        const chapterAllFindings: AiFinding[] = [];

        const sceneResults: Record<string, MentionResult> = {};
        for (const scene of ch.scenes) {
          if (this.isCancelled) break;

          const sceneName = scene.name || undefined;
          const sceneDate = sceneName
            ? this.plugin.getSceneDateSync(ch.file, sceneName) || undefined
            : this.plugin.getChapterDateSync(ch.file) || undefined;
          const entities: EntitySummary[] = await this.plugin.collectEntitySummaries(chapterName, sceneName, actName);
          const sceneText = scene.text;

          const sceneMentions = regexDisabled
            ? { characters: [] as string[], locations: [] as string[], items: [] as string[], lore: [] as string[] }
            : this.plugin.scanMentions(sceneText);
          const alreadyFound = regexDisabled
            ? []
            : [
                ...sceneMentions.characters,
                ...sceneMentions.locations,
                ...sceneMentions.items,
                ...sceneMentions.lore,
              ];

          // Prepare live-streaming log for this scene
          this.liveThinking = '';
          this.liveResponse = '';
          this.showLiveLog(ch.name, scene.name);

          const result = await this.plugin.ollamaService.analyseChapterWhole(
            sceneText, entities, alreadyFound,
            { chapterName, actName, sceneName, date: sceneDate },
            checks,
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
            regexDisabled, // findAllReferences
          );

          // Store the log entry
          this.sceneLogs.push({
            chapterName: ch.name,
            sceneName: scene.name,
            thinking: this.liveThinking || result.thinking,
            rawResponse: this.liveResponse || result.rawResponse,
            findings: result.findings,
          });

          chapterAllFindings.push(...result.findings);
          doneSoFar++;
          this.renderProgress(doneSoFar, totalUnits, ch.name, this.computeEta(doneSoFar, totalUnits));

          // Build per-scene mention cache (regex + AI refs merged)
          if (scene.name) {
            const sceneMerged: MentionResult = {
              characters: [...sceneMentions.characters],
              locations: [...sceneMentions.locations],
              items: [...sceneMentions.items],
              lore: [...sceneMentions.lore],
            };
            for (const f of result.findings) {
              if (f.type !== 'reference' || !f.entityName) continue;
              const etype = f.entityType || 'character';
              const list = sceneMerged[etype === 'character' ? 'characters' : etype === 'location' ? 'locations' : etype === 'item' ? 'items' : 'lore'];
              if (!list.includes(f.entityName)) list.push(f.entityName);
            }
            sceneResults[scene.name] = sceneMerged;
          }
        }

        if (chapterAllFindings.length > 0) {
          this.findings.push({
            chapterName: ch.name,
            file: ch.file,
            findings: chapterAllFindings,
          });
        }

        // Persist chapter-level merged mention data into the cache
        const merged: MentionResult = {
          characters: [...mentions.characters],
          locations: [...mentions.locations],
          items: [...mentions.items],
          lore: [...mentions.lore],
        };
        for (const f of chapterAllFindings) {
          if (f.type !== 'reference' || !f.entityName) continue;
          const etype = f.entityType || 'character';
          const list = merged[etype === 'character' ? 'characters' : etype === 'location' ? 'locations' : etype === 'item' ? 'items' : 'lore'];
          if (!list.includes(f.entityName)) list.push(f.entityName);
        }

        await this.plugin.storeMentionCache(ch.file, merged, sceneResults, chapterAllFindings);
      }

      this.isRunning = false;
      if (!this.isCancelled) {
        new Notice(t('ollama.analysisDone'));
        this.renderFindings();
        this.renderLogPanel();
      }
    } catch (err) {
      this.isRunning = false;
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(t('ollama.analysisError', { error: msg }));
      this.bodyEl.empty();
      this.bodyEl.createEl('p', { text: t('ollama.analysisError', { error: msg }), cls: 'novalist-ai-error' });
      // Still show whatever logs we gathered
      if (this.sceneLogs.length > 0) this.renderLogPanel();
    }
  }

  // ── Progress ────────────────────────────────────────────────────

  private computeEta(done: number, total: number): number {
    if (done === 0) return 0;
    const elapsed = Date.now() - this.startTime;
    const avgPerItem = elapsed / done;
    return Math.round((avgPerItem * (total - done)) / 1000);
  }

  private extractSceneText(body: string, sceneName: string): string {
    const lines = body.split('\n');
    let capturing = false;
    const result: string[] = [];
    for (const line of lines) {
      if (capturing) {
        if (/^#{1,2}\s/.test(line)) break;
        result.push(line);
      } else if (/^##\s/.test(line)) {
        const heading = line.replace(/^##\s+/, '').trim();
        if (heading === sceneName) capturing = true;
      }
    }
    return result.join('\n');
  }

  private renderProgress(done: number, total: number, currentChapter: string, etaSeconds: number): void {
    this.bodyEl.empty();
    const wrap = this.bodyEl.createDiv('novalist-ai-loading');
    wrap.createEl('div', { cls: 'novalist-ai-spinner' });
    wrap.createEl('p', { text: t('ollama.analysingChapter', { chapter: currentChapter }) });

    const progressWrap = wrap.createDiv('novalist-ai-progress');
    const fill = progressWrap.createDiv('novalist-ai-progress-fill');
    fill.style.width = `${total > 0 ? Math.round((done / total) * 100) : 0}%`;

    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const etaStr = etaSeconds > 0 ? this.formatEta(etaSeconds) : '…';
    wrap.createEl('p', {
      text: `${done} / ${total} (${pct}%)  —  ${t('ollama.eta')}: ${etaStr}`,
      cls: 'novalist-ai-progress-label',
    });

    const cancelBtn = wrap.createEl('button', { text: t('ollama.cancel'), cls: 'novalist-ai-action-btn' });
    cancelBtn.addEventListener('click', () => {
      this.isCancelled = true;
      if (this.plugin.ollamaService) this.plugin.ollamaService.cancel();
      this.isRunning = false;
      this.renderFindings();
      if (this.sceneLogs.length > 0) this.renderLogPanel();
    });
  }

  private formatEta(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }

  // ── Live log (streamed during analysis) ─────────────────────────

  /** Replace the log detail area with a live-streaming view for the current scene. */
  private showLiveLog(chapterName: string, sceneName: string): void {
    // Track which chapter/scene is live so renderSelectedLog can show it
    this.liveChapterName = chapterName;
    this.liveSceneName = sceneName;

    // Update selector dropdowns to reflect available logs + current live scene
    this.updateLogSelectors(chapterName, sceneName);

    // Only overwrite the detail area if we're following live
    if (!this.logFollowLive) return;

    this.logDetailEl.empty();
    const label = sceneName ? `${chapterName} › ${sceneName}` : chapterName;
    this.logDetailEl.createEl('div', { text: label, cls: 'novalist-fullscan-log-label' });

    // Thinking block (collapsible, starts open for live view)
    const thinkDetails = this.logDetailEl.createEl('details', { cls: 'novalist-fullscan-log-thinking' });
    thinkDetails.setAttribute('open', '');
    const thinkSummary = thinkDetails.createEl('summary');
    thinkSummary.createSpan({ text: t('ollama.logThinking') });
    const liveCopyBtn = thinkSummary.createEl('button', {
      text: t('ollama.copyThinking'),
      cls: 'novalist-copy-thinking-btn',
    });
    liveCopyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      void window.navigator.clipboard.writeText(this.liveThinking);
    });
    this.liveThinkingEl = thinkDetails.createDiv('novalist-fullscan-log-pre');

    // Raw response block
    const respDetails = this.logDetailEl.createEl('details', { cls: 'novalist-fullscan-log-response' });
    respDetails.setAttribute('open', '');
    respDetails.createEl('summary', { text: t('ollama.logResponse') });
    this.liveResponseEl = respDetails.createDiv('novalist-fullscan-log-pre');
  }

  /** Update the chapter/scene dropdowns with all completed logs + the current live entry. */
  private updateLogSelectors(liveChapter: string, liveScene: string): void {
    // Show the selector row once we have at least one entry
    this.logSelectorRow.removeClass('novalist-hidden');

    // Collect chapter names from completed logs + live
    const chapterNames = [...new Set([...this.sceneLogs.map(l => l.chapterName), liveChapter])];

    // Rebuild chapter dropdown preserving selection
    const prevChapter = this.logChapterSelect.value;
    this.logChapterSelect.empty();
    for (const ch of chapterNames) {
      this.logChapterSelect.createEl('option', { text: ch, attr: { value: ch } });
    }

    if (this.logFollowLive) {
      this.logChapterSelect.value = liveChapter;
    } else if (chapterNames.includes(prevChapter)) {
      this.logChapterSelect.value = prevChapter;
    }

    // Rebuild scene dropdown
    this.populateSceneSelect(liveChapter, liveScene);
    if (this.logFollowLive) {
      const liveVal = liveScene;
      this.logSceneSelect.value = liveVal;
    }
  }

  /** Auto-scroll the thinking/response pre element to the bottom if the user hasn't scrolled up. */
  private autoScroll(el: HTMLElement): void {
    // The .novalist-fullscan-log-pre elements have max-height: 220px and
    // overflow-y: auto, so they scroll independently. Scroll the pre element
    // itself, not the outer log-body container.
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }

  // ── Log panel (after analysis) ──────────────────────────────────

  /** Finalise the log panel after analysis is complete. */
  private renderLogPanel(): void {
    this.liveThinkingEl = null;
    this.liveResponseEl = null;
    this.logFollowLive = false;

    if (this.sceneLogs.length === 0) {
      this.logDetailEl.empty();
      this.logDetailEl.createEl('p', { text: t('ollama.noFindings'), cls: 'novalist-ai-empty' });
      return;
    }

    // Rebuild selectors with final data (no live entry)
    this.logSelectorRow.removeClass('novalist-hidden');
    const chapterNames = [...new Set(this.sceneLogs.map(l => l.chapterName))];
    this.logChapterSelect.empty();
    for (const ch of chapterNames) {
      this.logChapterSelect.createEl('option', { text: ch, attr: { value: ch } });
    }

    this.populateSceneSelect();
    this.renderSelectedLog();
  }

  /** Populate the scene dropdown for the currently selected chapter. */
  private populateSceneSelect(liveChapter?: string, liveScene?: string): void {
    const chapter = this.logChapterSelect.value;
    const scenes = this.sceneLogs.filter(l => l.chapterName === chapter);
    const prevScene = this.logSceneSelect.value;
    this.logSceneSelect.empty();
    for (const s of scenes) {
      const label = s.sceneName || chapter;
      this.logSceneSelect.createEl('option', { text: label, attr: { value: s.sceneName } });
    }
    // Add a "live" entry if the live scene isn't in completed logs yet
    if (liveChapter === chapter && !scenes.some(s => s.sceneName === (liveScene ?? ''))) {
      const liveLabel = (liveScene || chapter) + ' ⏳';
      this.logSceneSelect.createEl('option', { text: liveLabel, attr: { value: liveScene ?? '' } });
    }
    // Preserve previous selection if still valid
    if (!this.logFollowLive && [...this.logSceneSelect.options].some(o => (o as HTMLOptionElement).value === prevScene)) {
      this.logSceneSelect.value = prevScene;
    }
  }

  /** Render the log entry for the currently selected chapter + scene. */
  private renderSelectedLog(): void {
    this.logDetailEl.empty();

    const chapter = this.logChapterSelect.value;
    const scene = this.logSceneSelect.value;
    const entry = this.sceneLogs.find(l => l.chapterName === chapter && l.sceneName === scene);

    // If the selected scene is the one currently being analysed (not yet
    // in sceneLogs), show the live-streamed content instead of nothing.
    if (!entry) {
      if (this.isRunning && chapter === this.liveChapterName && scene === this.liveSceneName) {
        this.renderLiveContent();
      }
      return;
    }

    // Thinking (collapsible)
    if (entry.thinking) {
      const thinkDetails = this.logDetailEl.createEl('details', { cls: 'novalist-fullscan-log-thinking' });
      const thinkSummary = thinkDetails.createEl('summary');
      thinkSummary.createSpan({ text: t('ollama.logThinking') });
      const thinkingText = entry.thinking;
      const copyBtn = thinkSummary.createEl('button', {
        text: t('ollama.copyThinking'),
        cls: 'novalist-copy-thinking-btn',
      });
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        void window.navigator.clipboard.writeText(thinkingText);
      });
      thinkDetails.createDiv({ cls: 'novalist-fullscan-log-pre', text: entry.thinking });
    }

    // Raw response (collapsible)
    if (entry.rawResponse) {
      const respDetails = this.logDetailEl.createEl('details', { cls: 'novalist-fullscan-log-response' });
      respDetails.createEl('summary', { text: t('ollama.logResponse') });
      respDetails.createDiv({ cls: 'novalist-fullscan-log-pre', text: entry.rawResponse });
    }

    // Findings in human-readable form
    if (entry.findings.length > 0) {
      const findingsSection = this.logDetailEl.createDiv('novalist-fullscan-log-findings');
      findingsSection.createEl('h4', { text: `${t('ollama.logFindings')} (${entry.findings.length})` });
      for (const f of entry.findings) {
        const card = findingsSection.createDiv('novalist-fullscan-log-finding');
        const badge = card.createEl('span', { text: this.getBadgeLabel(f.type), cls: 'novalist-ai-badge' });
        badge.addClass(`novalist-ai-badge--${f.type}`);
        card.createEl('strong', { text: f.title });
        card.createEl('p', { text: f.description });
        if (f.excerpt) {
          card.createEl('blockquote', { text: f.excerpt, cls: 'novalist-ai-excerpt' });
        }
        if (f.entityName) {
          const info = card.createEl('span', { cls: 'novalist-ai-entity-name' });
          info.textContent = f.entityName + (f.entityType ? ` (${f.entityType})` : '');
        }
      }
    } else {
      this.logDetailEl.createEl('p', { text: t('ollama.noFindings'), cls: 'novalist-ai-empty' });
    }
  }

  /**
   * Render the live-streamed thinking/response content into the detail area.
   * Creates the same DOM structure as showLiveLog so streaming callbacks
   * can continue to update it.
   */
  private renderLiveContent(): void {
    this.logDetailEl.empty();
    const label = this.liveSceneName
      ? `${this.liveChapterName} › ${this.liveSceneName}`
      : this.liveChapterName;
    this.logDetailEl.createEl('div', { text: label, cls: 'novalist-fullscan-log-label' });

    // Thinking block (collapsible, open so the user can see)
    const thinkDetails = this.logDetailEl.createEl('details', { cls: 'novalist-fullscan-log-thinking' });
    thinkDetails.setAttribute('open', '');
    const thinkSummary = thinkDetails.createEl('summary');
    thinkSummary.createSpan({ text: t('ollama.logThinking') });
    const liveCopyBtn2 = thinkSummary.createEl('button', {
      text: t('ollama.copyThinking'),
      cls: 'novalist-copy-thinking-btn',
    });
    liveCopyBtn2.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      void window.navigator.clipboard.writeText(this.liveThinking);
    });
    this.liveThinkingEl = thinkDetails.createDiv('novalist-fullscan-log-pre');
    this.liveThinkingEl.textContent = this.liveThinking;

    // Raw response block
    const respDetails = this.logDetailEl.createEl('details', { cls: 'novalist-fullscan-log-response' });
    respDetails.setAttribute('open', '');
    respDetails.createEl('summary', { text: t('ollama.logResponse') });
    this.liveResponseEl = respDetails.createDiv('novalist-fullscan-log-pre');
    this.liveResponseEl.textContent = this.liveResponse;
  }

  // ── Findings (top section) ──────────────────────────────────────

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

    const actions = card.createDiv('novalist-ai-actions');

    if (finding.type === 'suggestion') {
      const createBtn = actions.createEl('button', { text: t('ollama.createEntity'), cls: 'mod-cta novalist-ai-action-btn' });
      createBtn.addEventListener('click', () => {
        this.createEntityFromSuggestion(finding);
        card.addClass('is-dismissed');
      });
    }

    const dismissBtn = actions.createEl('button', { text: t('ollama.dismiss'), cls: 'novalist-ai-action-btn' });
    dismissBtn.addEventListener('click', () => {
      for (const cr of this.findings) {
        cr.findings = cr.findings.filter(f => f !== finding);
      }
      this.findings = this.findings.filter(cr => cr.findings.length > 0);
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
