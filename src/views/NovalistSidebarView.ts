import {
  ItemView,
  MarkdownView,
  Notice,
  TFile,
  WorkspaceLeaf
} from 'obsidian';
import type NovalistPlugin from '../main';
import { CharacterData, CharacterChapterInfo, LocationData, PlotBoardColumn } from '../types';
import { normalizeCharacterRole, computeInterval } from '../utils/characterUtils';
import { t } from '../i18n';
import type { AiFinding, AiFindingType } from '../utils/ollamaService';
import type { AiHighlight } from '../cm/aiHighlightExtension';

type AiFilterTab = 'all' | 'inconsistency' | 'suggestion';

export const NOVELIST_SIDEBAR_VIEW_TYPE = 'novalist-sidebar';

export class NovalistSidebarView extends ItemView {
  plugin: NovalistPlugin;
  currentChapterFile: TFile | null = null;
  currentScene: string | null = null;

  // AI Assistant state
  private aiFindings: AiFinding[] = [];
  private aiActiveTab: AiFilterTab = 'all';
  private aiIsAnalysing = false;
  private aiAutoAnalyse = false;
  private aiAnalysisTimer: number | null = null;
  private aiLastAnalysedHash = '';
  private aiSectionEl: HTMLElement | null = null;
  /** Per-paragraph hashes for incremental re-analysis. */
  private aiParagraphHashes: Map<number, string> = new Map();
  /** Per-paragraph cached findings for incremental re-analysis. */
  private aiParagraphFindings: Map<number, AiFinding[]> = new Map();
  /** Entity names discovered by AI reference detection (not found by regex). */
  private aiExtraEntities: { characters: string[]; locations: string[]; items: string[]; lore: string[] } = { characters: [], locations: [], items: [], lore: [] };

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
        if (file && file.extension === 'md' && this.plugin.isFileInProject(file)) {
          this.currentChapterFile = file;
          this.updateCurrentScene();
          this.aiFindings = [];
          this.aiLastAnalysedHash = '';
          void this.render();
          this.plugin.clearAiHighlightsFromEditor();
          this.scheduleAiAnalysis();
        } else if (file && !this.plugin.isFileInProject(file)) {
          this.currentChapterFile = null;
          this.currentScene = null;
          this.aiFindings = [];
          this.aiLastAnalysedHash = '';
          void this.render();
          this.plugin.clearAiHighlightsFromEditor();
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
    this.registerEvent(this.app.vault.on('modify', (file) => {
      this.updateCurrentScene();
      void this.render();
      // Schedule AI re-analysis when the current chapter is modified
      if (this.aiAutoAnalyse && this.currentChapterFile && file instanceof TFile && file.path === this.currentChapterFile.path) {
        this.scheduleAiAnalysis();
      }
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

    // Merge AI-discovered entity references into the chapter data so they appear
    // in the normal sidebar entity sections (characters, locations, items, lore).
    for (const name of this.aiExtraEntities.characters) {
      if (!chapterData.characters.includes(name)) chapterData.characters.push(name);
    }
    for (const name of this.aiExtraEntities.locations) {
      if (!chapterData.locations.includes(name)) chapterData.locations.push(name);
    }
    for (const name of this.aiExtraEntities.items) {
      if (!chapterData.items.includes(name)) chapterData.items.push(name);
    }
    for (const name of this.aiExtraEntities.lore) {
      if (!chapterData.lore.includes(name)) chapterData.lore.push(name);
    }

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

    // Items Section
    if (chapterData.items.length > 0) {
      const itemEntries: Array<{ name: string; type: string; description: string }> = [];

      for (const itemName of chapterData.items) {
        const itemFile = this.plugin.findItemFile(itemName);
        if (!itemFile) continue;
        const itemData = await this.plugin.parseItemFile(itemFile);
        itemEntries.push(itemData);
      }

      if (itemEntries.length > 0) {
        const itemSection = contextContent.createDiv('novalist-overview-section');
        itemSection.createEl('div', { text: t('sidebar.items'), cls: 'novalist-overview-section-title' });

        const itemList = itemSection.createDiv('novalist-overview-list');
        for (const itemData of itemEntries) {
          const card = itemList.createDiv('novalist-overview-card');

          const topRow = card.createDiv('novalist-overview-card-top');
          topRow.createEl('span', { text: itemData.name, cls: 'novalist-overview-card-name' });
          if (itemData.type) {
            topRow.createEl('span', { text: itemData.type, cls: 'novalist-overview-card-role' });
          }

          if (itemData.description) {
            card.createEl('p', { text: itemData.description, cls: 'novalist-overview-card-desc' });
          }
        }
      }
    }

    // Lore Section
    if (chapterData.lore.length > 0) {
      const loreEntries: Array<{ name: string; category: string; description: string }> = [];

      for (const loreName of chapterData.lore) {
        const loreFile = this.plugin.findLoreFile(loreName);
        if (!loreFile) continue;
        const loreData = await this.plugin.parseLoreFile(loreFile);
        loreEntries.push(loreData);
      }

      if (loreEntries.length > 0) {
        const loreSection = contextContent.createDiv('novalist-overview-section');
        loreSection.createEl('div', { text: t('sidebar.lore'), cls: 'novalist-overview-section-title' });

        const loreList = loreSection.createDiv('novalist-overview-list');
        for (const loreData of loreEntries) {
          const card = loreList.createDiv('novalist-overview-card');

          const topRow = card.createDiv('novalist-overview-card-top');
          topRow.createEl('span', { text: loreData.name, cls: 'novalist-overview-card-name' });
          if (loreData.category) {
            topRow.createEl('span', { text: loreData.category, cls: 'novalist-overview-card-role' });
          }

          if (loreData.description) {
            card.createEl('p', { text: loreData.description, cls: 'novalist-overview-card-desc' });
          }
        }
      }
    }

    // AI Assistant Section
    this.renderAiSection(contextContent);
  }

  onClose(): Promise<void> {
    if (this.aiAnalysisTimer !== null) {
      window.clearTimeout(this.aiAnalysisTimer);
      this.aiAnalysisTimer = null;
    }
    if (this.plugin.ollamaService) {
      this.plugin.ollamaService.cancel();
    }
    this.plugin.clearAiHighlightsFromEditor();
    return Promise.resolve();
  }

  // ─── AI Assistant ──────────────────────────────────────────────

  /** Simple hash of chapter text to detect meaningful changes. */
  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return String(hash);
  }

  /** Schedule a debounced AI analysis (5 s after the last call). */
  private scheduleAiAnalysis(): void {
    if (!this.plugin.settings.ollama.enabled || !this.plugin.settings.ollama.model) return;
    if (this.aiAnalysisTimer !== null) {
      window.clearTimeout(this.aiAnalysisTimer);
    }
    this.aiAnalysisTimer = window.setTimeout(() => {
      this.aiAnalysisTimer = null;
      void this.runAiAnalysis();
    }, 5000);
  }

  /** Run the AI analysis for the current chapter. */
  async runAiAnalysis(): Promise<void> {
    if (!this.currentChapterFile || !this.plugin.ollamaService) return;
    if (!this.plugin.settings.ollama.enabled || !this.plugin.settings.ollama.model) return;
    if (!this.plugin.isChapterFile(this.currentChapterFile)) return;

    // Read chapter text and check if it changed since last analysis
    const chapterText = await this.app.vault.read(this.currentChapterFile);
    const hash = this.hashText(chapterText);
    if (hash === this.aiLastAnalysedHash && this.aiFindings.length > 0) return;

    this.aiIsAnalysing = true;
    this.renderAiSectionContent();

    try {
      // Auto-load model if configured
      if (this.plugin.settings.ollama.autoManageModel) {
        const loaded = await this.plugin.ollamaService.isModelLoaded();
        if (!loaded) {
          await this.plugin.ollamaService.loadModel();
        }
      }

      // Gather chapter context (act, chapter name, scene) for override-aware summaries
      const chapterName = this.plugin.getChapterNameForFileSync(this.currentChapterFile);
      const actName = this.plugin.getActForFileSync(this.currentChapterFile) || undefined;
      const sceneName = this.currentScene ?? undefined;

      const entities = await this.plugin.collectEntitySummaries(chapterName, sceneName, actName);

      // Get entities already detected by regex so the LLM only reports novel finds
      const body = this.plugin.stripFrontmatter(chapterText);
      const mentions = this.plugin.scanMentions(body);
      const alreadyFound = [
        ...mentions.characters,
        ...mentions.locations,
        ...mentions.items,
        ...mentions.lore,
      ];

      // Determine which checks are enabled
      const checks = {
        references: this.plugin.settings.ollama.checkReferences,
        inconsistencies: this.plugin.settings.ollama.checkInconsistencies,
        suggestions: this.plugin.settings.ollama.checkSuggestions,
      };

      const result = await this.plugin.ollamaService.analyseChapter(
        body, entities, alreadyFound,
        { chapterName, actName, sceneName },
        checks,
        (done, total) => {
          this.updateAiProgress(done, total);
        },
        this.aiParagraphHashes,
        this.aiParagraphFindings,
      );

      // Update caches
      this.aiParagraphHashes = result.hashes;
      this.aiParagraphFindings = new Map();
      for (const f of result.findings) {
        const idx = (f as AiFinding & { _paraIdx?: number })._paraIdx ?? -1;
        if (idx >= 0) {
          const arr = this.aiParagraphFindings.get(idx) ?? [];
          arr.push(f);
          this.aiParagraphFindings.set(idx, arr);
        }
      }

      // Separate reference findings: merge into normal entity lists, don't show as cards
      const refFindings = result.findings.filter(f => f.type === 'reference');
      const nonRefFindings = result.findings.filter(f => f.type !== 'reference');

      // Build extra entity lists from reference findings
      this.aiExtraEntities = { characters: [], locations: [], items: [], lore: [] };
      for (const ref of refFindings) {
        if (!ref.entityName) continue;
        const etype = ref.entityType || 'character';
        if (etype === 'character' && !this.aiExtraEntities.characters.includes(ref.entityName)) {
          this.aiExtraEntities.characters.push(ref.entityName);
        } else if (etype === 'location' && !this.aiExtraEntities.locations.includes(ref.entityName)) {
          this.aiExtraEntities.locations.push(ref.entityName);
        } else if (etype === 'item' && !this.aiExtraEntities.items.includes(ref.entityName)) {
          this.aiExtraEntities.items.push(ref.entityName);
        } else if (etype === 'lore' && !this.aiExtraEntities.lore.includes(ref.entityName)) {
          this.aiExtraEntities.lore.push(ref.entityName);
        }
      }

      this.aiFindings = nonRefFindings;
      this.aiLastAnalysedHash = hash;
      this.aiIsAnalysing = false;

      // Re-render the full sidebar so merged entities appear in normal sections
      void this.render();
      this.pushHighlightsToEditor(chapterText);
    } catch (err) {
      this.aiIsAnalysing = false;
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(t('ollama.analysisError', { error: msg }));
      this.renderAiSectionContent();
    }
  }

  /** Update the progress indicator inside the AI section while analysing. */
  private updateAiProgress(done: number, total: number): void {
    if (!this.aiSectionEl) return;
    const bar = this.aiSectionEl.querySelector<HTMLElement>('.novalist-ai-progress-fill');
    const label = this.aiSectionEl.querySelector<HTMLElement>('.novalist-ai-progress-label');
    if (bar) bar.style.width = `${Math.round((done / total) * 100)}%`;
    if (label) label.textContent = `${done} / ${total}`;
  }

  /** Render the AI Assistant section container (persists across re-renders). */
  private renderAiSection(parent: HTMLElement): void {
    if (!this.plugin.settings.ollama.enabled) return;

    const section = parent.createDiv('novalist-overview-section novalist-ai-sidebar-section');

    // Section title row with action buttons
    const titleRow = section.createDiv('novalist-ai-sidebar-title-row');
    titleRow.createEl('div', { text: t('ollama.sidebarTitle'), cls: 'novalist-overview-section-title' });

    const actions = titleRow.createDiv('novalist-ai-sidebar-actions');

    // Auto-analyse toggle
    const autoBtn = actions.createEl('button', {
      cls: `novalist-ai-sidebar-auto-btn${this.aiAutoAnalyse ? ' is-active' : ''}`,
      attr: { title: t('ollama.autoAnalyseDesc') },
    });
    autoBtn.createEl('span', { text: t('ollama.autoAnalyse') });
    autoBtn.addEventListener('click', () => {
      this.aiAutoAnalyse = !this.aiAutoAnalyse;
      autoBtn.toggleClass('is-active', this.aiAutoAnalyse);
      if (this.aiAutoAnalyse && this.currentChapterFile) {
        this.scheduleAiAnalysis();
      }
    });

    // Re-analyse button
    const rerunBtn = actions.createEl('button', {
      cls: 'novalist-ai-sidebar-rerun-btn',
      attr: { title: t('ollama.reanalyse') },
    });
    rerunBtn.createEl('span', { text: '\u21BB' }); // ↻ refresh icon
    rerunBtn.addEventListener('click', () => {
      this.aiLastAnalysedHash = '';
      this.aiParagraphHashes.clear();
      this.aiParagraphFindings.clear();
      void this.runAiAnalysis();
    });

    // AI content container (re-rendered independently)
    this.aiSectionEl = section.createDiv('novalist-ai-sidebar-content');
    this.renderAiSectionContent();
  }

  /** Re-render only the AI findings area (without touching the rest of the sidebar). */
  private renderAiSectionContent(): void {
    if (!this.aiSectionEl) return;
    this.aiSectionEl.empty();

    // Not configured
    if (!this.plugin.settings.ollama.enabled || !this.plugin.settings.ollama.model) {
      this.aiSectionEl.createEl('p', { text: t('ollama.sidebarDisabled'), cls: 'novalist-ai-sidebar-hint' });
      return;
    }

    // No chapter
    if (!this.currentChapterFile || !this.plugin.isChapterFile(this.currentChapterFile)) {
      this.aiSectionEl.createEl('p', { text: t('ollama.sidebarNoChapter'), cls: 'novalist-ai-sidebar-hint' });
      return;
    }

    // Loading
    if (this.aiIsAnalysing) {
      const loading = this.aiSectionEl.createDiv('novalist-ai-sidebar-loading');
      loading.createEl('div', { cls: 'novalist-ai-spinner' });
      loading.createEl('span', { text: t('ollama.analysing') });
      // Progress bar
      const progressWrap = loading.createDiv('novalist-ai-progress');
      progressWrap.createDiv('novalist-ai-progress-fill');
      loading.createEl('span', { text: '', cls: 'novalist-ai-progress-label' });
      return;
    }

    // No findings yet — prompt to run
    if (this.aiFindings.length === 0 && !this.aiLastAnalysedHash) {
      const hint = this.aiSectionEl.createDiv('novalist-ai-sidebar-hint');
      const runBtn = hint.createEl('button', {
        text: t('ollama.reanalyse'),
        cls: 'mod-cta novalist-ai-sidebar-run-btn',
      });
      runBtn.addEventListener('click', () => void this.runAiAnalysis());
      return;
    }

    // Sub-tabs (references are merged into normal entity lists, not shown here)
    const tabBar = this.aiSectionEl.createDiv('novalist-ai-sidebar-tabs');
    const tabDefs: { key: AiFilterTab; label: string }[] = [
      { key: 'all', label: t('ollama.tabAll') },
      { key: 'inconsistency', label: t('ollama.tabInconsistencies') },
      { key: 'suggestion', label: t('ollama.tabSuggestions') },
    ];
    for (const td of tabDefs) {
      const count = td.key === 'all' ? this.aiFindings.length : this.aiFindings.filter(f => f.type === td.key).length;
      const btn = tabBar.createEl('button', {
        cls: `novalist-ai-sidebar-tab${td.key === this.aiActiveTab ? ' is-active' : ''}`,
        attr: { 'data-tab': td.key },
      });
      btn.createEl('span', { text: td.label });
      if (count > 0) {
        btn.createEl('span', { text: String(count), cls: 'novalist-ai-sidebar-tab-count' });
      }
      btn.addEventListener('click', () => {
        this.aiActiveTab = td.key;
        this.renderAiSectionContent();
      });
    }

    // Filtered findings
    const filtered = this.aiActiveTab === 'all'
      ? this.aiFindings
      : this.aiFindings.filter(f => f.type === this.aiActiveTab);

    if (filtered.length === 0) {
      this.aiSectionEl.createEl('p', { text: t('ollama.noFindings'), cls: 'novalist-ai-sidebar-hint' });
      return;
    }

    const list = this.aiSectionEl.createDiv('novalist-ai-sidebar-findings');
    for (const finding of filtered) {
      this.renderAiFinding(list, finding);
    }
  }

  /** Render a single AI finding card in the sidebar. */
  private renderAiFinding(container: HTMLElement, finding: AiFinding): void {
    const card = container.createDiv('novalist-ai-sidebar-finding');
    card.addClass(`novalist-ai-sidebar-finding--${finding.type}`);

    // Header row: badge + title
    const header = card.createDiv('novalist-ai-sidebar-finding-header');
    const badgeLabel = this.getAiBadgeLabel(finding.type);
    const badge = header.createEl('span', { text: badgeLabel, cls: 'novalist-ai-badge' });
    badge.addClass(`novalist-ai-badge--${finding.type}`);
    badge.setAttribute('aria-label', badgeLabel);
    header.createEl('span', { text: finding.title, cls: 'novalist-ai-sidebar-finding-title' });

    // Description
    if (finding.description) {
      card.createEl('p', { text: finding.description, cls: 'novalist-ai-sidebar-finding-desc' });
    }

    // Excerpt
    if (finding.excerpt) {
      card.createEl('blockquote', { text: finding.excerpt, cls: 'novalist-ai-excerpt' });
    }

    // Entity info
    if (finding.entityName) {
      const info = card.createDiv('novalist-ai-entity-info');
      info.createEl('span', { text: finding.entityName, cls: 'novalist-ai-entity-name' });
      if (finding.entityType) {
        info.createEl('span', { text: ` (${finding.entityType})`, cls: 'novalist-ai-entity-type' });
      }
    }

    // Action buttons
    const actions = card.createDiv('novalist-ai-sidebar-finding-actions');

    if (finding.type === 'suggestion' && finding.entityName) {
      const createBtn = actions.createEl('button', { text: t('ollama.createEntity'), cls: 'mod-cta novalist-ai-action-btn' });
      createBtn.addEventListener('click', () => {
        this.createEntityFromSuggestion(finding);
        card.addClass('is-dismissed');
      });
    }

    const dismissBtn = actions.createEl('button', { text: t('ollama.dismiss'), cls: 'novalist-ai-action-btn' });
    dismissBtn.addEventListener('click', () => {
      this.aiFindings = this.aiFindings.filter(f => f !== finding);
      this.renderAiSectionContent();
    });
  }

  private getAiBadgeLabel(type: AiFindingType): string {
    switch (type) {
      case 'reference': return t('ollama.findingReference');
      case 'inconsistency': return t('ollama.findingInconsistency');
      case 'suggestion': return t('ollama.findingSuggestion');
    }
  }

  private createEntityFromSuggestion(finding: AiFinding): void {
    const entityType = finding.entityType || 'character';
    switch (entityType) {
      case 'character':
        this.plugin.openCharacterModal(finding.entityName);
        break;
      case 'location':
        this.plugin.openLocationModal(finding.entityName);
        break;
      case 'item':
        this.plugin.openItemModal(finding.entityName);
        break;
      case 'lore':
        this.plugin.openLoreModal(finding.entityName);
        break;
      default:
        this.plugin.openCharacterModal(finding.entityName);
        break;
    }
  }

  /**
   * Convert AI findings into editor highlights by locating each finding's
   * excerpt in the chapter text.
   */
  private pushHighlightsToEditor(chapterText: string): void {
    const highlights: AiHighlight[] = [];
    for (const finding of this.aiFindings) {
      if (!finding.excerpt) continue;
      // Find the excerpt position in the chapter text (case-insensitive)
      const idx = chapterText.toLowerCase().indexOf(finding.excerpt.toLowerCase());
      if (idx === -1) continue;
      highlights.push({
        from: idx,
        to: idx + finding.excerpt.length,
        type: finding.type,
        title: `[${finding.type}] ${finding.title}`,
      });
    }
    this.plugin.pushAiHighlightsToEditor(highlights);
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
