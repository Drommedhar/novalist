import {
  ItemView,
  TFile,
  WorkspaceLeaf,
  ButtonComponent
} from 'obsidian';
import type NovalistPlugin from '../main';
import { CharacterData, CharacterChapterInfo, LocationData } from '../types';
import { normalizeCharacterRole } from '../utils/characterUtils';
import { t } from '../i18n';

export const NOVELIST_SIDEBAR_VIEW_TYPE = 'novalist-sidebar';

export class NovalistSidebarView extends ItemView {
  plugin: NovalistPlugin;
  currentChapterFile: TFile | null = null;
  private activeTab: 'actions' | 'context' = 'context';

  constructor(leaf: WorkspaceLeaf, plugin: NovalistPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return NOVELIST_SIDEBAR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t('sidebar.displayName');
  }

  getIcon(): string {
    return 'book-open';
  }

  onOpen(): Promise<void> {
    this.containerEl.empty();
    void this.render();
    
    // Listen for active file changes
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (file && file.extension === 'md') {
          this.currentChapterFile = file;
          void this.render();
        }
      })
    );
    
    // Listen for vault modifications (e.g. role changes)
    this.registerEvent(this.app.vault.on('modify', () => {
      void this.render();
    }));

    return Promise.resolve();
  }

  async render(): Promise<void> {
    const container = this.containerEl;
    container.empty();
    container.addClass('novalist-sidebar');

    // Header
    container.createEl('h3', { text: t('sidebar.displayName'), cls: 'novalist-sidebar-header' });

    // Tabs
    const tabs = container.createDiv('novalist-tabs');
    const setTab = (tab: 'actions' | 'context') => {
      this.activeTab = tab;
      void this.render();
    };

    const tabOrder: Array<{ id: 'actions' | 'context'; label: string }> = [
      { id: 'actions', label: t('sidebar.actions') },
      { id: 'context', label: t('sidebar.overview') }
    ];

    for (const tab of tabOrder) {
      const btn = tabs.createEl('button', {
        text: tab.label,
        cls: `novalist-tab ${this.activeTab === tab.id ? 'is-active' : ''}`
      });
      btn.addEventListener('click', () => setTab(tab.id));
    }

    if (this.activeTab === 'actions') {
      const actionsSection = container.createDiv('novalist-section');
      actionsSection.createEl('h4', { text: t('sidebar.quickActions'), cls: 'novalist-section-title' });

      const btnContainer = actionsSection.createDiv('novalist-actions');

      new ButtonComponent(btnContainer)
        .setButtonText(t('sidebar.addCharacter'))
        .onClick(() => this.plugin.openCharacterModal());

      new ButtonComponent(btnContainer)
        .setButtonText(t('sidebar.addLocation'))
        .onClick(() => this.plugin.openLocationModal());

      new ButtonComponent(btnContainer)
        .setButtonText(t('sidebar.addChapter'))
        .onClick(() => this.plugin.openChapterDescriptionModal());

      return;
    }

    if (!this.currentChapterFile) {
      container.createEl('p', { text: t('sidebar.openChapter'), cls: 'novalist-empty' });
      return;
    }

    const contextContent = container.createDiv('novalist-context-content');
    const chapterData = await this.plugin.parseChapterFile(this.currentChapterFile);
    
    // Characters Section
    if (chapterData.characters.length > 0) {
      const characterItems: Array<{
        data: CharacterData;
        chapterInfo: CharacterChapterInfo | undefined;
      }> = [];

      const chapterId = this.currentChapterFile ? this.plugin.getChapterIdForFileSync(this.currentChapterFile) : '';
      const chapterName = this.currentChapterFile ? this.plugin.getChapterNameForFileSync(this.currentChapterFile) : '';

      for (const charName of chapterData.characters) {
        const charFile = this.plugin.findCharacterFile(charName);
        if (!charFile) continue;
        const charData = await this.plugin.parseCharacterFile(charFile);
        const chapterInfo = charData.chapterInfos.find(
          ci => ci.chapter === chapterId || ci.chapter === chapterName
        );
        characterItems.push({ data: charData, chapterInfo });
      }

      if (characterItems.length > 0) {
        const charSection = contextContent.createDiv('novalist-overview-section');
        charSection.createEl('div', { text: t('sidebar.characters'), cls: 'novalist-overview-section-title' });

        const charList = charSection.createDiv('novalist-overview-list');
        for (const itemData of characterItems) {
          const { data: charData, chapterInfo } = itemData;
          const card = charList.createDiv('novalist-overview-card');

          // Top row: name + role badge
          const topRow = card.createDiv('novalist-overview-card-top');
          topRow.createEl('span', { text: `${charData.name} ${charData.surname}`.trim(), cls: 'novalist-overview-card-name' });
          if (charData.role) {
            const roleBadge = topRow.createEl('span', { text: charData.role, cls: 'novalist-overview-card-role' });
            const roleColor = this.getRoleColor(charData.role);
            if (roleColor) roleBadge.style.setProperty('--novalist-role-color', roleColor);
          }

          // Properties as pills
          const props = card.createDiv('novalist-overview-card-props');
          const age = chapterInfo?.overrides?.age || charData.age;
          const gender = charData.gender;
          const relationship = chapterInfo?.overrides?.relationship || charData.relationship;
          if (gender) {
            const pill = props.createDiv('novalist-overview-pill novalist-gender-pill');
            const genderColor = this.getGenderColor(gender);
            if (genderColor) {
              pill.setCssProps({
                '--novalist-gender-color': genderColor,
                '--novalist-gender-text': 'var(--text-on-accent)'
              });
            }
            pill.createEl('span', { text: t('sidebar.gender'), cls: 'novalist-overview-pill-label' });
            pill.createEl('span', { text: gender, cls: 'novalist-overview-pill-value' });
          }
          if (age) {
            const pill = props.createDiv('novalist-overview-pill');
            pill.createEl('span', { text: t('sidebar.age'), cls: 'novalist-overview-pill-label' });
            pill.createEl('span', { text: age, cls: 'novalist-overview-pill-value' });
          }
          if (relationship) {
            const pill = props.createDiv('novalist-overview-pill');
            pill.createEl('span', { text: t('sidebar.rel'), cls: 'novalist-overview-pill-label' });
            pill.createEl('span', { text: relationship, cls: 'novalist-overview-pill-value' });
          }

          // Chapter-specific info
          if (chapterInfo?.info) {
            const infoEl = card.createDiv('novalist-overview-card-chapter-info');
            infoEl.createEl('span', { text: chapterInfo.info });
          }
        }
      }
    }

    // Locations Section
    if (chapterData.locations.length > 0) {
      const locationItems: Array<LocationData> = [];

      for (const locName of chapterData.locations) {
        const locFile = this.plugin.findLocationFile(locName);
        if (!locFile) continue;
        const locData = await this.plugin.parseLocationFile(locFile);
        locationItems.push(locData);
      }

      if (locationItems.length > 0) {
        const locSection = contextContent.createDiv('novalist-overview-section');
        locSection.createEl('div', { text: t('sidebar.locations'), cls: 'novalist-overview-section-title' });

        const locList = locSection.createDiv('novalist-overview-list');
        for (const locData of locationItems) {
          const card = locList.createDiv('novalist-overview-card');

          const topRow = card.createDiv('novalist-overview-card-top');
          topRow.createEl('span', { text: locData.name, cls: 'novalist-overview-card-name' });

          if (locData.description) {
            card.createEl('p', { text: locData.description, cls: 'novalist-overview-card-desc' });
          }
        }
      }
    }
  }

  onClose(): Promise<void> {
    // Cleanup
    return Promise.resolve();
  }

  private getRoleColor(roleLabel: string): string {
    const normalized = normalizeCharacterRole(roleLabel);
    return this.plugin.settings.roleColors[normalized] || '';
  }

  private getGenderColor(genderLabel: string): string {
    const trimmed = genderLabel.trim();
    return this.plugin.settings.genderColors[trimmed] || '';
  }
}
