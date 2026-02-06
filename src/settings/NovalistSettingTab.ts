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

    new Setting(containerEl)
      .setName('Auto replacements')
      .setHeading();
    containerEl.createEl('p', { text: 'Configure text shortcuts that will be auto-replaced while typing.' });

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
  }
}
