import { App, Modal, Setting, setIcon } from 'obsidian';
import NovalistPlugin from '../main';
import { TourGuide } from '../utils/TourGuide';
import { LANGUAGE_LABELS, LANGUAGE_DEFAULTS, cloneAutoReplacements } from '../settings/NovalistSettings';
import { LanguageKey } from '../types';

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
    hero.createEl('h2').setText('Welcome to ' + 'Novalist');
    hero.createEl('p').setText('The all-in-one novel writing environment for Obsidian.');

    const featuresGrid = contentEl.createDiv('novalist-wizard-features');

    const features = [
        { icon: 'users', title: 'Characters', desc: 'Track roles, relationships and details.' },
        { icon: 'map-pin', title: 'Locations', desc: 'Organize the world of your story.' },
        { icon: 'book', title: 'Chapters', desc: 'Plan and write scenes efficiently.' },
        { icon: 'quote', title: 'Smart quotes', desc: 'Auto-format dialogue as you type.' }
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
        .setButtonText('Next: setup project')
        .setCta()
        .onClick(() => {
          this.currentStep++;
          this.display();
        }));
  }

  displaySetup() {
    const { contentEl } = this;
    
    contentEl.createEl('h2').setText('Setup');
    contentEl.createEl('p', { text: 'Let\'s get your project folder and settings ready.' });

    // Project Path Setting
    new Setting(contentEl)
      .setName('Project ' + 'folder')
      .setDesc('Values ' + 'default to "NovelProject"')
      .addText(text => text
        .setValue(this.plugin.settings.projectPath)
        .onChange(async (value) => {
          this.plugin.settings.projectPath = value;
          await this.plugin.saveSettings();
        }));

    // Language Setting
    new Setting(contentEl)
      .setName('Dialogue language / style')
      .setDesc('Choose your preferred quotation style for dialogues.')
      .addDropdown(dropdown => {
        Object.entries(LANGUAGE_LABELS).forEach(([key, label]) => {
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
        .setButtonText('Back')
        .onClick(() => {
          this.currentStep--;
          this.display();
        }));

    new Setting(btnContainer)
      .addButton(btn => btn
        .setButtonText('Initialize project & next')
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
    hero.createEl('h2').setText('You are all set!');
    hero.createEl('p').setText('Your project structure has been initialized.');

    contentEl.createEl('h3', { text: 'Next steps' });
    
    const ol = contentEl.createEl('ol');
    ol.addClass('novalist-tutorial-list');
    
    ol.createEl('li', { text: 'Use the "Novalist: ' + 'initialize novel project structure" command if you ever need to recreate folders.' });
    ol.createEl('li', { text: 'Use the sidebar (book icon) or commands to create characters and locations.' });
    ol.createEl('li').setText('Create chapters in your chapter folder.');
    ol.createEl('li', { text: 'Type quote characters like \' to see auto-replacement in action.' });

    contentEl.createDiv('novalist-tutorial-final-msg').setText('Happy writing!');
    
    const btnContainer = contentEl.createDiv();
    btnContainer.addClass('novalist-wizard-actions');

    new Setting(btnContainer)
      .addButton(btn => btn
        .setButtonText('Finish & tour')
        .setCta()
        .onClick(async () => {
            this.plugin.settings.startupWizardShown = true;
            await this.plugin.saveSettings();
            this.close();
            this.startTour();
        }));
  }

  startTour() {
    const tour = new TourGuide(this.app, [
        {
            selector: '.workspace-ribbon-glyph[aria-label="Novalist"]',
            title: 'Quick access',
            content: 'Click this icon to toggle the Novalist sidebar view.',
            position: 'right',
            onShow: async () => {
                // Ensure sidebar is closed initially to make the toggle clear?
                // Or just show it.
                // void this.plugin.activateView();
            }
        },
        // Sidebar Tour
        {
            selector: '.workspace-tab-header[data-type="novalist-sidebar"]',
            title: 'Sidebar view',
            content: 'This panel shows important context about characters and locations for your current chapter.',
            position: 'left',
            onShow: async () => {
                await this.plugin.activateView();
            }
        },
        {
            selector: '.novalist-tab-header-container .novalist-tab:nth-child(2)',
            title: 'Context tab',
            content: 'Shows characters and locations mentioned in the active chapter.',
            position: 'left',
            onShow: async () => {
                await this.plugin.activateView();
                // The tabs are inside .novalist-tabs -> button.novalist-tab
                // The order is Actions, Overview. So Overview is nth-child(2).
            }
        },
        {
            selector: '.novalist-tabs .novalist-tab:nth-child(2)', // Overview
            title: 'Overview',
            content: 'This tab gives you a quick overview of all entities in the current scene.',
            position: 'bottom'
        },
        {
            selector: '.novalist-tabs .novalist-tab:nth-child(1)', // Actions
            title: 'Actions',
            content: 'Quickly create new characters or locations from here.',
            position: 'bottom'
        },
        // Explorer Tour
        {
            selector: '.workspace-tab-header[data-type="novalist-explorer"]',
            title: 'Project explorer',
            content: 'Navigate your novel structure separately from your other notes.',
            position: 'right',
            onShow: async () => {
                if (this.plugin.settings.enableCustomExplorer) {
                    await this.plugin.activateExplorerView();
                }
            }
        },
        {
            selector: '.novalist-explorer-tab:nth-child(1)',
            title: 'Chapters',
            content: 'Drag and drop chapters to reorder them.',
            position: 'bottom',
            onShow: async () => {
                 if (this.plugin.settings.enableCustomExplorer) {
                    await this.plugin.activateExplorerView();
                }
            }
        },
        {
            selector: '.novalist-explorer-tab:nth-child(2)',
            title: 'Characters',
            content: 'View all your characters grouped by role.',
            position: 'bottom'
        },
        {
            selector: '.novalist-explorer-tab:nth-child(3)',
            title: 'Locations',
            content: 'Access your location files quickly.',
            position: 'bottom'
        }
    ].filter(step => {
        if ((step.title === 'Project explorer' || step.selector.includes('novalist-explorer')) 
            && !this.plugin.settings.enableCustomExplorer) return false;
        return true;
    }));
    
    tour.start();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
