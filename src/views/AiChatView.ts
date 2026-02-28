import {
  ItemView,
  MarkdownView,
  MarkdownRenderer,
  Component,
  Notice,
  TFile,
  WorkspaceLeaf,
} from 'obsidian';
import type NovalistPlugin from '../main';
import { t, getLanguageName } from '../i18n';
import type { EntitySummary, OllamaModel, CopilotModelInfo } from '../utils/ollamaService';
import { DEFAULT_SYSTEM_PROMPT } from '../settings/NovalistSettings';

export const AI_CHAT_VIEW_TYPE = 'novalist-ai-chat';

const CHAT_SESSION_STORAGE_KEY = 'novalist-ai-chat-session';

/** A single message in the conversation. */
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Chain-of-thought / reasoning text (only for assistant messages). */
  thinking?: string;
}

export class AiChatView extends ItemView {
  plugin: NovalistPlugin;

  private messages: ChatMessage[] = [];
  private isGenerating = false;
  private currentChapterFile: TFile | null = null;

  private chatContainer: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private clearBtn: HTMLButtonElement;
  private statusEl: HTMLElement;
  private scrollContainer: HTMLElement;
  private modelDropdown: HTMLSelectElement;
  /** Temporary component used for rendering Markdown in assistant messages. */
  private renderComponent: Component;

  constructor(leaf: WorkspaceLeaf, plugin: NovalistPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.renderComponent = new Component();
  }

  getViewType(): string {
    return AI_CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t('aiChat.displayName');
  }

  getIcon(): string {
    return 'message-square';
  }

