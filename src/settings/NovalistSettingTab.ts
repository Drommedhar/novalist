import {
  PluginSettingTab,
  App,
  Setting,
  ButtonComponent
} from 'obsidian';
import type NovalistPlugin from '../main';
import {
  getLanguageLabels,
  LANGUAGE_DEFAULTS,
  cloneAutoReplacements,
  DEFAULT_CHARACTER_TEMPLATE,
  DEFAULT_LOCATION_TEMPLATE,
  cloneCharacterTemplate,
  cloneLocationTemplate
} from './NovalistSettings';
import { LanguageKey } from '../types';
import { t } from '../i18n';
import { CharacterTemplateEditorModal, LocationTemplateEditorModal } from '../modals/TemplateEditorModal';
import { ProjectAddModal, ProjectRenameModal } from '../modals/ProjectModals';

export class NovalistSettingTab extends PluginSettingTab {
  plugin: NovalistPlugin;

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

    // ── Templates ──────────────────────────────────────────────────
    const charTplSection = containerEl.createDiv('novalist-char-templates');
    this.renderCharacterTemplates(charTplSection);

    const locTplSection = containerEl.createDiv('novalist-loc-templates');
    this.renderLocationTemplates(locTplSection);

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
  }

  private renderCharacterTemplates(containerEl: HTMLElement): void {
    containerEl.empty();

    new Setting(containerEl)
      .setName(t('template.characterTemplates'))
      .setHeading();
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

    new Setting(containerEl)
      .setName(t('template.locationTemplates'))
      .setHeading();
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
