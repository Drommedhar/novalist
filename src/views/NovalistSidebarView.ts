import {
  ItemView,
  MarkdownView,
  TFile,
  WorkspaceLeaf
} from 'obsidian';
import type NovalistPlugin from '../main';
import { CharacterData, CharacterChapterInfo, LocationData, PlotBoardColumn } from '../types';
import { normalizeCharacterRole, computeInterval } from '../utils/characterUtils';
import { t } from '../i18n';

export const NOVELIST_SIDEBAR_VIEW_TYPE = 'novalist-sidebar';

export class NovalistSidebarView extends ItemView {
  plugin: NovalistPlugin;
  currentChapterFile: TFile | null = null;
  currentScene: string | null = null;

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
          this.updateCurrentScene();
          void this.render();
        }
      })
    );

    // Listen for editor changes to track scene position
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        const prev = this.currentScene;
        this.updateCurrentScene();
        if (this.currentScene !== prev) {
          void this.render();
        }
      })
    );
    
    // Listen for vault modifications (e.g. role changes)
    this.registerEvent(this.app.vault.on('modify', () => {
      this.updateCurrentScene();
      void this.render();
    }));

    // Poll cursor position to detect scene changes on caret movement
    this.registerInterval(
      window.setInterval(() => {
        const prev = this.currentScene;
        this.updateCurrentScene();
        if (this.currentScene !== prev) {
          void this.render();
        }
      }, 500)
    );

    return Promise.resolve();
  }

  private updateCurrentScene(): void {
    if (!this.currentChapterFile) {
      this.currentScene = null;
      return;
    }
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (mdView?.editor && mdView.file?.path === this.currentChapterFile.path) {
      const cursorLine = mdView.editor.getCursor().line;
      this.currentScene = this.plugin.getCurrentSceneForLine(this.currentChapterFile, cursorLine);
    } else {
      // Keep the last known scene rather than clearing it
    }
  }

  async render(): Promise<void> {
    const container = this.containerEl;
    container.empty();
    container.addClass('novalist-sidebar');

    // Header
    container.createEl('h3', { text: t('sidebar.displayName'), cls: 'novalist-sidebar-header' });


    if (!this.currentChapterFile) {
      container.createEl('p', { text: t('sidebar.openChapter'), cls: 'novalist-empty' });
      return;
    }

    const contextContent = container.createDiv('novalist-context-content');
    const chapterData = await this.plugin.parseChapterFile(this.currentChapterFile);

    // Show current scene context if inside a scene
    if (this.currentScene) {
      const sceneCtx = contextContent.createDiv('novalist-sidebar-scene-context');
      sceneCtx.createEl('span', { text: this.currentScene, cls: 'novalist-sidebar-scene-label' });
    }
    
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

        // Apply character sheet overrides (Scene > Chapter > Act > Base)
        if (charFile) {
          const content = await this.app.vault.read(charFile);
          const overrides = this.plugin.parseCharacterSheetChapterOverrides(content);
          if (overrides.length > 0) {
            const currentAct = this.currentChapterFile
              ? this.plugin.getActForFileSync(this.currentChapterFile)
              : null;

            // Scene-specific override
            let match = this.currentScene
              ? overrides.find(o => (o.chapter === chapterId || o.chapter === chapterName) && o.scene === this.currentScene)
              : undefined;
            // Chapter-level override (no scene, no act-only)
            if (!match) {
              match = overrides.find(o => (o.chapter === chapterId || o.chapter === chapterName) && !o.scene && !o.act);
            }
            // Act-level override (act matches, no chapter, no scene)
            if (!match && currentAct) {
              match = overrides.find(o => o.act === currentAct && !o.chapter && !o.scene);
            }
            if (match) {
              if (match.overrides.name) charData.name = match.overrides.name;
              if (match.overrides.surname) charData.surname = match.overrides.surname;
              if (match.overrides.age) charData.age = match.overrides.age;
              if (match.overrides.gender) charData.gender = match.overrides.gender;
              if (match.overrides.role) charData.role = match.overrides.role;
            }
          }
        }

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
          const age = charData.age;
          const gender = charData.gender;
          const relationship = charData.relationship;
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
            let displayAge = age;
            // Compute age from birthdate when template uses date mode
            if (charData.templateId) {
              const charTemplate = this.plugin.getCharacterTemplate(charData.templateId);
              if (charTemplate.ageMode === 'date' && chapterId) {
                const scName = this.currentScene ?? undefined;
                const chapterDate = this.plugin.getDateForChapterScene(chapterId, scName);
                if (chapterDate) {
                  const interval = computeInterval(age, chapterDate, charTemplate.ageIntervalUnit ?? 'years');
                  if (interval !== null && interval >= 0) {
                    displayAge = String(interval);
                  }
                }
              }
            }
            const pill = props.createDiv('novalist-overview-pill');
            pill.createEl('span', { text: t('sidebar.age'), cls: 'novalist-overview-pill-label' });
            pill.createEl('span', { text: displayAge, cls: 'novalist-overview-pill-value' });
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

    // Plot Board Section
    this.renderPlotBoardSection(contextContent);

    // Mention Frequency Section
    await this.renderMentionFrequencySection(contextContent, chapterData.characters);

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

  private renderPlotBoardSection(parent: HTMLElement): void {
    if (!this.currentChapterFile) return;

    const board = this.plugin.settings.plotBoard;
    const columns: PlotBoardColumn[] = board.columns;
    if (columns.length === 0) return;

    const chapterId = this.plugin.getChapterIdForFileSync(this.currentChapterFile);
    const cellData = board.cells[chapterId];
    if (!cellData) return;

    // Only show columns that have data for this chapter
    const filledColumns = columns.filter(col => cellData[col.id]?.trim());
    if (filledColumns.length === 0) return;

    const section = parent.createDiv('novalist-overview-section');
    section.createEl('div', { text: t('sidebar.plotBoard'), cls: 'novalist-overview-section-title' });

    const list = section.createDiv('novalist-overview-plot-list');
    for (const col of filledColumns) {
      const row = list.createDiv('novalist-overview-plot-item');
      row.createEl('span', { text: col.name, cls: 'novalist-overview-plot-label' });
      row.createEl('span', { text: cellData[col.id], cls: 'novalist-overview-plot-value' });
    }
  }

  /** Render the Mention Frequency graph in the sidebar. */
  private async renderMentionFrequencySection(parent: HTMLElement, trackedCharacters: string[]): Promise<void> {
    if (trackedCharacters.length === 0) return;

    const freq = await this.plugin.computeMentionFrequency(trackedCharacters);
    if (freq.chapters.length === 0) return;

    const section = parent.createDiv('novalist-overview-section');
    section.createEl('div', {
      text: t('sidebar.mentionFrequency'),
      cls: 'novalist-overview-section-title',
    });

    const graphContainer = section.createDiv('novalist-mention-graph');

    // Legend
    const legend = graphContainer.createDiv('novalist-mention-legend');
    const legendPresent = legend.createDiv('novalist-mention-legend-item');
    legendPresent.createEl('span', { cls: 'novalist-mention-legend-swatch novalist-mention-present' });
    legendPresent.createEl('span', { text: t('sidebar.mentionLegendPresent') });
    const legendAbsent = legend.createDiv('novalist-mention-legend-item');
    legendAbsent.createEl('span', { cls: 'novalist-mention-legend-swatch novalist-mention-absent' });
    legendAbsent.createEl('span', { text: t('sidebar.mentionLegendAbsent') });

    // Find the current chapter index for highlighting
    const currentChapterId = this.currentChapterFile
      ? this.plugin.getChapterIdForFileSync(this.currentChapterFile)
      : '';
    const currentChapterName = this.currentChapterFile
      ? this.plugin.getChapterNameForFileSync(this.currentChapterFile)
      : '';

    // For each tracked character, render a row
    for (const charName of trackedCharacters) {
      const charMentions = freq.mentions[charName];
      if (!charMentions) continue;

      const row = graphContainer.createDiv('novalist-mention-row');

      // Character name label
      const nameLabel = row.createDiv('novalist-mention-name');
      nameLabel.createEl('span', { text: charName });

      // Gap warning badge
      const gap = freq.currentGap[charName];
      if (gap >= 3) {
        nameLabel.createEl('span', {
          text: t('sidebar.mentionGapWarning', { count: String(gap) }),
          cls: 'novalist-mention-gap-warning',
        });
      }

      // Heatmap cells
      const cells = row.createDiv('novalist-mention-cells');
      for (let i = 0; i < freq.chapters.length; i++) {
        const ch = freq.chapters[i];
        const mentioned = charMentions[i];
        const cell = cells.createDiv(
          `novalist-mention-cell ${mentioned ? 'novalist-mention-present' : 'novalist-mention-absent'}`
        );
        // Highlight current chapter
        const descs = this.plugin.getChapterDescriptionsSync();
        const chDesc = descs.find(d => d.name === ch.name);
        if (chDesc && (chDesc.id === currentChapterId || chDesc.name === currentChapterName)) {
          cell.addClass('novalist-mention-current');
        }
        cell.setAttribute('title',
          `${ch.name}: ${mentioned ? t('sidebar.mentionPresent') : t('sidebar.mentionAbsent', { count: '0' })}`
        );
        cell.createEl('span', {
          text: String(ch.index),
          cls: 'novalist-mention-cell-label',
        });
      }
    }
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
