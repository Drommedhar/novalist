import {
  PluginSettingTab,
  App,
  Setting,
  ButtonComponent,
  Notice
} from 'obsidian';
import type NovalistPlugin from '../main';
import {
  getLanguageLabels,
  LANGUAGE_DEFAULTS,
  cloneAutoReplacements,
  DEFAULT_CHARACTER_TEMPLATE,
  DEFAULT_LOCATION_TEMPLATE,
  DEFAULT_ITEM_TEMPLATE,
  DEFAULT_LORE_TEMPLATE,
  cloneCharacterTemplate,
  cloneLocationTemplate,
  cloneItemTemplate,
  cloneLoreTemplate
} from './NovalistSettings';
import { LanguageKey } from '../types';
import { t } from '../i18n';
import { CharacterTemplateEditorModal, LocationTemplateEditorModal, ItemTemplateEditorModal, LoreTemplateEditorModal } from '../modals/TemplateEditorModal';
import { ProjectAddModal, ProjectRenameModal, RootMoveConfirmModal } from '../modals/ProjectModals';

type TemplateCategory = 'character' | 'location' | 'item' | 'lore';

export class NovalistSettingTab extends PluginSettingTab {
  plugin: NovalistPlugin;
  private selectedTemplateCategory: TemplateCategory = 'character';

