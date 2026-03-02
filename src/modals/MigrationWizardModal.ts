import { App, Modal, Notice, setIcon } from 'obsidian';
import type NovalistPlugin from '../main';
import { t } from '../i18n';
import type { MigrationAnalysis, MigrationResult } from '../services/MigrationService';
import { analyseProject, migrateProject, detectLegacyFormat } from '../services/MigrationService';

/**
 * Migration wizard modal — shown when a legacy-format project is detected.
 *
 * Flow: analyse → summary → migrate (with progress) → result
 */
export class MigrationWizardModal extends Modal {
  private plugin: NovalistPlugin;
  private analysis: MigrationAnalysis | null = null;
  private result: MigrationResult | null = null;
  private phase: 'analyse' | 'summary' | 'progress' | 'result' = 'analyse';

  constructor(app: App, plugin: NovalistPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    this.modalEl.addClass('novalist-migration-modal');
    void this.runAnalysis();
  }

  // ── Phase 1: analyse ────────────────────────────────────────────

  private async runAnalysis(): Promise<void> {
    this.phase = 'analyse';
    this.render();

    const projectPath = this.plugin.resolvedProjectPath();
    const projectData = this.plugin.getProjectData();

    try {
      this.analysis = await analyseProject(
        this.app.vault,
        projectPath,
        this.plugin.settings,
        projectData
      );
      this.phase = 'summary';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      new Notice(`Migration analysis failed: ${msg}`);
      this.close();
      return;
    }

    this.render();
  }

  // ── Phase 2: summary ───────────────────────────────────────────

  private renderSummary(el: HTMLElement): void {
    const a = this.analysis;
    if (!a) return;

    // Hero header
    const hero = el.createDiv('novalist-wizard-hero');
    const iconCt = hero.createDiv('novalist-wizard-icon');
    setIcon(iconCt, 'arrow-up-circle');
    hero.createEl('h2').setText(t('migration.title'));
    hero.createEl('p').setText(t('migration.description'));

    // Summary table
    el.createEl('h3').setText(t('migration.summaryTitle'));

    const table = el.createDiv('novalist-migration-summary');
    const rows: [string, number][] = [
      [t('migration.chapters', { count: String(a.chapterCount) }), a.chapterCount],
      [t('migration.scenes', { count: String(a.sceneCount) }), a.sceneCount],
      [t('migration.characters', { count: String(a.characterCount) }), a.characterCount],
      [t('migration.locations', { count: String(a.locationCount) }), a.locationCount],
      [t('migration.worlds', { count: String(a.worldCount) }), a.worldCount],
      [t('migration.items', { count: String(a.itemCount) }), a.itemCount],
      [t('migration.lore', { count: String(a.loreCount) }), a.loreCount],
    ];
    for (const [label, count] of rows) {
      if (count > 0) {
        const row = table.createDiv('novalist-migration-row');
        row.createSpan().setText(label);
      }
    }
    if (a.hasPlotBoard) {
      const row = table.createDiv('novalist-migration-row');
      row.createSpan().setText(t('migration.plotBoard'));
    }
    if (a.hasTimeline) {
      const row = table.createDiv('novalist-migration-row');
      row.createSpan().setText(t('migration.timeline'));
    }

    // Warnings
    if (a.warnings.length > 0) {
      el.createEl('h3').setText(t('migration.warningsTitle'));
      const warningList = el.createEl('ul', { cls: 'novalist-migration-warnings' });
      for (const w of a.warnings) {
        warningList.createEl('li').setText(w);
      }
    }

    // Backup note
    const backupPath = `${this.plugin.resolvedProjectPath()}_pre_yaml_backup`;
    const note = el.createDiv('novalist-migration-backup-note');
    setIcon(note.createSpan(), 'shield');
    note.createSpan().setText(t('migration.backupNote', { path: backupPath }));

    // Buttons
    const actions = el.createDiv('novalist-wizard-actions-between');

    const skipBtn = actions.createEl('button');
    skipBtn.setText(t('migration.skip'));
    skipBtn.addEventListener('click', () => {
      void this.handleSkip();
    });

    const migrateBtn = actions.createEl('button', { cls: 'mod-cta' });
    migrateBtn.setText(t('migration.migrate'));
    migrateBtn.addEventListener('click', () => {
      void this.runMigration();
    });
  }

  // ── Phase 3: progress ──────────────────────────────────────────