  onOpen(): void {
    this.renderComponent.load();

    // Track the active chapter file via workspace events so we don't
    // rely on getActiveViewOfType (which fails when the chat pane is focused).
    this.initChapterFileTracking();

    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('novalist-ai-chat-root');

    // ── Header ──
    const header = containerEl.createDiv('novalist-ai-chat-header');
    header.createEl('span', { text: t('aiChat.displayName'), cls: 'novalist-ai-chat-header-title' });

    // Model selector
    const modelWrapper = header.createDiv('novalist-ai-chat-model-wrapper');
    modelWrapper.createEl('span', { text: t('aiChat.model'), cls: 'novalist-ai-chat-model-label' });
    this.modelDropdown = modelWrapper.createEl('select', { cls: 'novalist-ai-chat-model-select dropdown' });
    this.modelDropdown.addEventListener('change', () => {
      void this.onModelChange(this.modelDropdown.value);
    });
    void this.populateModelDropdown();

    this.clearBtn = header.createEl('button', {
      cls: 'novalist-ai-chat-clear-btn',
      attr: { 'aria-label': t('aiChat.clearChat') },
    });
    this.clearBtn.textContent = t('aiChat.clearChat');
    this.clearBtn.addEventListener('click', () => this.clearChat());

    // ── Status bar ──
    this.statusEl = containerEl.createDiv('novalist-ai-chat-status');
    this.updateStatus();

    // ── Scroll area for messages ──
    this.scrollContainer = containerEl.createDiv('novalist-ai-chat-scroll');
    this.chatContainer = this.scrollContainer.createDiv('novalist-ai-chat-messages');

    // Empty state or restore persisted session
    this.restoreSession();
    this.renderMessages();

    // ── Input area ──
    const inputArea = containerEl.createDiv('novalist-ai-chat-input-area');
    this.inputEl = inputArea.createEl('textarea', {
      cls: 'novalist-ai-chat-input',
      attr: {
        placeholder: t('aiChat.placeholder'),
        rows: '3',
      },
    });
    this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (this.isGenerating) {
          this.stopGeneration();
        } else {
          void this.sendMessage();
        }
      }
    });

    const btnRow = inputArea.createDiv('novalist-ai-chat-btn-row');
    this.sendBtn = btnRow.createEl('button', {
      cls: 'novalist-ai-chat-send-btn',
      text: t('aiChat.send'),
    });
    this.sendBtn.addEventListener('click', () => {
      if (this.isGenerating) {
        this.stopGeneration();
      } else {
        void this.sendMessage();
      }
    });
  }

  onClose(): void {
    this.renderComponent.unload();
  }

  // ─── Status ──────────────────────────────────────────────────────

  private updateStatus(): void {
    if (!this.statusEl) return;
    this.statusEl.empty();

    if (!this.plugin.settings.ollama.enabled) {
      this.statusEl.createEl('span', { text: t('aiChat.disabled'), cls: 'novalist-ai-chat-status-badge is-error' });
      return;
    }

    const chapterFile = this.getActiveChapterFile();
    if (chapterFile) {
      this.statusEl.createEl('span', {
        text: t('aiChat.chapterContext', { name: chapterFile.basename }),
        cls: 'novalist-ai-chat-status-badge is-ok',
      });
    } else {
      this.statusEl.createEl('span', {
        text: t('aiChat.noChapter'),
        cls: 'novalist-ai-chat-status-badge is-warning',
      });
    }
  }

  // ─── Model selector ─────────────────────────────────────────────

  /** Populate the model dropdown from the current provider's model list. */
  async populateModelDropdown(): Promise<void> {
    if (!this.modelDropdown) return;
    this.modelDropdown.empty();

    const provider = this.plugin.settings.ollama.provider;

    if (!this.plugin.ollamaService) {
      this.plugin.initOllamaService();
    }
    if (!this.plugin.ollamaService) return;

    if (provider === 'ollama') {
      // Ollama: fetch local models
      const loadingOpt = this.modelDropdown.createEl('option', { text: t('aiChat.modelLoading'), value: '__loading__' });
      loadingOpt.disabled = true;
      let models: OllamaModel[] = [];
      try {
        models = await this.plugin.ollamaService.listModels();
      } catch { /* ignore */ }
      this.modelDropdown.empty();
      if (models.length === 0) {
        const opt = this.modelDropdown.createEl('option', { text: t('aiChat.noModels'), value: '' });
        opt.selected = true;
        return;
      }
      for (const m of models) {
        const opt = this.modelDropdown.createEl('option', { text: m.name, value: m.name });
        if (m.name === this.plugin.settings.ollama.model) opt.selected = true;
      }
    } else {
      // Copilot: list available models
      const defaultOpt = this.modelDropdown.createEl('option', {
        text: t('aiChat.modelDefault'),
        value: '',
      });
      if (!this.plugin.settings.ollama.copilotModel) defaultOpt.selected = true;

      let models: CopilotModelInfo[] = [];
      try {
        models = await this.plugin.ollamaService.listCopilotModels();
      } catch { /* ignore */ }
      for (const m of models) {
        const opt = this.modelDropdown.createEl('option', { text: m.name, value: m.id });
        if (m.id === this.plugin.settings.ollama.copilotModel) opt.selected = true;
      }
    }
  }

  /** Handle model selection change from the dropdown. */
  private async onModelChange(value: string): Promise<void> {
    const provider = this.plugin.settings.ollama.provider;
    if (provider === 'ollama') {
      this.plugin.settings.ollama.model = value;
      if (this.plugin.ollamaService) {
        this.plugin.ollamaService.setModel(value);
      }
    } else {
      this.plugin.settings.ollama.copilotModel = value;
      if (this.plugin.ollamaService) {
        await this.plugin.ollamaService.setCopilotModel(value);
      }
    }
    await this.plugin.saveSettings();
  }

  // ─── Active chapter resolution ───────────────────────────────────

  /** Set up workspace event listeners to keep track of the current chapter file. */
  private initChapterFileTracking(): void {
    // Seed with the currently active file (if any).
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile.extension === 'md' && this.plugin.isChapterFile(activeFile)) {
      this.currentChapterFile = activeFile;
    } else {
      // Fall back: scan all markdown leaves for a chapter file.
      for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
        const view = leaf.view as MarkdownView;
        if (view.file && this.plugin.isChapterFile(view.file)) {
          this.currentChapterFile = view.file;
          break;
        }
      }
    }

    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (file && file.extension === 'md' && this.plugin.isChapterFile(file)) {
          this.currentChapterFile = file;
          this.updateStatus();
        } else if (file && file.extension === 'md' && !this.plugin.isChapterFile(file)) {
          this.currentChapterFile = null;
          this.updateStatus();
        }
        // When a non-md file is opened (or null), keep the previous value.
      }),
    );

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.updateStatus();
      }),
    );
  }

  private getActiveChapterFile(): TFile | null {
    return this.currentChapterFile;
  }

  /** Try to find the MarkdownView leaf that has the given file open. */
  private findMarkdownViewForFile(file: TFile): MarkdownView | null {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view as MarkdownView;
      if (view.file?.path === file.path) {
        return view;
      }
    }
    return null;
  }

  // ─── Chat logic ──────────────────────────────────────────────────

  private async sendMessage(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text || this.isGenerating) return;

    if (!this.plugin.settings.ollama.enabled) {
      new Notice(t('aiChat.disabled'));
      return;
    }
    if (!this.plugin.ollamaService) {
      this.plugin.initOllamaService();
    }
    if (!this.plugin.ollamaService) return;

    // Resolve active chapter
    const chapterFile = this.getActiveChapterFile();

    // Add user message
    this.messages.push({ role: 'user', content: text });
    this.inputEl.value = '';
    this.renderMessages();

    this.isGenerating = true;
    this.sendBtn.textContent = t('aiChat.stop');
    this.sendBtn.classList.add('is-stop');
    this.inputEl.disabled = true;
    this.updateStatus();

    try {
      // Build system prompt with all project context
      const systemPrompt = await this.buildSystemPrompt(chapterFile);

      // Build messages array for the chat API
      const apiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: systemPrompt },
      ];

      // Add conversation history
      for (const msg of this.messages) {
        apiMessages.push({ role: msg.role, content: msg.content });
      }

      // Add placeholder assistant message for streaming
      const assistantMsg: ChatMessage = { role: 'assistant', content: '', thinking: '' };
      this.messages.push(assistantMsg);
      const msgIdx = this.messages.length - 1;
      this.renderMessages();

      const assistantBubble = this.chatContainer.querySelector<HTMLElement>(
        `.novalist-ai-chat-msg[data-index="${msgIdx}"] .novalist-ai-chat-msg-content`
      );
      const thinkingBubble = this.chatContainer.querySelector<HTMLElement>(
        `.novalist-ai-chat-msg[data-index="${msgIdx}"] .novalist-ai-chat-thinking-content`
      );
      const thinkingWrapper = this.chatContainer.querySelector<HTMLElement>(
        `.novalist-ai-chat-msg[data-index="${msgIdx}"] .novalist-ai-chat-thinking`
      );

      // Retry loop for repetitive thinking detection
      const maxRetries = 2;
      let result: { response: string; thinking: string } | null = null;
      let attempts = 0;
      
      while (attempts <= maxRetries) {
        // Reset message content for retry
        this.messages[msgIdx].content = '';
        this.messages[msgIdx].thinking = '';
        
        if (attempts > 0) {
          new Notice(`Retrying due to repetitive thinking... (attempt ${attempts + 1}/${maxRetries + 1})`);
        }

        result = await this.plugin.ollamaService.generateChat(
          apiMessages,
          (token: string) => {
            this.messages[msgIdx].content += token;

            // Keep as text during streaming — render Markdown once complete.
            if (assistantBubble) {
              assistantBubble.textContent = this.messages[msgIdx].content;
            }
            this.scrollToBottom();
          },
          undefined,
          undefined,
          (thinkToken: string) => {
            this.messages[msgIdx].thinking = (this.messages[msgIdx].thinking ?? '') + thinkToken;

            if (thinkingWrapper) {
              thinkingWrapper.removeClass('is-hidden');
            }
            if (thinkingBubble) {
              thinkingBubble.textContent = this.messages[msgIdx].thinking ?? '';
              // Auto-scroll thinking content unless the user scrolled up.
              this.autoScrollElement(thinkingBubble);
            }
            this.scrollToBottom();
          },
        );

        // Check if thinking is repetitive
        if (!this.isThinkingRepetitive(result.thinking)) {
          break; // Success - not repetitive
        }

        attempts++;
        if (attempts <= maxRetries) {
          // Small delay before retry
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Final update — parse the response for edit blocks and render
      // the text portion as Markdown.
      if (!result) {
        throw new Error('Failed to generate response after retries');
      }
      this.messages[msgIdx].content = result.response;
      this.messages[msgIdx].thinking = result.thinking || undefined;
      // Also strip <think> tags from the content in case the model
      // embedded them inline (some models do this regardless of
      // structured thinking support).
      if (this.messages[msgIdx].content.includes('<think>')) {
        const thinkParts: string[] = [];
        this.messages[msgIdx].content = this.messages[msgIdx].content.replace(
          /<think>([\s\S]*?)<\/think>/g,
          (_, inner: string) => { thinkParts.push(inner.trim()); return ''; },
        );
        this.messages[msgIdx].content = this.messages[msgIdx].content.trim();
        if (thinkParts.length > 0) {
          this.messages[msgIdx].thinking =
            ((this.messages[msgIdx].thinking ?? '') + '\n\n' + thinkParts.join('\n\n')).trim();
        }
      }
      await this.applyEditsFromResponse(result.response, chapterFile);
      this.renderMessages();
      this.scrollToBottom();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      new Notice(t('aiChat.error', { error: errMsg }));
      // Remove the empty assistant message if nothing was generated
      if (this.messages.length > 0 && this.messages[this.messages.length - 1].role === 'assistant' && !this.messages[this.messages.length - 1].content) {
        this.messages.pop();
      }
      this.renderMessages();
    } finally {
      this.isGenerating = false;
      this.sendBtn.textContent = t('aiChat.send');
      this.sendBtn.classList.remove('is-stop');
      this.inputEl.disabled = false;
      this.updateStatus();
      this.saveSession();
    }
  }

  /** Abort the in-flight generation. */
  private stopGeneration(): void {
    if (!this.isGenerating) return;
    this.plugin.ollamaService?.cancel();
  }

  /**
   * Detect if the thinking content is repetitive/stuck.
   * Returns true if the same sentence is repeated at the end.
   */
  private isThinkingRepetitive(thinking: string): boolean {
    if (!thinking || thinking.length < 50) return false;
    
    // Normalize: remove extra whitespace and convert to lowercase
    const normalized = thinking.toLowerCase().replace(/\s+/g, ' ').trim();
    
    // Split into sentences (rough approximation)
    const sentences = normalized.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
    if (sentences.length < 2) return false;
    
    // Check if the last 2 sentences are the same
    const lastSentence = sentences[sentences.length - 1];
    const secondLastSentence = sentences[sentences.length - 2];
    
    if (lastSentence === secondLastSentence) {
      return true;
    }
    
    // Check if the last sentence is repeated 3+ times in the last 200 chars
    const last200Chars = normalized.slice(-200);
    const lastSentenceShort = lastSentence.slice(0, 50);
    const occurrences = (last200Chars.match(new RegExp(lastSentenceShort.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;
    if (occurrences >= 3) {
      return true;
    }
    
    return false;
  }

  // ─── System prompt construction ──────────────────────────────────

  private async buildSystemPrompt(chapterFile: TFile | null): Promise<string> {
    const parts: string[] = [];

    // Use custom system prompt if set, otherwise use default
    const customPrompt = this.plugin.settings.ollama.systemPrompt?.trim();
    if (customPrompt) {
      parts.push(customPrompt);
    } else {
      // Use default prompt with language placeholder replaced
      parts.push(DEFAULT_SYSTEM_PROMPT.replace('{{LANGUAGE}}', getLanguageName()));
    }

    // Entity summaries
    let chapterName: string | undefined;
    let sceneName: string | undefined;
    let actName: string | undefined;

    if (chapterFile) {
      const cache = this.app.metadataCache.getFileCache(chapterFile);
      const fm = cache?.frontmatter;
      chapterName = chapterFile.basename;
      actName = typeof fm?.act === 'string' ? fm.act.trim() : undefined;

      // Try to detect current scene from cursor position
      const mdView = this.findMarkdownViewForFile(chapterFile);
      if (mdView?.editor) {
        const cursor = mdView.editor.getCursor();
        const content = mdView.editor.getValue();
        const lines = content.split('\n');
        for (let i = cursor.line; i >= 0; i--) {
          const m = lines[i].match(/^##\s+(.+)/);
          if (m) {
            sceneName = m[1].trim();
            break;
          }
        }
      }
    }

    const entities = await this.plugin.collectEntitySummaries(chapterName, sceneName, actName);
    if (entities.length > 0) {
      parts.push('## Known Entities\n');
      parts.push(this.formatEntities(entities));
      parts.push('');
    }

    // Chapter content — send with line numbers so the LLM can
    // reference specific lines for editing.
    if (chapterFile) {
      const content = await this.app.vault.read(chapterFile);
      parts.push(`## Current Chapter: ${chapterFile.basename}\n`);
      const numbered = content.split('\n').map((line, i) => `L${i + 1}: ${line}`).join('\n');
      parts.push(numbered);
      parts.push('');
    }

    // Instructions for file editing
    parts.push(
      '## File Editing\n' +
      'You are allowed to edit the chapter file the user is currently working on — and ONLY that file. ' +
      'The chapter content above is shown with line numbers (L1, L2, …). ' +
      'To edit the file, use the following block format:\n\n' +
      '```novalist-edit\n' +
      'LINES <start>-<end>\n' +
      'replacement text here\n' +
      '(can be multiple lines)\n' +
      '```\n\n' +
      'Rules:\n' +
      '- `<start>` and `<end>` are inclusive 1-based line numbers from the chapter above.\n' +
      '- The replacement text replaces lines `<start>` through `<end>` (inclusive).\n' +
      '- To insert new lines without removing existing ones, use the same line number for start and end ' +
      'and include the original line plus the new lines.\n' +
      '- To delete lines, use an empty replacement (just the LINES header).\n' +
      '- You can include multiple edit blocks in a single response. ' +
      'They will be applied from bottom to top so line numbers stay valid.\n' +
      '- Always explain what you are changing and why outside the edit block.\n' +
      '- Do NOT edit any other files (characters, locations, items, lore). ' +
      'If no chapter file is open, do not propose edits.\n'
    );

    return parts.join('\n');
  }

  private formatEntities(entities: EntitySummary[]): string {
    const grouped: Record<string, EntitySummary[]> = {};
    for (const e of entities) {
      (grouped[e.type] ??= []).push(e);
    }
    const lines: string[] = [];
    for (const [type, group] of Object.entries(grouped)) {
      lines.push(`### ${type.charAt(0).toUpperCase() + type.slice(1)}s`);
      for (const e of group) {
        lines.push(`- **${e.name}**: ${e.details}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  // ─── Edit application ───────────────────────────────────────────

  private async applyEditsFromResponse(response: string, chapterFile: TFile | null): Promise<void> {
    if (!chapterFile) return;

    const normalizedResponse = response.replace(/\r\n/g, '\n');

    // Parse line-range edit blocks:
    //   ```novalist-edit
    //   LINES <start>-<end>
    //   replacement text
    //   ```
    const editRegex = /```novalist-edit[ \t]*\nLINES[ \t]+(\d+)[ \t]*-[ \t]*(\d+)[ \t]*\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;

    interface LineEdit { start: number; end: number; replacement: string }
    const edits: LineEdit[] = [];

    while ((match = editRegex.exec(normalizedResponse)) !== null) {
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      // The replacement text may have a trailing newline before the
      // closing ```.  Strip exactly one trailing newline if present.
      let replacement = match[3];
      if (replacement.endsWith('\n')) {
        replacement = replacement.slice(0, -1);
      }
      if (start >= 1 && end >= start) {
        edits.push({ start, end, replacement });
      }
    }

    if (edits.length === 0) return;

    // Sort edits by start line DESCENDING so we apply from bottom to top
    // and earlier line numbers are not shifted by later edits.
    edits.sort((a, b) => b.start - a.start);

    let content = await this.app.vault.read(chapterFile);
    content = content.replace(/\r\n/g, '\n');
    const lines = content.split('\n');
    let editsApplied = 0;

    for (const edit of edits) {
      const startIdx = edit.start - 1; // 0-based
      const endIdx = edit.end - 1;

      if (startIdx < 0 || endIdx >= lines.length) continue;

      const replacementLines = edit.replacement === '' ? [] : edit.replacement.split('\n');
      lines.splice(startIdx, endIdx - startIdx + 1, ...replacementLines);
      editsApplied++;
    }

    if (editsApplied > 0) {
      await this.app.vault.modify(chapterFile, lines.join('\n'));
      new Notice(t('aiChat.editsApplied', { count: String(editsApplied) }));
    }
  }

  // ─── Rendering ──────────────────────────────────────────────────

  private renderEmptyState(): void {
    this.chatContainer.empty();
    const empty = this.chatContainer.createDiv('novalist-ai-chat-empty');
    empty.createEl('span', { text: t('aiChat.emptyState'), cls: 'novalist-ai-chat-empty-text' });
  }

  private renderMessages(): void {
    this.chatContainer.empty();

    if (this.messages.length === 0) {
      this.renderEmptyState();
      return;
    }

    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i];
      const bubble = this.chatContainer.createDiv({
        cls: `novalist-ai-chat-msg is-${msg.role}`,
        attr: { 'data-index': String(i) },
      });

      const roleLabel = bubble.createDiv('novalist-ai-chat-msg-role');
      roleLabel.textContent = msg.role === 'user' ? t('aiChat.you') : t('aiChat.assistant');

      // ── Thinking / reasoning section (collapsible) ──
      if (msg.role === 'assistant') {
        const hasThinking = !!(msg.thinking && msg.thinking.trim());
        const thinkingDetails = bubble.createEl('details', {
          cls: 'novalist-ai-chat-thinking',
        });
        // Hide by default when empty; will be shown during streaming when
        // the first thinking token arrives.
        if (!hasThinking && !this.isGenerating) {
          thinkingDetails.addClass('is-hidden');
        }
        const summary = thinkingDetails.createEl('summary', {
          cls: 'novalist-ai-chat-thinking-summary',
        });
        summary.textContent = t('aiChat.thinking');
        const thinkingContent = thinkingDetails.createDiv('novalist-ai-chat-thinking-content');
        if (hasThinking) {
          void MarkdownRenderer.render(
            this.app,
            msg.thinking,
            thinkingContent,
            '',
            this.renderComponent,
          );
        }
      }

      const contentEl = bubble.createDiv('novalist-ai-chat-msg-content');

      if (msg.role === 'assistant' && msg.content) {
        // Strip novalist-edit blocks from displayed content — show a
        // summary badge instead.
        const displayContent = this.stripEditBlocks(msg.content);
        void MarkdownRenderer.render(
          this.app,
          displayContent,
          contentEl,
          '',
          this.renderComponent,
        );
      } else {
        contentEl.textContent = msg.content || '…';
      }
    }

    this.scrollToBottom();
  }

  /** Remove ```novalist-edit``` fences from display text and add an
   *  "[edits applied]" badge so the user sees what happened. */
  private stripEditBlocks(text: string): string {
    const editPattern = /```novalist-edit\s*\n[\s\S]*?\n```/g;
    let editCount = 0;
    const cleaned = text.replace(editPattern, () => {
      editCount++;
      return '';
    });
    if (editCount > 0) {
      return cleaned.trim() + `\n\n*${t('aiChat.editsAppliedBadge', { count: String(editCount) })}*`;
    }
    return cleaned;
  }

  private clearChat(): void {
    this.messages = [];
    this.renderMessages();
    this.saveSession();

    // Reset the server-side session so the model forgets prior turns.
    if (this.plugin.ollamaService) {
      void this.plugin.ollamaService.resetChatSession();
    }
  }

  // ─── Session persistence ────────────────────────────────────────

  private saveSession(): void {
    try {
      const data = JSON.stringify(this.messages);
      this.app.saveLocalStorage(CHAT_SESSION_STORAGE_KEY, data);
    } catch { /* ignore quota errors */ }
  }

  private restoreSession(): void {
    try {
      const raw = this.app.loadLocalStorage(CHAT_SESSION_STORAGE_KEY) as string | null;
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.messages = parsed;
        }
      }
    } catch { /* corrupted data — start fresh */ }
  }

  private scrollToBottom(): void {
    activeWindow.requestAnimationFrame(() => {
      this.autoScrollElement(this.scrollContainer);
    });
  }

  /** Scroll an element to its bottom unless the user has scrolled up. */
  private autoScrollElement(el: HTMLElement): void {
    const threshold = 40;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }
}