  constructor(app: App, plugin: NovalistPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ── Projects ──────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName(t('project.projects'))
      .setHeading();

    // Active project selector
    new Setting(containerEl)
      .setName(t('project.activeProject'))
      .setDesc(t('project.activeProjectDesc'))
      .addDropdown(dropdown => {
        for (const proj of this.plugin.settings.projects) {
          dropdown.addOption(proj.id, proj.name);
        }
        dropdown.setValue(this.plugin.settings.activeProjectId);
        dropdown.onChange(async (value) => {
          await this.plugin.switchProject(value);
          this.display();
        });
      });

    // Project management buttons
    const projectBtnSetting = new Setting(containerEl);
    projectBtnSetting.addButton(btn => btn
      .setButtonText(t('project.addProject'))
      .onClick(() => {
        new ProjectAddModal(this.app, this.plugin, () => this.display()).open();
      }));
    projectBtnSetting.addButton(btn => btn
      .setButtonText(t('project.renameProject'))
      .onClick(() => {
        new ProjectRenameModal(this.app, this.plugin, () => this.display()).open();
      }));
    if (this.plugin.settings.projects.length > 1) {
      projectBtnSetting.addButton(btn => btn
        .setButtonText(t('project.deleteProject'))
        .setWarning()
        .onClick(async () => {
          await this.plugin.deleteProject(this.plugin.settings.activeProjectId);
          this.display();
        }));
    }

    // World Bible
    new Setting(containerEl)
      .setName(t('project.worldBible'))
      .setHeading();
    containerEl.createEl('p', { text: t('project.worldBibleDesc') });

    new Setting(containerEl)
      .setName(t('project.worldBiblePath'))
      .setDesc(t('project.worldBiblePathDesc'))
      .addText(text => text
        .setPlaceholder(t('project.worldBiblePathPlaceholder'))
        .setValue(this.plugin.settings.worldBiblePath)
        .onChange(async (value) => {
          this.plugin.settings.worldBiblePath = value;
          await this.plugin.saveSettings();
        }));

    if (this.plugin.settings.worldBiblePath) {
      new Setting(containerEl)
        .addButton(btn => btn
          .setButtonText(t('project.initWorldBible'))
          .onClick(async () => {
            await this.plugin.initializeWorldBible();
          }));
    }

    new Setting(containerEl)
      .setName(t('settings.preferences'))
      .setHeading();

    let pendingRoot = this.plugin.settings.novalistRoot;
    const rootSetting = new Setting(containerEl)
      .setName(t('settings.novalistRoot'))
      .setDesc(t('settings.novalistRootDesc'))
      .addText(text => text
        .setPlaceholder(t('settings.novalistRootPlaceholder'))
        .setValue(this.plugin.settings.novalistRoot)
        .onChange((value) => {
          pendingRoot = value.replace(/^\/+|\/+$/g, '');
        }));
    rootSetting.addButton(btn => btn
      .setButtonText(t('settings.applyRoot'))
      .onClick(async () => {
        if (pendingRoot === this.plugin.settings.novalistRoot) return;
        const hasContent = this.plugin.settings.projects.some(p => {
          const resolved = this.plugin.resolvePath(p.path);
          return !!this.app.vault.getAbstractFileByPath(resolved);
        }) || (this.plugin.settings.worldBiblePath && !!this.app.vault.getAbstractFileByPath(this.plugin.resolvedWorldBiblePath()));
        if (hasContent) {
          new RootMoveConfirmModal(this.app, this.plugin, pendingRoot, () => this.display()).open();
        } else {
          await this.plugin.changeNovalistRoot(pendingRoot, false);
          this.display();
        }
      }));

    new Setting(containerEl)
      .setName(t('settings.projectPath'))
      .setDesc(t('settings.projectPathDesc'))
      .addText(text => text
        .setPlaceholder(t('settings.projectPathPlaceholder'))
        .setValue(this.plugin.settings.projectPath)
        .onChange(async (value) => {
          this.plugin.settings.projectPath = value;
          // Also update the active project entry
          const active = this.plugin.getActiveProject();
          if (active) {
            active.path = value;
          }
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(t('settings.peekSize'))
      .setDesc(t('settings.peekSizeDesc'))
      .addButton(btn => btn
        .setButtonText(t('settings.resetPeekSize'))
        .onClick(() => {
          this.plugin.resetFocusPeekSize();
          new Notice(t('notice.peekSizeReset'));
        }));

    new Setting(containerEl)
      .setName(t('settings.explorerAutoReveal'))
      .setDesc(t('settings.explorerAutoRevealDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableExplorerAutoReveal)
        .onChange(async (value) => {
          this.plugin.settings.enableExplorerAutoReveal = value;
          await this.plugin.saveSettings();
        }));


    new Setting(containerEl)
      .setName(t('settings.folderStructure'))
      .setHeading();

    new Setting(containerEl)
        .setName(t('settings.characterFolder'))
        .setDesc(t('settings.characterFolderDesc'))
        .addText(text => text
            .setValue(this.plugin.settings.characterFolder)
            .onChange(async (value) => {
                this.plugin.settings.characterFolder = value;
                await this.plugin.saveSettings();
            }));

    new Setting(containerEl)
        .setName(t('settings.locationFolder'))
        .setDesc(t('settings.locationFolderDesc'))
        .addText(text => text
            .setValue(this.plugin.settings.locationFolder)
            .onChange(async (value) => {
                this.plugin.settings.locationFolder = value;
                await this.plugin.saveSettings();
            }));

    new Setting(containerEl)
        .setName(t('settings.chapterFolder'))
        .setDesc(t('settings.chapterFolderDesc'))
        .addText(text => text
            .setValue(this.plugin.settings.chapterFolder)
            .onChange(async (value) => {
                this.plugin.settings.chapterFolder = value;
                await this.plugin.saveSettings();
            }));

    new Setting(containerEl)
        .setName(t('settings.imageFolder'))
        .setDesc(t('settings.imageFolderDesc'))
        .addText(text => text
            .setValue(this.plugin.settings.imageFolder)
            .onChange(async (value) => {
                this.plugin.settings.imageFolder = value;
                await this.plugin.saveSettings();
            }));

    new Setting(containerEl)
        .setName(t('settings.itemFolder'))
        .setDesc(t('settings.itemFolderDesc'))
        .addText(text => text
            .setValue(this.plugin.settings.itemFolder)
            .onChange(async (value) => {
                this.plugin.settings.itemFolder = value;
                await this.plugin.saveSettings();
            }));

    new Setting(containerEl)
        .setName(t('settings.loreFolder'))
        .setDesc(t('settings.loreFolderDesc'))
        .addText(text => text
            .setValue(this.plugin.settings.loreFolder)
            .onChange(async (value) => {
                this.plugin.settings.loreFolder = value;
                await this.plugin.saveSettings();
            }));

    // ── Templates ──────────────────────────────────────────────────
    new Setting(containerEl)
      .setName(t('template.templates'))
      .setHeading();

    const tplCategoryOptions: Record<TemplateCategory, string> = {
      character: t('template.characterTemplates'),
      location: t('template.locationTemplates'),
      item: t('template.itemTemplates'),
      lore: t('template.loreTemplates'),
    };

    const tplGroupEl = containerEl.createDiv('novalist-template-group');

    new Setting(tplGroupEl)
      .setName(t('template.entityType'))
      .setDesc(t('template.entityTypeDesc'))
      .addDropdown(dropdown => {
        for (const [key, label] of Object.entries(tplCategoryOptions)) {
          dropdown.addOption(key, label);
        }
        dropdown.setValue(this.selectedTemplateCategory);
        dropdown.onChange((value) => {
          this.selectedTemplateCategory = value as TemplateCategory;
          this.renderTemplatesForCategory(tplContentEl);
        });
      });

    const tplContentEl = tplGroupEl.createDiv('novalist-template-content');
    this.renderTemplatesForCategory(tplContentEl);

    const roleSection = containerEl.createDiv('novalist-role-colors');
    void this.renderRoleColorSettings(roleSection);

    const genderSection = containerEl.createDiv('novalist-gender-colors');
    void this.renderGenderColorSettings(genderSection);

    new Setting(containerEl)
      .setName(t('settings.autoReplacements'))
      .setHeading();
    containerEl.createEl('p', { text: t('settings.autoReplacementsDesc') });

    new Setting(containerEl)
      .setName(t('settings.language'))
      .setDesc(t('settings.languageDesc'))
      .addDropdown((dropdown) => {
        const languageLabels = getLanguageLabels();
        for (const [key, label] of Object.entries(languageLabels)) {
          dropdown.addOption(key, label);
        }
        dropdown.setValue(this.plugin.settings.language);
        dropdown.onChange(async (value) => {
          if (!(value in languageLabels)) return;
          const nextLanguage = value as LanguageKey;
          this.plugin.settings.language = nextLanguage;
          if (nextLanguage !== 'custom') {
            const defaults = LANGUAGE_DEFAULTS[nextLanguage];
            this.plugin.settings.autoReplacements = cloneAutoReplacements(defaults);
          }
          await this.plugin.saveSettings();
          this.display();
        });
      });

    const isCustomLanguage = this.plugin.settings.language === 'custom';
    if (!isCustomLanguage) {
      containerEl.createEl('p', { text: t('settings.switchToCustom') });
    }

    const replacementContainer = containerEl.createDiv('novalist-replacements');
    const header = replacementContainer.createDiv('novalist-replacement-header');
    header.createEl('span', { text: t('settings.startToken') });
    header.createEl('span', { text: t('settings.endToken') });
    header.createEl('span', { text: t('settings.startReplacement') });
    header.createEl('span', { text: t('settings.endReplacement') });
    header.createEl('span', { text: '' });

    const updatePair = async (): Promise<void> => {
      await this.plugin.saveSettings();
    };

    for (const pair of this.plugin.settings.autoReplacements) {
      const row = replacementContainer.createDiv('novalist-replacement-row');

      const startInput = row.createEl('input', { type: 'text', value: pair.start });
      startInput.placeholder = t('settings.startTokenPlaceholder');
      startInput.disabled = !isCustomLanguage;
      startInput.addEventListener('input', () => {
        pair.start = startInput.value;
        void updatePair();
      });

      const endInput = row.createEl('input', { type: 'text', value: pair.end });
      endInput.placeholder = t('settings.endTokenPlaceholder');
      endInput.disabled = !isCustomLanguage;
      endInput.addEventListener('input', () => {
        pair.end = endInput.value;
        void updatePair();
      });

      const startReplaceInput = row.createEl('input', { type: 'text', value: pair.startReplace });
      startReplaceInput.placeholder = t('settings.startReplacementPlaceholder');
      startReplaceInput.disabled = !isCustomLanguage;
      startReplaceInput.addEventListener('input', () => {
        pair.startReplace = startReplaceInput.value;
        void updatePair();
      });

      const endReplaceInput = row.createEl('input', { type: 'text', value: pair.endReplace });
      endReplaceInput.placeholder = t('settings.endTokenPlaceholder');
      endReplaceInput.disabled = !isCustomLanguage;
      endReplaceInput.addEventListener('input', () => {
        pair.endReplace = endReplaceInput.value;
        void updatePair();
      });

      const actions = row.createDiv();
      const deleteButton = new ButtonComponent(actions)
        .setIcon('trash')
        .setTooltip(t('settings.removeReplacement'));
      deleteButton.setDisabled(!isCustomLanguage);
      deleteButton.onClick(async () => {
        this.plugin.settings.autoReplacements = this.plugin.settings.autoReplacements.filter(p => p !== pair);
        await this.plugin.saveSettings();
        this.display();
      });
    }

    if (isCustomLanguage) {
      new ButtonComponent(containerEl)
        .setButtonText(t('settings.addReplacement'))
        .onClick(async () => {
          this.plugin.settings.autoReplacements.push({ start: '', end: '', startReplace: '', endReplace: '' });
          await this.plugin.saveSettings();
          this.display();
        });
    }

    new Setting(containerEl)
      .setName(t('settings.formatting'))
      .setHeading();

    new Setting(containerEl)
      .setName(t('settings.bookParagraphSpacing'))
      .setDesc(t('settings.bookParagraphSpacingDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableBookParagraphSpacing)
        .onChange(async (value) => {
          this.plugin.settings.enableBookParagraphSpacing = value;
          await this.plugin.saveSettings();
          this.plugin.updateBookParagraphSpacing();
        }));

    new Setting(containerEl)
      .setName(t('settings.writingGoals'))
      .setHeading();

    new Setting(containerEl)
      .setName(t('settings.dailyWordGoal'))
      .setDesc(t('settings.dailyWordGoalDesc'))
      .addText(text => text
        .setPlaceholder('1000')
        .setValue(String(this.plugin.settings.wordCountGoals.dailyGoal))
        .onChange(async (value) => {
          const num = parseInt(value, 10);
          if (!isNaN(num) && num > 0) {
            this.plugin.settings.wordCountGoals.dailyGoal = num;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName(t('settings.projectWordGoal'))
      .setDesc(t('settings.projectWordGoalDesc'))
      .addText(text => text
        .setPlaceholder('50000')
        .setValue(String(this.plugin.settings.wordCountGoals.projectGoal))
        .onChange(async (value) => {
          const num = parseInt(value, 10);
          if (!isNaN(num) && num > 0) {
            this.plugin.settings.wordCountGoals.projectGoal = num;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName(t('settings.projectDeadline'))
      .setDesc(t('settings.projectDeadlineDesc'))
      .addText(text => text
        .setPlaceholder(t('settings.projectDeadlinePlaceholder'))
        .setValue(this.plugin.settings.wordCountGoals.deadline || '')
        .onChange(async (value) => {
          // Validate date format if provided
          if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return;
          }
          this.plugin.settings.wordCountGoals.deadline = value || undefined;
          await this.plugin.saveSettings();
        }));

    // ── AI Assistant ──────────────────────────────────────────────
    new Setting(containerEl)
      .setName(t('ollama.settings'))
      .setHeading();

    new Setting(containerEl)
      .setName(t('ollama.enable'))
      .setDesc(t('ollama.enableDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.ollama.enabled)
        .onChange(async (value) => {
          this.plugin.settings.ollama.enabled = value;
          await this.plugin.saveSettings();
          if (!value) {
            this.plugin.closeAiViews();
          }
          this.display();
        }));

    if (this.plugin.settings.ollama.enabled) {
      const ollamaSection = containerEl.createDiv('novalist-ollama-settings');
      this.renderOllamaSettings(ollamaSection);
    }
  }

  private renderOllamaSettings(containerEl: HTMLElement): void {
    const provider = this.plugin.settings.ollama.provider;

    // Provider selector
    new Setting(containerEl)
      .setName(t('ollama.provider'))
      .setDesc(t('ollama.providerDesc'))
      .addDropdown(dd => dd
        .addOption('ollama', t('ollama.providerOllama'))
        .addOption('copilot', t('ollama.providerCopilot'))
        .setValue(provider)
        .onChange(async (value) => {
          this.plugin.settings.ollama.provider = value as 'ollama' | 'copilot';
          await this.plugin.saveSettings();
          if (this.plugin.ollamaService) {
            this.plugin.ollamaService.setProvider(value as 'ollama' | 'copilot');
          }
          this.display();
        }));

    // Analysis mode selector
    new Setting(containerEl)
      .setName(t('ollama.analysisMode'))
      .setDesc(t('ollama.analysisModeDesc'))
      .addDropdown(dd => dd
        .addOption('paragraph', t('ollama.analysisModeP'))
        .addOption('chapter', t('ollama.analysisModeC'))
        .setValue(this.plugin.settings.ollama.analysisMode)
        .onChange(async (value) => {
          this.plugin.settings.ollama.analysisMode = value as 'paragraph' | 'chapter';
          await this.plugin.saveSettings();
          if (this.plugin.ollamaService) {
            this.plugin.ollamaService.setAnalysisMode(value as 'paragraph' | 'chapter');
          }
        }));

    // ── Provider-specific settings ──────────────────────────────
    if (provider === 'ollama') {
      this.renderOllamaProviderSettings(containerEl);
    } else {
      this.renderCopilotProviderSettings(containerEl);
    }

    // ── Shared check toggles ──────────────────────────────────────
    new Setting(containerEl)
      .setName(t('ollama.checkReferences'))
      .setDesc(t('ollama.checkReferencesDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.ollama.checkReferences)
        .onChange(async (value) => {
          this.plugin.settings.ollama.checkReferences = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(t('ollama.checkInconsistencies'))
      .setDesc(t('ollama.checkInconsistenciesDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.ollama.checkInconsistencies)
        .onChange(async (value) => {
          this.plugin.settings.ollama.checkInconsistencies = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(t('ollama.checkSuggestions'))
      .setDesc(t('ollama.checkSuggestionsDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.ollama.checkSuggestions)
        .onChange(async (value) => {
          this.plugin.settings.ollama.checkSuggestions = value;
          await this.plugin.saveSettings();
        }));
  }

  /** Render settings specific to the Ollama provider. */
  private renderOllamaProviderSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t('ollama.baseUrl'))
      .setDesc(t('ollama.baseUrlDesc'))
      .addText(text => text
        .setPlaceholder(t('ollama.baseUrlPlaceholder'))
        .setValue(this.plugin.settings.ollama.baseUrl)
        .onChange(async (value) => {
          this.plugin.settings.ollama.baseUrl = value;
          await this.plugin.saveSettings();
          if (this.plugin.ollamaService) {
            this.plugin.ollamaService.setBaseUrl(value);
          }
        }));

    // Server status indicator
    const statusSetting = new Setting(containerEl)
      .setName(t('ollama.serverStatus'));
    const statusDesc = statusSetting.descEl;
    statusDesc.setText(t('ollama.serverOffline'));
    statusDesc.addClass('novalist-ollama-status');

    // Model selector + refresh
    const modelSetting = new Setting(containerEl)
      .setName(t('ollama.model'))
      .setDesc(t('ollama.modelDesc'));

    const modelDropdown = modelSetting.controlEl.createEl('select', { cls: 'dropdown' });
    const refreshBtn = modelSetting.controlEl.createEl('button', { text: t('ollama.refreshModels'), cls: 'mod-cta' });
    refreshBtn.setCssProps({ 'margin-left': '8px' });

    const populateModels = async (): Promise<void> => {
      modelDropdown.empty();
      if (!this.plugin.ollamaService) return;
      const online = await this.plugin.ollamaService.isServerRunning();
      statusDesc.setText(online ? t('ollama.serverOnline') : t('ollama.serverOffline'));
      statusDesc.toggleClass('mod-success', online);
      statusDesc.toggleClass('mod-warning', !online);
      if (!online) {
        const opt = modelDropdown.createEl('option', { text: t('ollama.noModels'), value: '' });
        opt.selected = true;
        return;
      }
      const models = await this.plugin.ollamaService.listModels();
      if (models.length === 0) {
        const opt = modelDropdown.createEl('option', { text: t('ollama.noModels'), value: '' });
        opt.selected = true;
        return;
      }
      for (const m of models) {
        const opt = modelDropdown.createEl('option', { text: m.name, value: m.name });
        if (m.name === this.plugin.settings.ollama.model) opt.selected = true;
      }
      // If current model not in list, select first
      if (!models.some(m => m.name === this.plugin.settings.ollama.model) && models.length > 0) {
        this.plugin.settings.ollama.model = models[0].name;
        if (this.plugin.ollamaService) this.plugin.ollamaService.setModel(models[0].name);
        await this.plugin.saveSettings();
      }
    };

    modelDropdown.addEventListener('change', () => {
      this.plugin.settings.ollama.model = modelDropdown.value;
      if (this.plugin.ollamaService) this.plugin.ollamaService.setModel(modelDropdown.value);
      void this.plugin.saveSettings();
    });

    refreshBtn.addEventListener('click', () => { void populateModels(); });

    new Setting(containerEl)
      .setName(t('ollama.autoManage'))
      .setDesc(t('ollama.autoManageDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.ollama.autoManageModel)
        .onChange(async (value) => {
          this.plugin.settings.ollama.autoManageModel = value;
          await this.plugin.saveSettings();
        }));

    // Load / Unload buttons
    const modelMgmt = new Setting(containerEl);
    modelMgmt.addButton(btn => btn
      .setButtonText(t('ollama.loadModel'))
      .setCta()
      .onClick(async () => {
        if (!this.plugin.ollamaService || !this.plugin.settings.ollama.model) return;
        new Notice(t('ollama.loadingModel'));
        const ok = await this.plugin.ollamaService.loadModel();
        new Notice(ok ? t('ollama.modelLoadSuccess') : t('ollama.modelLoadFail'));
      }));
    modelMgmt.addButton(btn => btn
      .setButtonText(t('ollama.unloadModel'))
      .onClick(async () => {
        if (!this.plugin.ollamaService) return;
        const ok = await this.plugin.ollamaService.unloadModel();
        new Notice(ok ? t('ollama.modelUnloaded') : t('ollama.modelUnloadFail'));
      }));

    // Run initial population
    void populateModels();
  }

  /** Render settings specific to the GitHub Copilot provider. */
  private renderCopilotProviderSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t('ollama.copilotPath'))
      .setDesc(t('ollama.copilotPathDesc'))
      .addText(text => text
        .setPlaceholder(t('ollama.copilotPathPlaceholder'))
        .setValue(this.plugin.settings.ollama.copilotPath)
        .onChange(async (value) => {
          this.plugin.settings.ollama.copilotPath = value;
          await this.plugin.saveSettings();
          if (this.plugin.ollamaService) {
            this.plugin.ollamaService.setCopilotPath(value);
          }
        }));

    // Status + verify
    const statusSetting = new Setting(containerEl)
      .setName(t('ollama.copilotStatus'));
    const statusDesc = statusSetting.descEl;
    statusDesc.setText(t('ollama.copilotChecking'));
    statusDesc.addClass('novalist-ollama-status');

    const verifyCopilot = async (): Promise<void> => {
      statusDesc.setText(t('ollama.copilotChecking'));
      statusDesc.toggleClass('mod-success', false);
      statusDesc.toggleClass('mod-warning', false);
      if (!this.plugin.ollamaService) return;
      const ok = await this.plugin.ollamaService.isCopilotAvailable();
      statusDesc.setText(ok ? t('ollama.copilotReady') : t('ollama.copilotNotFound'));
      statusDesc.toggleClass('mod-success', ok);
      statusDesc.toggleClass('mod-warning', !ok);
    };

    statusSetting.addButton(btn => btn
      .setButtonText(t('ollama.copilotVerify'))
      .setCta()
      .onClick(() => { void verifyCopilot(); }));

    void verifyCopilot();

    // ── Copilot model selector ──
    const copilotModelSetting = new Setting(containerEl)
      .setName(t('ollama.copilotModel'))
      .setDesc(t('ollama.copilotModelDesc'));

    const copilotModelDropdown = copilotModelSetting.controlEl.createEl('select', { cls: 'dropdown' });
    const copilotRefreshBtn = copilotModelSetting.controlEl.createEl('button', {
      text: t('ollama.copilotModelRefresh'),
      cls: 'mod-cta',
    });
    copilotRefreshBtn.setCssProps({ 'margin-left': '8px' });

    // Default option always present
    const addDefaultOption = (): void => {
      const opt = copilotModelDropdown.createEl('option', {
        text: t('ollama.copilotModelDefault'),
        value: '',
      });
      if (!this.plugin.settings.ollama.copilotModel) opt.selected = true;
    };

    const populateCopilotModels = async (): Promise<void> => {
      copilotModelDropdown.empty();
      addDefaultOption();
      if (!this.plugin.ollamaService) return;
      copilotModelDropdown.disabled = true;
      copilotRefreshBtn.disabled = true;
      try {
        const models = await this.plugin.ollamaService.listCopilotModels();
        if (models.length === 0) {
          const opt = copilotModelDropdown.createEl('option', {
            text: t('ollama.copilotNoModels'),
            value: '__none__',
          });
          opt.disabled = true;
        } else {
          for (const m of models) {
            const opt = copilotModelDropdown.createEl('option', {
              text: m.name,
              value: m.id,
            });
            if (m.id === this.plugin.settings.ollama.copilotModel) opt.selected = true;
          }
        }
      } finally {
        copilotModelDropdown.disabled = false;
        copilotRefreshBtn.disabled = false;
      }
    };

    copilotModelDropdown.addEventListener('change', () => {
      this.plugin.settings.ollama.copilotModel = copilotModelDropdown.value;
      if (this.plugin.ollamaService) {
        void this.plugin.ollamaService.setCopilotModel(copilotModelDropdown.value);
      }
      void this.plugin.saveSettings();
    });

    copilotRefreshBtn.addEventListener('click', () => { void populateCopilotModels(); });

    void populateCopilotModels();
  }

  private renderTemplatesForCategory(containerEl: HTMLElement): void {
    switch (this.selectedTemplateCategory) {
      case 'character': this.renderCharacterTemplates(containerEl); break;
      case 'location': this.renderLocationTemplates(containerEl); break;
      case 'item': this.renderItemTemplates(containerEl); break;
      case 'lore': this.renderLoreTemplates(containerEl); break;
    }
  }

  private renderCharacterTemplates(containerEl: HTMLElement): void {
    containerEl.empty();

    containerEl.createEl('p', { text: t('template.characterTemplatesDesc') });

    for (const tpl of this.plugin.settings.characterTemplates) {
      const isActive = tpl.id === this.plugin.settings.activeCharacterTemplateId;
      const row = new Setting(containerEl)
        .setName(tpl.name + (tpl.builtIn ? ` (${t('template.builtIn')})` : ''));

      if (isActive) {
        row.setDesc(t('template.active'));
      }

      if (!isActive) {
        row.addButton(btn => btn
          .setButtonText(t('template.setActive'))
          .onClick(async () => {
            this.plugin.settings.activeCharacterTemplateId = tpl.id;
            await this.plugin.saveSettings();
            this.renderCharacterTemplates(containerEl);
          }));
      }

      row.addButton(btn => btn
        .setIcon('pencil')
        .setTooltip(t('template.edit'))
        .onClick(() => {
          new CharacterTemplateEditorModal(this.app, this.plugin, tpl, async (updated) => {
            const idx = this.plugin.settings.characterTemplates.findIndex(t => t.id === tpl.id);
            if (idx !== -1) {
              this.plugin.settings.characterTemplates[idx] = updated;
              await this.plugin.saveSettings();
              this.renderCharacterTemplates(containerEl);
            }
          }).open();
        }));

      row.addButton(btn => btn
        .setIcon('copy')
        .setTooltip(t('template.duplicate'))
        .onClick(async () => {
          const clone = cloneCharacterTemplate(tpl);
          clone.id = `tpl-${Date.now()}`;
          clone.name = `${tpl.name} (${t('template.copy')})`;
          clone.builtIn = false;
          this.plugin.settings.characterTemplates.push(clone);
          await this.plugin.saveSettings();
          this.renderCharacterTemplates(containerEl);
        }));

      if (!tpl.builtIn) {
        row.addButton(btn => btn
          .setIcon('trash')
          .setTooltip(t('template.delete'))
          .onClick(async () => {
            this.plugin.settings.characterTemplates = this.plugin.settings.characterTemplates.filter(t => t.id !== tpl.id);
            if (this.plugin.settings.activeCharacterTemplateId === tpl.id) {
              this.plugin.settings.activeCharacterTemplateId = 'default';
            }
            await this.plugin.saveSettings();
            this.renderCharacterTemplates(containerEl);
          }));
      }
    }

    new ButtonComponent(containerEl)
      .setButtonText(t('template.addTemplate'))
      .onClick(async () => {
        const newTpl = cloneCharacterTemplate(DEFAULT_CHARACTER_TEMPLATE);
        newTpl.id = `tpl-${Date.now()}`;
        newTpl.name = t('template.newTemplate');
        newTpl.builtIn = false;
        this.plugin.settings.characterTemplates.push(newTpl);
        await this.plugin.saveSettings();
        this.renderCharacterTemplates(containerEl);
      });
  }

  private renderLocationTemplates(containerEl: HTMLElement): void {
    containerEl.empty();

    containerEl.createEl('p', { text: t('template.locationTemplatesDesc') });

    for (const tpl of this.plugin.settings.locationTemplates) {
      const isActive = tpl.id === this.plugin.settings.activeLocationTemplateId;
      const row = new Setting(containerEl)
        .setName(tpl.name + (tpl.builtIn ? ` (${t('template.builtIn')})` : ''));

      if (isActive) {
        row.setDesc(t('template.active'));
      }

      if (!isActive) {
        row.addButton(btn => btn
          .setButtonText(t('template.setActive'))
          .onClick(async () => {
            this.plugin.settings.activeLocationTemplateId = tpl.id;
            await this.plugin.saveSettings();
            this.renderLocationTemplates(containerEl);
          }));
      }

      row.addButton(btn => btn
        .setIcon('pencil')
        .setTooltip(t('template.edit'))
        .onClick(() => {
          new LocationTemplateEditorModal(this.app, this.plugin, tpl, async (updated) => {
            const idx = this.plugin.settings.locationTemplates.findIndex(t => t.id === tpl.id);
            if (idx !== -1) {
              this.plugin.settings.locationTemplates[idx] = updated;
              await this.plugin.saveSettings();
              this.renderLocationTemplates(containerEl);
            }
          }).open();
        }));

      row.addButton(btn => btn
        .setIcon('copy')
        .setTooltip(t('template.duplicate'))
        .onClick(async () => {
          const clone = cloneLocationTemplate(tpl);
          clone.id = `tpl-${Date.now()}`;
          clone.name = `${tpl.name} (${t('template.copy')})`;
          clone.builtIn = false;
          this.plugin.settings.locationTemplates.push(clone);
          await this.plugin.saveSettings();
          this.renderLocationTemplates(containerEl);
        }));

      if (!tpl.builtIn) {
        row.addButton(btn => btn
          .setIcon('trash')
          .setTooltip(t('template.delete'))
          .onClick(async () => {
            this.plugin.settings.locationTemplates = this.plugin.settings.locationTemplates.filter(t => t.id !== tpl.id);
            if (this.plugin.settings.activeLocationTemplateId === tpl.id) {
              this.plugin.settings.activeLocationTemplateId = 'default';
            }
            await this.plugin.saveSettings();
            this.renderLocationTemplates(containerEl);
          }));
      }
    }

    new ButtonComponent(containerEl)
      .setButtonText(t('template.addTemplate'))
      .onClick(async () => {
        const newTpl = cloneLocationTemplate(DEFAULT_LOCATION_TEMPLATE);
        newTpl.id = `tpl-${Date.now()}`;
        newTpl.name = t('template.newTemplate');
        newTpl.builtIn = false;
        this.plugin.settings.locationTemplates.push(newTpl);
        await this.plugin.saveSettings();
        this.renderLocationTemplates(containerEl);
      });
  }

  private renderItemTemplates(containerEl: HTMLElement): void {
    containerEl.empty();

    containerEl.createEl('p', { text: t('template.itemTemplatesDesc') });

    for (const tpl of this.plugin.settings.itemTemplates) {
      const isActive = tpl.id === this.plugin.settings.activeItemTemplateId;
      const row = new Setting(containerEl)
        .setName(tpl.name + (tpl.builtIn ? ` (${t('template.builtIn')})` : ''));

      if (isActive) {
        row.setDesc(t('template.active'));
      }

      if (!isActive) {
        row.addButton(btn => btn
          .setButtonText(t('template.setActive'))
          .onClick(async () => {
            this.plugin.settings.activeItemTemplateId = tpl.id;
            await this.plugin.saveSettings();
            this.renderItemTemplates(containerEl);
          }));
      }

      row.addButton(btn => btn
        .setIcon('pencil')
        .setTooltip(t('template.edit'))
        .onClick(() => {
          new ItemTemplateEditorModal(this.app, this.plugin, tpl, async (updated) => {
            const idx = this.plugin.settings.itemTemplates.findIndex(t => t.id === tpl.id);
            if (idx !== -1) {
              this.plugin.settings.itemTemplates[idx] = updated;
              await this.plugin.saveSettings();
              this.renderItemTemplates(containerEl);
            }
          }).open();
        }));

      row.addButton(btn => btn
        .setIcon('copy')
        .setTooltip(t('template.duplicate'))
        .onClick(async () => {
          const clone = cloneItemTemplate(tpl);
          clone.id = `tpl-${Date.now()}`;
          clone.name = `${tpl.name} (${t('template.copy')})`;
          clone.builtIn = false;
          this.plugin.settings.itemTemplates.push(clone);
          await this.plugin.saveSettings();
          this.renderItemTemplates(containerEl);
        }));

      if (!tpl.builtIn) {
        row.addButton(btn => btn
          .setIcon('trash')
          .setTooltip(t('template.delete'))
          .onClick(async () => {
            this.plugin.settings.itemTemplates = this.plugin.settings.itemTemplates.filter(t => t.id !== tpl.id);
            if (this.plugin.settings.activeItemTemplateId === tpl.id) {
              this.plugin.settings.activeItemTemplateId = 'default';
            }
            await this.plugin.saveSettings();
            this.renderItemTemplates(containerEl);
          }));
      }
    }

    new ButtonComponent(containerEl)
      .setButtonText(t('template.addTemplate'))
      .onClick(async () => {
        const newTpl = cloneItemTemplate(DEFAULT_ITEM_TEMPLATE);
        newTpl.id = `tpl-${Date.now()}`;
        newTpl.name = t('template.newTemplate');
        newTpl.builtIn = false;
        this.plugin.settings.itemTemplates.push(newTpl);
        await this.plugin.saveSettings();
        this.renderItemTemplates(containerEl);
      });
  }

  private renderLoreTemplates(containerEl: HTMLElement): void {
    containerEl.empty();

    containerEl.createEl('p', { text: t('template.loreTemplatesDesc') });

    for (const tpl of this.plugin.settings.loreTemplates) {
      const isActive = tpl.id === this.plugin.settings.activeLoreTemplateId;
      const row = new Setting(containerEl)
        .setName(tpl.name + (tpl.builtIn ? ` (${t('template.builtIn')})` : ''));

      if (isActive) {
        row.setDesc(t('template.active'));
      }

      if (!isActive) {
        row.addButton(btn => btn
          .setButtonText(t('template.setActive'))
          .onClick(async () => {
            this.plugin.settings.activeLoreTemplateId = tpl.id;
            await this.plugin.saveSettings();
            this.renderLoreTemplates(containerEl);
          }));
      }

      row.addButton(btn => btn
        .setIcon('pencil')
        .setTooltip(t('template.edit'))
        .onClick(() => {
          new LoreTemplateEditorModal(this.app, this.plugin, tpl, async (updated) => {
            const idx = this.plugin.settings.loreTemplates.findIndex(t => t.id === tpl.id);
            if (idx !== -1) {
              this.plugin.settings.loreTemplates[idx] = updated;
              await this.plugin.saveSettings();
              this.renderLoreTemplates(containerEl);
            }
          }).open();
        }));

      row.addButton(btn => btn
        .setIcon('copy')
        .setTooltip(t('template.duplicate'))
        .onClick(async () => {
          const clone = cloneLoreTemplate(tpl);
          clone.id = `tpl-${Date.now()}`;
          clone.name = `${tpl.name} (${t('template.copy')})`;
          clone.builtIn = false;
          this.plugin.settings.loreTemplates.push(clone);
          await this.plugin.saveSettings();
          this.renderLoreTemplates(containerEl);
        }));

      if (!tpl.builtIn) {
        row.addButton(btn => btn
          .setIcon('trash')
          .setTooltip(t('template.delete'))
          .onClick(async () => {
            this.plugin.settings.loreTemplates = this.plugin.settings.loreTemplates.filter(t => t.id !== tpl.id);
            if (this.plugin.settings.activeLoreTemplateId === tpl.id) {
              this.plugin.settings.activeLoreTemplateId = 'default';
            }
            await this.plugin.saveSettings();
            this.renderLoreTemplates(containerEl);
          }));
      }
    }

    new ButtonComponent(containerEl)
      .setButtonText(t('template.addTemplate'))
      .onClick(async () => {
        const newTpl = cloneLoreTemplate(DEFAULT_LORE_TEMPLATE);
        newTpl.id = `tpl-${Date.now()}`;
        newTpl.name = t('template.newTemplate');
        newTpl.builtIn = false;
        this.plugin.settings.loreTemplates.push(newTpl);
        await this.plugin.saveSettings();
        this.renderLoreTemplates(containerEl);
      });
  }

  private async renderRoleColorSettings(containerEl: HTMLElement): Promise<void> {
    containerEl.empty();
    new Setting(containerEl)
      .setName(t('settings.roleColors'))
      .setHeading();
    containerEl.createEl('p', { text: t('settings.roleColorsDesc') });

    const fallbackColor = '#64748b';
    const roles = await this.getKnownRoles();

    if (roles.length === 0) {
      containerEl.createEl('p', { text: t('settings.noRolesFound') });
      return;
    }

    for (const roleLabel of roles) {
      const row = new Setting(containerEl)
        .setName(roleLabel);

      const stored = this.plugin.settings.roleColors[roleLabel];

      row.addColorPicker((picker) => {
        picker.setValue(stored || fallbackColor);
        picker.onChange(async (value) => {
          this.plugin.settings.roleColors[roleLabel] = value;
          await this.plugin.saveSettings();
        });
      });

      row.addButton((btn) => {
        btn.setIcon('rotate-ccw');
        btn.setTooltip(t('settings.restoreDefaultColor'));
        btn.setDisabled(!stored);
        btn.onClick(async () => {
          delete this.plugin.settings.roleColors[roleLabel];
          await this.plugin.saveSettings();
          void this.renderRoleColorSettings(containerEl);
        });
      });
    }
  }

  private async renderGenderColorSettings(containerEl: HTMLElement): Promise<void> {
    containerEl.empty();
    new Setting(containerEl)
      .setName(t('settings.genderColors'))
      .setHeading();
    containerEl.createEl('p', { text: t('settings.genderColorsDesc') });

    const fallbackColor = '#64748b';
    const genders = await this.getKnownGenders();

    if (genders.length === 0) {
      containerEl.createEl('p', { text: t('settings.noGendersFound') });
      return;
    }

    for (const genderLabel of genders) {
      const row = new Setting(containerEl)
        .setName(genderLabel);

      const stored = this.plugin.settings.genderColors[genderLabel];

      row.addColorPicker((picker) => {
        picker.setValue(stored || fallbackColor);
        picker.onChange(async (value) => {
          this.plugin.settings.genderColors[genderLabel] = value;
          await this.plugin.saveSettings();
        });
      });

      row.addButton((btn) => {
        btn.setIcon('rotate-ccw');
        btn.setTooltip(t('settings.restoreDefaultColor'));
        btn.setDisabled(!stored);
        btn.onClick(async () => {
          delete this.plugin.settings.genderColors[genderLabel];
          await this.plugin.saveSettings();
          void this.renderGenderColorSettings(containerEl);
        });
      });
    }
  }

  private async getKnownRoles(): Promise<string[]> {
    const roles = new Set<string>();

    for (const role of Object.keys(this.plugin.settings.roleColors)) {
      const trimmed = role.trim();
      if (trimmed) roles.add(trimmed);
    }

    const characters = await this.plugin.getCharacterList();
    for (const character of characters) {
      const trimmed = character.role?.trim();
      if (trimmed) roles.add(trimmed);
    }

    return Array.from(roles).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  private async getKnownGenders(): Promise<string[]> {
    const genders = new Set<string>();

    for (const gender of Object.keys(this.plugin.settings.genderColors)) {
      const trimmed = gender.trim();
      if (trimmed) genders.add(trimmed);
    }

    const characters = await this.plugin.getCharacterList();
    for (const character of characters) {
      const trimmed = character.gender?.trim();
      if (trimmed) genders.add(trimmed);
    }

    return Array.from(genders).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }
}