  private async runMigration(): Promise<void> {
    this.phase = 'progress';
    this.render();

    const projectPath = this.plugin.resolvedProjectPath();
    const activeProject = this.plugin.getActiveProject();
    const projectName = activeProject?.name ?? 'NovelProject';
    const projectData = this.plugin.getProjectData();

    const progressBar = this.contentEl.querySelector<HTMLElement>('.novalist-migration-bar-fill');
    const progressLabel = this.contentEl.querySelector<HTMLElement>('.novalist-migration-progress-label');

    try {
      this.result = await migrateProject(
        this.app,
        projectPath,
        projectName,
        this.plugin.settings,
        projectData,
        (step: string, current: number, total: number) => {
          if (progressBar) {
            progressBar.style.width = `${Math.round((current / total) * 100)}%`;
          }
          if (progressLabel) {
            progressLabel.setText(`${step} (${current}/${total})`);
          }
        }
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.result = {
        success: false,
        summary: [],
        warnings: [],
        backupPath: '',
        errors: [msg],
      };
    }

    // Mark migration complete regardless of outcome (user can rollback)
    this.plugin.settings.dataFormatVersion = 2;

    // Update novalistRoot and projectPath to match the new StoryLine layout
    if (this.result?.success) {
      if (this.result.newNovalistRoot !== undefined) {
        this.plugin.settings.novalistRoot = this.result.newNovalistRoot;
      }
      if (this.result.newProjectPath !== undefined) {
        this.plugin.settings.projectPath = this.result.newProjectPath;
        // Also update the active project entry's path
        const activeProject = this.plugin.getActiveProject();
        if (activeProject) {
          activeProject.path = this.result.newProjectPath;
        }
      }
    }

    await this.plugin.saveSettings();

    this.phase = 'result';
    this.render();
  }

  private renderProgress(el: HTMLElement): void {
    const hero = el.createDiv('novalist-wizard-hero');
    const iconCt = hero.createDiv('novalist-wizard-icon');
    setIcon(iconCt, 'loader');
    hero.createEl('h2').setText(t('migration.progressTitle'));

    const barContainer = el.createDiv('novalist-migration-bar');
    barContainer.createDiv('novalist-migration-bar-fill');

    el.createDiv('novalist-migration-progress-label');
  }

  // ── Phase 4: result ────────────────────────────────────────────

  private renderResult(el: HTMLElement): void {
    const r = this.result;
    if (!r) return;

    const hero = el.createDiv('novalist-wizard-hero');
    const iconCt = hero.createDiv('novalist-wizard-icon');
    setIcon(iconCt, r.success ? 'check-circle' : 'alert-triangle');
    hero.createEl('h2').setText(t('migration.resultTitle'));
    hero.createEl('p').setText(
      r.success
        ? t('migration.resultSuccess')
        : t('migration.resultFailed', { path: r.backupPath })
    );

    // Summary lines
    if (r.summary.length > 0) {
      el.createEl('h3').setText(t('migration.resultSummary'));
      const ul = el.createEl('ul');
      for (const line of r.summary) {
        ul.createEl('li').setText(line);
      }
    }

    // Warnings
    if (r.warnings.length > 0) {
      el.createEl('h3').setText(t('migration.resultWarnings'));
      const ul = el.createEl('ul', { cls: 'novalist-migration-warnings' });
      for (const w of r.warnings) {
        ul.createEl('li').setText(w);
      }
    }

    // Errors
    if (r.errors.length > 0) {
      const errorDiv = el.createDiv('novalist-migration-errors');
      for (const e of r.errors) {
        errorDiv.createEl('p').setText(e);
      }
    }

    // Buttons
    const actions = el.createDiv('novalist-wizard-actions-between');

    if (!r.success && r.backupPath) {
      const rollbackBtn = actions.createEl('button');
      rollbackBtn.setText(t('migration.rollback'));
      rollbackBtn.addEventListener('click', () => {
        void this.handleRollback();
      });
    } else {
      // Spacer so Done button stays right-aligned
      actions.createDiv();
    }

    const doneBtn = actions.createEl('button', { cls: 'mod-cta' });
    doneBtn.setText(t('migration.done'));
    doneBtn.addEventListener('click', () => {
      this.close();
      // Reload Obsidian so all caches, views and settings reflect the migrated layout
      (this.app as unknown as { commands: { executeCommandById: (id: string) => void } })
        .commands.executeCommandById('app:reload');
    });
  }

  // ── Rollback ──────────────────────────────────────────────────

  private async handleRollback(): Promise<void> {
    if (!this.result?.backupPath) return;

    // Show a simple confirmation via a sub-modal
    const proceed = await new Promise<boolean>(resolve => {
      const confirmModal = new Modal(this.app);
      confirmModal.contentEl.createEl('p').setText(t('migration.rollbackConfirm'));
      const actions = confirmModal.contentEl.createDiv('novalist-wizard-actions-between');
      const cancelBtn = actions.createEl('button');
      cancelBtn.setText(t('migration.later'));
      cancelBtn.addEventListener('click', () => { confirmModal.close(); resolve(false); });
      const okBtn = actions.createEl('button', { cls: 'mod-cta' });
      okBtn.setText(t('migration.rollback'));
      okBtn.addEventListener('click', () => { confirmModal.close(); resolve(true); });
      confirmModal.open();
    });
    if (!proceed) return;

    try {
      const vault = this.app.vault;
      const backupPath = this.result.backupPath;
      const projectPath = this.plugin.resolvedProjectPath();

      // Get all files in backup
      const backupFiles = vault.getFiles().filter(f =>
        f.path.startsWith(backupPath + '/')
      );

      for (const bf of backupFiles) {
        const relativePath = bf.path.slice(backupPath.length + 1);
        const targetPath = `${projectPath}/${relativePath}`;
        const content = await vault.read(bf);
        const existing = vault.getAbstractFileByPath(targetPath);
        if (existing) {
          await vault.adapter.write(targetPath, content);
        } else {
          await vault.create(targetPath, content);
        }
      }

      // Reset format version so migration can be re-offered
      this.plugin.settings.dataFormatVersion = undefined;
      await this.plugin.saveSettings();

      new Notice(t('migration.rollbackSuccess'));
      this.close();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      new Notice(t('migration.rollbackFailed', { error: msg }));
    }
  }

  // ── Skip ──────────────────────────────────────────────────────

  private async handleSkip(): Promise<void> {
    const proceed = await new Promise<boolean>(resolve => {
      const confirmModal = new Modal(this.app);
      confirmModal.contentEl.createEl('p').setText(t('migration.skipConfirm'));
      const actions = confirmModal.contentEl.createDiv('novalist-wizard-actions-between');
      const cancelBtn = actions.createEl('button');
      cancelBtn.setText(t('migration.later'));
      cancelBtn.addEventListener('click', () => { confirmModal.close(); resolve(false); });
      const okBtn = actions.createEl('button', { cls: 'mod-cta' });
      okBtn.setText(t('migration.skip'));
      okBtn.addEventListener('click', () => { confirmModal.close(); resolve(true); });
      confirmModal.open();
    });
    if (!proceed) return;

    this.plugin.settings.dataFormatVersion = 2;
    await this.plugin.saveSettings();
    this.close();
  }

  // ── Render dispatcher ─────────────────────────────────────────

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    switch (this.phase) {
      case 'analyse': {
        const hero = contentEl.createDiv('novalist-wizard-hero');
        const iconCt = hero.createDiv('novalist-wizard-icon');
        setIcon(iconCt, 'loader');
        hero.createEl('h2').setText(t('migration.analysing'));
        break;
      }
      case 'summary':
        this.renderSummary(contentEl);
        break;
      case 'progress':
        this.renderProgress(contentEl);
        break;
      case 'result':
        this.renderResult(contentEl);
        break;
    }
  }
}

