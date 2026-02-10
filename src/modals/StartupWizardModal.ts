import { App, Modal, Setting, setIcon } from 'obsidian';
import NovalistPlugin from '../main';
import { getLanguageLabels, LANGUAGE_DEFAULTS, cloneAutoReplacements } from '../settings/NovalistSettings';
import { LanguageKey } from '../types';
import { t } from '../i18n';

export class StartupWizardModal extends Modal {
  plugin: NovalistPlugin;
  currentStep: number = 0;

  constructor(app: App, plugin: NovalistPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    this.display();
  }

  display() {
    const { contentEl } = this;
    contentEl.empty();
    
    if (this.currentStep === 0) {
      this.displayWelcome();
    } else if (this.currentStep === 1) {
      this.displaySetup();
    } else if (this.currentStep === 2) {
      this.displayTutorial();
    }
  }

  displayWelcome() {
    const { contentEl } = this;

    const hero = contentEl.createDiv('novalist-wizard-hero');
    const iconContainer = hero.createDiv('novalist-wizard-icon');
    setIcon(iconContainer, 'book-open');
    hero.createEl('h2').setText(t('wizard.welcomeTitle'));
    hero.createEl('p').setText(t('wizard.welcomeSubtitle'));

    const featuresGrid = contentEl.createDiv('novalist-wizard-features');

    const features = [
        { icon: 'users', title: t('wizard.featureCharacters'), desc: t('wizard.featureCharactersDesc') },
        { icon: 'map-pin', title: t('wizard.featureLocations'), desc: t('wizard.featureLocationsDesc') },
        { icon: 'book', title: t('wizard.featureChapters'), desc: t('wizard.featureChaptersDesc') },
        { icon: 'quote', title: t('wizard.featureSmartQuotes'), desc: t('wizard.featureSmartQuotesDesc') }
    ];

    features.forEach(f => {
        const card = featuresGrid.createDiv('novalist-feature-card');
        const title = card.createDiv('novalist-feature-title');
        setIcon(title.createSpan(), f.icon);
        title.createSpan().setText(f.title);
        card.createDiv('novalist-feature-desc').setText(f.desc);
    });

    const btnContainer = contentEl.createDiv();
    btnContainer.addClass('novalist-wizard-actions');

    new Setting(btnContainer)
      .addButton(btn => btn
        .setButtonText(t('wizard.nextSetup'))
        .setCta()
        .onClick(() => {
          this.currentStep++;
          this.display();
        }));
  }

  displaySetup() {
    const { contentEl } = this;
    
    contentEl.createEl('h2').setText(t('wizard.setupTitle'));
    contentEl.createEl('p', { text: t('wizard.setupDesc') });

    // Project Path Setting
    new Setting(contentEl)
      .setName(t('wizard.projectFolder'))
      .setDesc(t('wizard.projectFolderDesc'))
      .addText(text => text
        .setValue(this.plugin.settings.projectPath)
        .onChange(async (value) => {
          this.plugin.settings.projectPath = value;
          await this.plugin.saveSettings();
        }));

    // Language Setting
    new Setting(contentEl)
      .setName(t('wizard.dialogueLanguage'))
      .setDesc(t('wizard.dialogueLanguageDesc'))
      .addDropdown(dropdown => {
        Object.entries(getLanguageLabels()).forEach(([key, label]) => {
          dropdown.addOption(key, label);
        });
        dropdown.setValue(this.plugin.settings.language);
        dropdown.onChange(async (value: LanguageKey) => {
          this.plugin.settings.language = value;
          if (value !== 'custom' && LANGUAGE_DEFAULTS[value]) {
            this.plugin.settings.autoReplacements = cloneAutoReplacements(
              LANGUAGE_DEFAULTS[value]
            );
          }
          await this.plugin.saveSettings();
        });
      });

    const btnContainer = contentEl.createDiv();
    btnContainer.addClass('novalist-wizard-actions-between');

    new Setting(btnContainer)
      .addButton(btn => btn
        .setButtonText(t('wizard.back'))
        .onClick(() => {
          this.currentStep--;
          this.display();
        }));

    new Setting(btnContainer)
      .addButton(btn => btn
        .setButtonText(t('wizard.initAndNext'))
        .setCta()
        .onClick(async () => {
          await this.plugin.initializeProjectStructure();
          this.currentStep++;
          this.display();
        }));
  }

  displayTutorial() {
    const { contentEl } = this;
    
    const hero = contentEl.createDiv('novalist-wizard-hero');
    const iconContainer = hero.createDiv('novalist-wizard-icon');
    setIcon(iconContainer, 'check-circle');
    hero.createEl('h2').setText(t('wizard.allSet'));
    hero.createEl('p').setText(t('wizard.projectInitialized'));

    contentEl.createEl('h3', { text: t('wizard.nextSteps') });
    
    const ol = contentEl.createEl('ol');
    ol.addClass('novalist-tutorial-list');
    
    ol.createEl('li', { text: t('wizard.tipRecreate') });
    ol.createEl('li', { text: t('wizard.tipSidebar') });
    ol.createEl('li').setText(t('wizard.tipChapters'));
    ol.createEl('li', { text: t('wizard.tipQuotes') });

    contentEl.createDiv('novalist-tutorial-final-msg').setText(t('wizard.happyWriting'));
    
    const btnContainer = contentEl.createDiv();
    btnContainer.addClass('novalist-wizard-actions');

    new Setting(btnContainer)
        .addButton(btn => btn
        .setButtonText(t('wizard.finish'))
        .setCta()
        .onClick(async () => {
          this.plugin.settings.startupWizardShown = true;
          await this.plugin.saveSettings();
          this.close();
        }));
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
