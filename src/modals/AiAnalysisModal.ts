import { App, Modal, Notice, TFile } from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';
import type { AiFinding, AiFindingType } from '../utils/ollamaService';

type FilterTab = 'all' | 'reference' | 'inconsistency' | 'suggestion';

export class AiAnalysisModal extends Modal {
  private plugin: NovalistPlugin;
  private file: TFile;
  private findings: AiFinding[] = [];
  private activeTab: FilterTab = 'all';
  private bodyEl: HTMLElement;
  private isLoading = false;

  constructor(app: App, plugin: NovalistPlugin, file: TFile) {
    super(app);
    this.plugin = plugin;
    this.file = file;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass('novalist-ai-analysis-modal');

    contentEl.createEl('h2', { text: t('ollama.analysisTitle', { chapter: this.file.basename }) });

    // Tab bar
    const tabBar = contentEl.createDiv('novalist-ai-tabs');
    const tabs: { key: FilterTab; label: string }[] = [
      { key: 'all', label: t('ollama.tabAll') },
      { key: 'reference', label: t('ollama.tabReferences') },
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

    // Start analysis
    await this.runAnalysis();
  }

  onClose(): void {
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

    this.isLoading = true;
    this.renderLoading();

    try {
      // Auto-load model if configured (Ollama only)
      if (this.plugin.settings.ollama.provider === 'ollama' && this.plugin.settings.ollama.autoManageModel) {
        const loaded = await this.plugin.ollamaService.isModelLoaded();
        if (!loaded) {
          await this.plugin.ollamaService.loadModel();
        }
      }

      const chapterText = await this.app.vault.read(this.file);

      // Gather chapter context for override-aware summaries
      const chapterName = this.plugin.getChapterNameForFileSync(this.file);
      const actName = this.plugin.getActForFileSync(this.file) || undefined;

      const entities = await this.plugin.collectEntitySummaries(chapterName, undefined, actName);

      // Get entities already detected by regex so the LLM only reports novel finds
      const body = this.plugin.stripFrontmatter(chapterText);
      const mentions = this.plugin.scanMentions(body);
      const alreadyFound = [
        ...mentions.characters,
        ...mentions.locations,
        ...mentions.items,
        ...mentions.lore,
      ];

      // Determine which checks are enabled
      const checks = {
        references: this.plugin.settings.ollama.checkReferences,
        inconsistencies: this.plugin.settings.ollama.checkInconsistencies,
        suggestions: this.plugin.settings.ollama.checkSuggestions,
      };

      const result = await this.plugin.ollamaService.analyseChapter(
        body, entities, alreadyFound,
        { chapterName, actName },
        checks,
        (done, total) => {
          this.updateProgress(done, total);
        },
      );
      this.findings = result.findings;
      this.isLoading = false;
      new Notice(t('ollama.analysisDone'));
      this.renderFindings();
    } catch (err) {
      this.isLoading = false;
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(t('ollama.analysisError', { error: msg }));
      this.bodyEl.empty();
      this.bodyEl.createEl('p', { text: t('ollama.analysisError', { error: msg }), cls: 'novalist-ai-error' });
    }
  }

  private renderLoading(): void {
    this.bodyEl.empty();
    const loadingEl = this.bodyEl.createDiv('novalist-ai-loading');
    loadingEl.createEl('div', { cls: 'novalist-ai-spinner' });
    loadingEl.createEl('p', { text: t('ollama.analysing') });
    // Progress bar
    const progressWrap = loadingEl.createDiv('novalist-ai-progress');
    progressWrap.createDiv('novalist-ai-progress-fill');
    loadingEl.createEl('p', { text: '', cls: 'novalist-ai-progress-label' });
  }

  private updateProgress(done: number, total: number): void {
    const bar = this.bodyEl.querySelector<HTMLElement>('.novalist-ai-progress-fill');
    const label = this.bodyEl.querySelector<HTMLElement>('.novalist-ai-progress-label');
    if (bar) bar.style.width = `${Math.round((done / total) * 100)}%`;
    if (label) label.textContent = `${done} / ${total}`;
  }

  private renderFindings(): void {
    this.bodyEl.empty();

    const filtered = this.activeTab === 'all'
      ? this.findings
      : this.findings.filter(f => f.type === this.activeTab);

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

    // Badge
    const badgeText = this.getBadgeLabel(finding.type);
    const badge = card.createEl('span', { text: badgeText, cls: 'novalist-ai-badge' });
    badge.addClass(`novalist-ai-badge--${finding.type}`);

    // Title
    card.createEl('strong', { text: finding.title, cls: 'novalist-ai-finding-title' });

    // Description
    card.createEl('p', { text: finding.description, cls: 'novalist-ai-finding-desc' });

    // Excerpt
    if (finding.excerpt) {
      card.createEl('blockquote', { text: finding.excerpt, cls: 'novalist-ai-excerpt' });
    }

    // Entity info
    if (finding.entityName) {
      const entityInfo = card.createDiv('novalist-ai-entity-info');
      entityInfo.createEl('span', { text: `${finding.entityName}`, cls: 'novalist-ai-entity-name' });
      if (finding.entityType) {
        entityInfo.createEl('span', { text: ` (${finding.entityType})`, cls: 'novalist-ai-entity-type' });
      }
    }

    // Action buttons
    const actions = card.createDiv('novalist-ai-actions');

    if (finding.type === 'reference' && finding.entityName) {
      const linkBtn = actions.createEl('button', { text: t('ollama.insertLink'), cls: 'mod-cta novalist-ai-action-btn' });
      linkBtn.addEventListener('click', () => {
        void this.insertWikilink(finding.entityName ?? '');
        card.addClass('is-dismissed');
      });
    }

    if (finding.type === 'suggestion') {
      const createBtn = actions.createEl('button', { text: t('ollama.createEntity'), cls: 'mod-cta novalist-ai-action-btn' });
      createBtn.addEventListener('click', () => {
        this.createEntityFromSuggestion(finding);
        card.addClass('is-dismissed');
      });
    }

    const dismissBtn = actions.createEl('button', { text: t('ollama.dismiss'), cls: 'novalist-ai-action-btn' });
    dismissBtn.addEventListener('click', () => {
      this.findings = this.findings.filter(f => f !== finding);
      this.renderFindings();
    });
  }

  private getBadgeLabel(type: AiFindingType): string {
    switch (type) {
      case 'reference': return t('ollama.findingReference');
      case 'inconsistency': return t('ollama.findingInconsistency');
      case 'suggestion': return t('ollama.findingSuggestion');
    }
  }

  private async insertWikilink(entityName: string): Promise<void> {
    // Read current chapter content and replace first unlinked mention
    const content = await this.app.vault.read(this.file);
    // Find the entity name not already inside [[ ]]
    const escaped = entityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<!\\[\\[)\\b(${escaped})\\b(?!\\]\\])`, 'i');
    const match = content.match(pattern);
    if (match && match.index !== undefined) {
      const newContent = content.substring(0, match.index) + `[[${match[0]}]]` + content.substring(match.index + match[0].length);
      await this.app.vault.modify(this.file, newContent);
      new Notice(t('ollama.insertLink') + `: [[${entityName}]]`);
    }
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
}