/**
 * Show a non-blocking Obsidian Notice prompting the user to migrate.
 * Returns a promise that resolves when the user clicks "Migrate Now"
 * (resolves `true`) or "Later" (resolves `false`).
 */
export function showMigrationNotice(plugin: NovalistPlugin): void {
  // Use a Fragment to build the notice content with clickable buttons
  const fragment = document.createDocumentFragment();
  fragment.createSpan().setText(t('migration.noticeText'));
  fragment.createEl('br');

  const btnContainer = fragment.createEl('div', {
    attr: { style: 'display:flex;gap:8px;margin-top:8px;justify-content:flex-end;' }
  });

  const notice = new Notice(fragment, 0); // 0 = no auto-dismiss

  const laterBtn = btnContainer.createEl('button');
  laterBtn.setText(t('migration.later'));
  laterBtn.addEventListener('click', () => {
    notice.hide();
  });

  const migrateBtn = btnContainer.createEl('button', { cls: 'mod-cta' });
  migrateBtn.setText(t('migration.migrateNow'));
  migrateBtn.addEventListener('click', () => {
    notice.hide();
    new MigrationWizardModal(plugin.app, plugin).open();
  });
}

/**
 * Check whether the active project needs migration and prompt the user.
 * Called from `onload()` after layout is ready and startup wizard is done.
 */
export async function checkAndPromptMigration(plugin: NovalistPlugin): Promise<void> {
  // Already migrated or explicitly skipped
  if (plugin.settings.dataFormatVersion && plugin.settings.dataFormatVersion >= 2) {
    return;
  }

  const projectPath = plugin.resolvedProjectPath();
  // No project path yet — nothing to migrate
  if (!projectPath || !plugin.app.vault.getAbstractFileByPath(projectPath)) {
    return;
  }

  const isLegacy = await detectLegacyFormat(
    plugin.app.vault,
    projectPath,
    plugin.settings.chapterFolder,
    plugin.settings.characterFolder
  );

  if (isLegacy) {
    showMigrationNotice(plugin);
  } else {
    // Project already uses new format (or is empty) — mark as current
    plugin.settings.dataFormatVersion = 2;
    await plugin.saveSettings();
  }
}
