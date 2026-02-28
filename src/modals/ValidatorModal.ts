import { App, Modal, setIcon, TFile, MarkdownView } from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';
import type { ValidatorFinding, ValidatorCategory, ValidatorSeverity, ValidationResult } from '../types';

type CategoryTab = 'all' | ValidatorCategory;

export class ValidatorModal extends Modal {
  private plugin: NovalistPlugin;
  private singleFile?: TFile;
  private result: ValidationResult | null = null;
  private isRunning = false;
  private activeTab: CategoryTab = 'all';
  private activeSeverities: Set<ValidatorSeverity> = new Set(['error', 'warning', 'info']);
  private showDismissed = false;
  private bodyEl!: HTMLElement;

  constructor(app: App, plugin: NovalistPlugin, singleFile?: TFile) {
    super(app);
    this.plugin = plugin;
    this.singleFile = singleFile;
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass('novalist-validator-modal');
    contentEl.addClass('novalist-validator-content');

    contentEl.createEl('h2', {
      text: this.singleFile
        ? `${t('validator.displayName')} — ${this.singleFile.basename}`
        : t('validator.displayName'),
    });

    this.bodyEl = contentEl.createDiv('novalist-validator-body');

    // Use cached result if full-story, otherwise always re-run
    const cached = !this.singleFile ? this.plugin.getValidationResult() : undefined;
    if (cached) {
      this.result = cached;
      this.renderResults();
    } else {
      this.renderRunButton();
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }

  // ── Run button (initial state) ────────────────────────────────────

  private renderRunButton(): void {
    const { bodyEl } = this;
    bodyEl.empty();

    const center = bodyEl.createDiv('novalist-validator-center');

    if (this.result) {
      const ts = new Date(this.result.timestamp);
      center.createEl('p', { text: t('validator.lastRun', { date: ts.toLocaleString() }), cls: 'novalist-validator-last-run' });
    } else {
      center.createEl('p', { text: t('validator.neverRun'), cls: 'novalist-validator-empty' });
    }

    const runBtn = center.createEl('button', {
      text: this.result ? t('validator.rerun') : t('validator.run'),
      cls: 'mod-cta novalist-validator-run-btn',
    });
    runBtn.addEventListener('click', () => void this.runValidation());
  }

  // ── Running state ─────────────────────────────────────────────────

  private renderRunning(): void {
    const { bodyEl } = this;
    bodyEl.empty();

    const center = bodyEl.createDiv('novalist-validator-center');
    const spinner = center.createDiv('novalist-validator-spinner');
    setIcon(spinner, 'loader-2');
    center.createEl('p', { text: t('validator.running'), cls: 'novalist-validator-running-label' });
  }

  // ── Run validation ────────────────────────────────────────────────

  private async runValidation(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.renderRunning();

    try {
      this.result = await this.plugin.validateStory(this.singleFile);
    } catch (err) {
      console.error('Validator error:', err);
    } finally {
      this.isRunning = false;
    }

    this.renderResults();
  }

  // ── Results ───────────────────────────────────────────────────────

  private renderResults(): void {
    const { bodyEl } = this;
    bodyEl.empty();

    if (!this.result) {
      this.renderRunButton();
      return;
    }

    // Header row: summary + re-run + show-dismissed
    const headerRow = bodyEl.createDiv('novalist-validator-header-row');
    this.renderSummaryBadges(headerRow);

    const btnGroup = headerRow.createDiv('novalist-validator-btn-group');

    const dismissedBtn = btnGroup.createEl('button', {
      text: this.showDismissed ? t('validator.hideDismissed') : t('validator.showDismissed'),
      cls: 'novalist-validator-secondary-btn',
    });
    dismissedBtn.addEventListener('click', () => {
      this.showDismissed = !this.showDismissed;
      this.renderResults();
    });

    const rerunBtn = btnGroup.createEl('button', {
      text: t('validator.rerun'),
      cls: 'novalist-validator-secondary-btn',
    });
    setIcon(rerunBtn.createSpan('novalist-btn-icon'), 'refresh-cw');
    rerunBtn.addEventListener('click', () => void this.runValidation());

    // Severity filters
    const sevFilter = bodyEl.createDiv('novalist-validator-sev-filter');
    const severities: ValidatorSeverity[] = ['error', 'warning', 'info'];
    for (const sev of severities) {
      const active = this.activeSeverities.has(sev);
      const btn = sevFilter.createEl('button', {
        cls: `novalist-validator-sev-btn novalist-sev-${sev}${active ? ' is-active' : ''}`,
      });
      const iconEl = btn.createSpan('novalist-sev-icon');
      if (sev === 'error') setIcon(iconEl, 'x-circle');
      else if (sev === 'warning') setIcon(iconEl, 'alert-triangle');
      else setIcon(iconEl, 'info');
      btn.createSpan({ text: t(`validator.sev${sev.charAt(0).toUpperCase() + sev.slice(1)}` as Parameters<typeof t>[0]) });
      btn.addEventListener('click', () => {
        if (this.activeSeverities.has(sev)) {
          if (this.activeSeverities.size > 1) this.activeSeverities.delete(sev);
        } else {
          this.activeSeverities.add(sev);
        }
        this.renderResults();
      });
    }

    // Category tabs
    const tabBar = bodyEl.createDiv('novalist-validator-tabs');
    const tabs: { key: CategoryTab; label: string }[] = [
      { key: 'all', label: t('validator.tabAll') },
      { key: 'timeline', label: t('validator.tabTimeline') },
      { key: 'characters', label: t('validator.tabCharacters') },
      { key: 'plotlines', label: t('validator.tabPlotlines') },
      { key: 'structure', label: t('validator.tabStructure') },
      { key: 'continuity', label: t('validator.tabContinuity') },
      { key: 'pacing', label: t('validator.tabPacing') },
    ];

    for (const tab of tabs) {
      const btn = tabBar.createEl('button', {
        text: tab.label,
        cls: `novalist-validator-tab${tab.key === this.activeTab ? ' is-active' : ''}`,
      });
      btn.addEventListener('click', () => {
        this.activeTab = tab.key;
        this.renderResults();
      });
    }

    // Findings list
    const listEl = bodyEl.createDiv('novalist-validator-list');
    const pd = this.plugin.settings.projectData[this.plugin.settings.activeProjectId];
    const dismissed = new Set((pd?.dismissedFindings ?? []).map(d => d.fingerprint));

    let findings = this.result.findings.filter(f => {
      if (!this.activeSeverities.has(f.severity)) return false;
      if (this.activeTab !== 'all' && f.category !== this.activeTab) return false;
      if (!this.showDismissed && dismissed.has(f.fingerprint)) return false;
      return true;
    });

    if (this.showDismissed) {
      // Also show actually dismissed findings
      findings = [
        ...this.result.findings.filter(f => {
          if (!this.activeSeverities.has(f.severity)) return false;
          if (this.activeTab !== 'all' && f.category !== this.activeTab) return false;
          if (!dismissed.has(f.fingerprint)) return false;
          return true;
        }),
        ...findings.filter(f => !dismissed.has(f.fingerprint)),
      ];
      // Deduplicate (dismissed first then active); but actually filtering above already separates
    }

    if (findings.length === 0) {
      listEl.createEl('p', { text: t('validator.noFindings'), cls: 'novalist-validator-empty' });
      return;
    }

    for (const finding of findings) {
      this.renderFindingCard(listEl, finding, dismissed.has(finding.fingerprint));
    }
  }

  private renderSummaryBadges(container: HTMLElement): void {
    if (!this.result) return;
    const badges = container.createDiv('novalist-validator-summary');
    if (this.result.summary.errors > 0) {
      const badge = badges.createSpan('novalist-validator-badge novalist-badge-error');
      setIcon(badge.createSpan('novalist-badge-icon'), 'x-circle');
      badge.createSpan({ text: ` ${t('validator.errors', { n: this.result.summary.errors })}` });
    }
    if (this.result.summary.warnings > 0) {
      const badge = badges.createSpan('novalist-validator-badge novalist-badge-warning');
      setIcon(badge.createSpan('novalist-badge-icon'), 'alert-triangle');
      badge.createSpan({ text: ` ${t('validator.warnings', { n: this.result.summary.warnings })}` });
    }
    if (this.result.summary.infos > 0) {
      const badge = badges.createSpan('novalist-validator-badge novalist-badge-info');
      setIcon(badge.createSpan('novalist-badge-icon'), 'info');
      badge.createSpan({ text: ` ${t('validator.infos', { n: this.result.summary.infos })}` });
    }
    if (this.result.summary.errors === 0 && this.result.summary.warnings === 0 && this.result.summary.infos === 0) {
      badges.createSpan({ text: t('validator.noFindings'), cls: 'novalist-validator-empty' });
    }
  }

  private renderFindingCard(container: HTMLElement, finding: ValidatorFinding, isDismissed: boolean): void {
    const card = container.createDiv(`novalist-validator-card novalist-card-${finding.severity}${isDismissed ? ' is-dismissed' : ''}`);

    // Icon + category badge
    const cardHeader = card.createDiv('novalist-card-header');
    const sevIcon = cardHeader.createSpan(`novalist-card-sev-icon novalist-sev-${finding.severity}`);
    if (finding.severity === 'error') setIcon(sevIcon, 'x-circle');
    else if (finding.severity === 'warning') setIcon(sevIcon, 'alert-triangle');
    else setIcon(sevIcon, 'info');

    cardHeader.createSpan({ text: finding.title, cls: 'novalist-card-title' });

    const catBadge = cardHeader.createSpan({ text: finding.category, cls: 'novalist-card-category' });
    catBadge.addClass(`novalist-cat-${finding.category}`);

    if (finding.source === 'ai') {
      const aiBadge = cardHeader.createSpan({ text: t('validator.aiSource'), cls: 'novalist-card-ai-badge' });
      setIcon(aiBadge.createSpan('novalist-card-ai-icon'), 'bot');
    }

    // Description
    card.createEl('p', { text: finding.description, cls: 'novalist-card-desc' });

    // Entities
    if (finding.entities && finding.entities.length > 0) {
      const entitiesEl = card.createDiv('novalist-card-entities');
      for (const entity of finding.entities) {
        entitiesEl.createSpan({ text: entity, cls: 'novalist-card-entity' });
      }
    }

    // Actions
    const actions = card.createDiv('novalist-card-actions');

    if (finding.filePath) {
      const goBtn = actions.createEl('button', {
        text: t('validator.goTo'),
        cls: 'novalist-card-action-btn',
      });
      setIcon(goBtn.createSpan('novalist-btn-icon'), 'external-link');
      goBtn.addEventListener('click', () => void this.navigateTo(finding));
    }

    if (!isDismissed) {
      const dismissBtn = actions.createEl('button', {
        text: t('validator.dismiss'),
        cls: 'novalist-card-action-btn novalist-card-dismiss-btn',
      });
      dismissBtn.addEventListener('click', () => {
        void this.plugin.dismissValidatorFinding(finding.fingerprint, finding.ruleId).then(() => {
          this.renderResults();
        });
      });
    } else {
      const restoreBtn = actions.createEl('button', {
        text: t('validator.showDismissed').replace('Show ', '').replace('Ausgeblendete anzeigen', 'Wiederherstellen'),
        cls: 'novalist-card-action-btn',
      });
      restoreBtn.addEventListener('click', () => {
        void this.plugin.restoreValidatorFinding(finding.fingerprint).then(() => {
          this.renderResults();
        });
      });
    }
  }

  private async navigateTo(finding: ValidatorFinding): Promise<void> {
    const { filePath, sceneName } = finding;
    if (!filePath) return;
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    // If scene specified, scroll to the H2 heading
    if (sceneName) {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view?.editor) {
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trimStart().startsWith('## ') && lines[i].includes(sceneName)) {
            view.editor.setCursor({ line: i, ch: 0 });
            view.editor.scrollIntoView({ from: { line: i, ch: 0 }, to: { line: i, ch: 0 } }, true);
            break;
          }
        }
      }
    }
    this.close();
  }
}
