import {
  PluginSettingTab,
  App,
  Setting,
  ButtonComponent
} from 'obsidian';
import type NovalistPlugin from '../main';
import {
  LANGUAGE_LABELS,
  LANGUAGE_DEFAULTS,
  cloneAutoReplacements
} from './NovalistSettings';
import { LanguageKey } from '../types';

export class NovalistSettingTab extends PluginSettingTab {
  plugin: NovalistPlugin;

  constructor(app: App, plugin: NovalistPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Preferences')
      .setHeading();

    new Setting(containerEl)
      .setName('Project path')
      .setDesc('Root folder for your novel project')
      .addText(text => text
        .setPlaceholder('Novel project')
        .setValue(this.plugin.settings.projectPath)
        .onChange(async (value) => {
          this.plugin.settings.projectPath = value;
          await this.plugin.saveSettings();
        }));


    new Setting(containerEl)
      .setName('Folder structure')
      .setHeading();

    new Setting(containerEl)
        .setName('Character folder')
        .setDesc('Folder for character files')
        .addText(text => text
            .setValue(this.plugin.settings.characterFolder)
            .onChange(async (value) => {
                this.plugin.settings.characterFolder = value;
                await this.plugin.saveSettings();
            }));

    new Setting(containerEl)
        .setName('Location folder')
        .setDesc('Folder for location files')
        .addText(text => text
            .setValue(this.plugin.settings.locationFolder)
            .onChange(async (value) => {
                this.plugin.settings.locationFolder = value;
                await this.plugin.saveSettings();
            }));

    new Setting(containerEl)
        .setName('Chapter folder')
        .setDesc('Folder for chapter files')
        .addText(text => text
            .setValue(this.plugin.settings.chapterFolder)
            .onChange(async (value) => {
                this.plugin.settings.chapterFolder = value;
                await this.plugin.saveSettings();
            }));

    new Setting(containerEl)
        .setName('Image folder')
        .setDesc('Folder for project images')
        .addText(text => text
            .setValue(this.plugin.settings.imageFolder)
            .onChange(async (value) => {
                this.plugin.settings.imageFolder = value;
                await this.plugin.saveSettings();
            }));

    const roleSection = containerEl.createDiv('novalist-role-colors');
    void this.renderRoleColorSettings(roleSection);

    const genderSection = containerEl.createDiv('novalist-gender-colors');
    void this.renderGenderColorSettings(genderSection);

    new Setting(containerEl)
      .setName('Auto replacements')
      .setHeading();
    containerEl.createEl('p', { text: 'Configure text shortcuts that will be auto-replaced while typing.' });

    new Setting(containerEl)
      .setName('Language')
      .setDesc('Choose default replacements for quotes and punctuation.')
      .addDropdown((dropdown) => {
        for (const [key, label] of Object.entries(LANGUAGE_LABELS)) {
          dropdown.addOption(key, label);
        }
        dropdown.setValue(this.plugin.settings.language);
        dropdown.onChange(async (value) => {
          if (!(value in LANGUAGE_LABELS)) return;
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
      containerEl.createEl('p', { text: 'Switch language to custom to edit replacements.' });
    }

    const replacementContainer = containerEl.createDiv('novalist-replacements');
    const header = replacementContainer.createDiv('novalist-replacement-header');
    header.createEl('span', { text: 'Start token' });
    header.createEl('span', { text: 'End token' });
    header.createEl('span', { text: 'Start replacement' });
    header.createEl('span', { text: 'End replacement' });
    header.createEl('span', { text: '' });

    const updatePair = async (): Promise<void> => {
      await this.plugin.saveSettings();
    };

    for (const pair of this.plugin.settings.autoReplacements) {
      const row = replacementContainer.createDiv('novalist-replacement-row');

      const startInput = row.createEl('input', { type: 'text', value: pair.start });
      startInput.placeholder = "For example: '";
      startInput.disabled = !isCustomLanguage;
      startInput.addEventListener('input', () => {
        pair.start = startInput.value;
        void updatePair();
      });

      const endInput = row.createEl('input', { type: 'text', value: pair.end });
      endInput.placeholder = 'Optional';
      endInput.disabled = !isCustomLanguage;
      endInput.addEventListener('input', () => {
        pair.end = endInput.value;
        void updatePair();
      });

      const startReplaceInput = row.createEl('input', { type: 'text', value: pair.startReplace });
      startReplaceInput.placeholder = 'For example: „';
      startReplaceInput.disabled = !isCustomLanguage;
      startReplaceInput.addEventListener('input', () => {
        pair.startReplace = startReplaceInput.value;
        void updatePair();
      });

      const endReplaceInput = row.createEl('input', { type: 'text', value: pair.endReplace });
      endReplaceInput.placeholder = 'Optional';
      endReplaceInput.disabled = !isCustomLanguage;
      endReplaceInput.addEventListener('input', () => {
        pair.endReplace = endReplaceInput.value;
        void updatePair();
      });

      const actions = row.createDiv();
      const deleteButton = new ButtonComponent(actions)
        .setIcon('trash')
        .setTooltip('Remove replacement');
      deleteButton.setDisabled(!isCustomLanguage);
      deleteButton.onClick(async () => {
        this.plugin.settings.autoReplacements = this.plugin.settings.autoReplacements.filter(p => p !== pair);
        await this.plugin.saveSettings();
        this.display();
      });
    }

    if (isCustomLanguage) {
      new ButtonComponent(containerEl)
        .setButtonText('Add replacement')
        .onClick(async () => {
          this.plugin.settings.autoReplacements.push({ start: '', end: '', startReplace: '', endReplace: '' });
          await this.plugin.saveSettings();
          this.display();
        });
    }

    new Setting(containerEl)
      .setName('Formatting')
      .setHeading();

    new Setting(containerEl)
      .setName('Book paragraph spacing')
      .setDesc('Adds a gap between paragraphs like in printed books. Only works in edit mode.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableBookParagraphSpacing)
        .onChange(async (value) => {
          this.plugin.settings.enableBookParagraphSpacing = value;
          await this.plugin.saveSettings();
          this.plugin.updateBookParagraphSpacing();
        }));

    new Setting(containerEl)
      .setName('Advanced')
      .setHeading();

    new Setting(containerEl)
        .setName('Enable hover preview')
        .setDesc('Shows a small info bubble when hovering over character names.')
        .addToggle(toggle => toggle
            .setValue(this.plugin.settings.enableHoverPreview)
            .onChange(async (value) => {
                this.plugin.settings.enableHoverPreview = value;
                await this.plugin.saveSettings();
            }));

    new Setting(containerEl)
        .setName('Enable custom explorer')
        .setDesc('Replaces standard file explorer with a specialized novel project view.')
        .addToggle(toggle => toggle
            .setValue(this.plugin.settings.enableCustomExplorer)
            .onChange(async (value) => {
                this.plugin.settings.enableCustomExplorer = value;
                await this.plugin.saveSettings();
            }));

    new Setting(containerEl)
      .setName('Writing goals')
      .setHeading();

    new Setting(containerEl)
      .setName('Daily word goal')
      .setDesc('Target number of words to write per day.')
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
      .setName('Project word goal')
      .setDesc('Target total word count for the entire novel.')
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

  private async renderRoleColorSettings(containerEl: HTMLElement): Promise<void> {
    containerEl.empty();
    new Setting(containerEl)
      .setName('Role colors')
      .setHeading();
    containerEl.createEl('p', { text: 'Colors used for role highlights and badges.' });

    const fallbackColor = '#64748b';
    const roles = await this.getKnownRoles();

    if (roles.length === 0) {
      containerEl.createEl('p', { text: 'No roles found yet.' });
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
        btn.setTooltip('Restore default color');
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
      .setName('Gender colors')
      .setHeading();
    containerEl.createEl('p', { text: 'Colors used for gender badges.' });

    const fallbackColor = '#64748b';
    const genders = await this.getKnownGenders();

    if (genders.length === 0) {
      containerEl.createEl('p', { text: 'No genders found yet.' });
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
        btn.setTooltip('Restore default color');
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
