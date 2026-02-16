import { requestUrl, RequestUrlParam } from 'obsidian';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import type { AiProvider, AiAnalysisMode } from '../types';

// ─── Types ──────────────────────────────────────────────────────────

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream: false;
  options?: {
    temperature?: number;
    num_predict?: number;
  };
}

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
}

export type AiFindingType = 'reference' | 'inconsistency' | 'suggestion';

export interface AiFinding {
  type: AiFindingType;
  /** Short heading for the finding. */
  title: string;
  /** Detailed description returned by the model. */
  description: string;
  /** The relevant text excerpt from the chapter (if any). */
  excerpt?: string;
  /** Entity name this finding relates to (if any). */
  entityName?: string;
  /** Entity type (character / location / item / lore) if applicable. */
  entityType?: string;
}

export interface EntitySummary {
  name: string;
  type: 'character' | 'location' | 'item' | 'lore';
  details: string;
}

/** Contextual information about the chapter being analysed. */
export interface ChapterContext {
  chapterName: string;
  actName?: string;
  sceneName?: string;
}

/** Which analysis tasks to include in the request. */
export interface EnabledChecks {
  references: boolean;
  inconsistencies: boolean;
  suggestions: boolean;
}

// ─── Copilot ACP Client ─────────────────────────────────────────────

/** Shape of a model entry in the ACP session/new response. */
interface AcpAvailableModel {
  modelId: string;
  name: string;
  description?: string;
}

/** Models block returned by session/new. */
interface AcpModelsBlock {
  availableModels?: AcpAvailableModel[];
  currentModelId?: string;
}

/** Shape of a config option (configOptions) from ACP session/new response. */
interface AcpConfigOption {
  id?: string;
  category?: string;
  currentValue?: string;
}

/** Simplified model entry exposed to the settings UI. */
export interface CopilotModelInfo {
  id: string;
  name: string;
}

/**
 * Lightweight Agent Client Protocol (ACP) client that communicates with
 * GitHub Copilot CLI over NDJSON/stdio.
 */
class CopilotAcpClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private buffer = '';
  private sessionId: string | null = null;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }>();
  /** Accumulates text chunks from the current prompt. */
  private promptText = '';
  /** Absolute path used as cwd for sessions. */
  vaultPath = '';
  /** Optional callback invoked on each streamed thinking/reasoning chunk. */
  onThinkingChunk: ((text: string) => void) | null = null;
  /** Desired model id (empty = use Copilot default). */
  modelId = '';
  /** Config option id for the model selector (discovered at session start). */
  private modelConfigId: string | null = null;
  /** Cached available models from last session/new response. */
  private cachedModels: CopilotModelInfo[] = [];
  /** Cached environment with full PATH from login shell (macOS/Linux fix). */
  private resolvedEnv: typeof process.env | null = null;

  constructor(private execPath: string) {}

  /** Whether the process is alive. */
  get isAlive(): boolean {
    return this.proc !== null && this.proc.exitCode === null;
  }

  /**
   * Resolve the user's login-shell PATH on macOS / Linux.
   *
   * GUI apps (Electron / Obsidian) inherit a minimal PATH that usually
   * does not contain directories like /usr/local/bin or ~/.local/bin
   * where CLI tools are installed.  Spawning the user's login shell
   * with `-lc` gives us the full interactive PATH.
   */
  private async getEnv(): Promise<typeof process.env> {
    if (this.resolvedEnv) return this.resolvedEnv;

    if (process.platform === 'win32') {
      this.resolvedEnv = process.env;
      return this.resolvedEnv;
    }

    const userShell = process.env['SHELL'] ?? '/bin/sh';
    const fullPath = await new Promise<string | null>((resolve) => {
      try {
        const p = spawn(userShell, ['-lc', 'printf "%s" "$PATH"'], {
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        let out = '';
        p.stdout?.on('data', (c: Buffer) => { out += c.toString(); });
        p.on('error', () => resolve(null));
        p.on('exit', () => resolve(out.trim() || null));
        setTimeout(() => { p.kill(); resolve(null); }, 3000);
      } catch {
        resolve(null);
      }
    });

    console.debug('[Novalist ACP] Resolved login-shell PATH:', fullPath ? 'ok' : 'fallback');
    this.resolvedEnv = fullPath ? { ...process.env, PATH: fullPath } : process.env;
    return this.resolvedEnv;
  }

  /** Start the ACP process, initialize, and create a session. */
  async start(): Promise<void> {
    if (this.isAlive && this.sessionId) return;

    await this.stop();
    this.sessionId = null;

    const env = await this.getEnv();
    console.debug('[Novalist ACP] Spawning:', this.execPath, '--acp --stdio');
    this.proc = spawn(this.execPath, ['--acp', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    this.buffer = '';
    this.proc.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.proc.stderr?.on('data', (chunk: Buffer) => {
      console.warn('[Novalist ACP] stderr:', chunk.toString());
    });

    this.proc.on('error', (err: Error) => {
      console.error('[Novalist ACP] Process error:', err.message);
      for (const [, p] of this.pendingRequests) {
        p.reject(err);
      }
      this.pendingRequests.clear();
      this.proc = null;
    });

    this.proc.on('exit', (code) => {
      console.debug('[Novalist ACP] Process exited with code:', code);
      this.proc = null;
      this.sessionId = null;
    });

    // Initialize the ACP connection
    await this.rpcRequest('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: {
        name: 'novalist',
        title: 'Novalist',
        version: '1.0.0',
      },
    });

    // Create a session
    const sessionResult = await this.rpcRequest('session/new', {
      cwd: this.vaultPath || process.cwd(),
      mcpServers: [],
    }) as { sessionId: string; models?: AcpModelsBlock; configOptions?: AcpConfigOption[] };
    this.sessionId = sessionResult.sessionId;

    // Cache available models from the response
    this.parseModels(sessionResult);

    // Discover config option id for model selector (if available via configOptions)
    this.modelConfigId = null;
    if (sessionResult.configOptions) {
      for (const opt of sessionResult.configOptions) {
        if (opt.category === 'model' && opt.id) {
          this.modelConfigId = opt.id;
          break;
        }
      }
    }

    // Apply the desired model if one is configured
    if (this.modelId) {
      await this.selectModel(this.modelId);
    }
  }

  /** Stop the ACP process. */
  async stop(): Promise<void> {
    if (!this.proc) return;
    const p = this.proc;
    this.proc = null;
    this.sessionId = null;
    p.stdin?.end();
    p.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 2000);
      p.once('exit', () => { clearTimeout(timeout); resolve(); });
    });
  }

  /** Destroy the current session and create a fresh one so
   *  server-side conversation history is discarded. */
  async resetSession(): Promise<void> {
    if (!this.isAlive || !this.sessionId) return;
    const sessionResult = await this.rpcRequest('session/new', {
      cwd: this.vaultPath || process.cwd(),
      mcpServers: [],
    }) as { sessionId: string; models?: AcpModelsBlock; configOptions?: AcpConfigOption[] };
    this.sessionId = sessionResult.sessionId;
    this.parseModels(sessionResult);
    if (this.modelId) {
      await this.selectModel(this.modelId);
    }
  }

  /** Send a cancel notification to abort the current prompt. */
  cancelPrompt(): void {
    if (this.sessionId && this.proc?.stdin?.writable) {
      this.sendMessage({
        jsonrpc: '2.0',
        method: 'session/cancel',
        params: { sessionId: this.sessionId },
      });
    }
  }

  /** Optional callback invoked on each streamed text chunk. */
  onChunk: ((text: string) => void) | null = null;

  /** Send a text prompt and return the full response text. */
  async generate(prompt: string): Promise<string> {
    if (!this.isAlive || !this.sessionId) {
      await this.start();
    }

    this.promptText = '';

    const result = await this.rpcRequest('session/prompt', {
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text: prompt }],
    }) as { stopReason: string };

    const text = this.promptText;
    this.promptText = '';

    console.debug(`[Novalist ACP] Prompt done — stopReason: ${result.stopReason}, text length: ${text.length}`);

    if (result.stopReason !== 'end_turn') {
      throw new Error(`Copilot stopped with reason: ${result.stopReason}`);
    }

    return text;
  }

  /** Check whether the Copilot CLI is reachable by spawning a short-lived process. */
  async isAvailable(): Promise<boolean> {
    const env = await this.getEnv();
    return new Promise<boolean>((resolve) => {
      try {
        const p = spawn(this.execPath, ['--help'], { stdio: ['ignore', 'pipe', 'pipe'], env });
        let done = false;
        const finish = (ok: boolean): void => {
          if (done) return;
          done = true;
          resolve(ok);
        };
        p.on('error', () => finish(false));
        p.on('exit', (code) => finish(code === 0));
        setTimeout(() => { p.kill(); finish(false); }, 5000);
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Enumerate available models. Uses the cached list from the last
   * session/new response. Starts the process if needed.
   */
  async listModels(): Promise<CopilotModelInfo[]> {
    if (!this.isAlive || !this.sessionId) {
      await this.start();
    }
    return this.cachedModels;
  }

  // ── model helpers ───────────────────────────────────────────

  /** Parse models from a session/new response and cache them. */
  private parseModels(result: { models?: AcpModelsBlock; configOptions?: AcpConfigOption[] }): void {
    this.cachedModels = [];

    // Primary path: models.availableModels (Copilot CLI)
    if (result.models?.availableModels) {
      for (const m of result.models.availableModels) {
        this.cachedModels.push({ id: m.modelId, name: m.name ?? m.modelId });
      }
    }
  }

  /** Select a model for this session. Also callable externally after model change. */
  async applyModel(modelId: string): Promise<void> {
    if (!this.isAlive || !this.sessionId) return;
    await this.selectModel(modelId);
  }

  /** Select a model for this session via the best available mechanism. */
  private async selectModel(modelId: string): Promise<void> {
    // Try session/set_config_option first (generic ACP path)
    if (this.modelConfigId) {
      try {
        await this.rpcRequest('session/set_config_option', {
          sessionId: this.sessionId,
          configId: this.modelConfigId,
          value: modelId,
        });
        return;
      } catch {
        // fall through to set_model
      }
    }

    // Try session/set_model (Copilot-specific path)
    try {
      await this.rpcRequest('session/set_model', {
        sessionId: this.sessionId,
        modelId,
      });
    } catch {
      console.warn(`[Novalist ACP] Could not set model to ${modelId}`);
    }
  }

  // ── internal helpers ──────────────────────────────────────────

  private sendMessage(msg: object): void {
    if (!this.proc?.stdin?.writable) {
      console.warn('[Novalist ACP] Cannot send — stdin not writable');
      return;
    }
    const json = JSON.stringify(msg);
    console.debug('[Novalist ACP] >>>', json.length > 500 ? json.slice(0, 500) + '…' : json);
    this.proc.stdin.write(json + '\n');
  }

  private async rpcRequest(method: string, params: object): Promise<unknown> {
    const id = this.nextId++;
    console.debug(`[Novalist ACP] RPC request #${id}: ${method}`);
    return new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.sendMessage({ jsonrpc: '2.0', id, method, params });
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as Record<string, unknown>;
        // Log everything except verbose chunk notifications
        const update = (msg['params'] as Record<string, unknown> | undefined)?.['update'] as Record<string, unknown> | undefined;
        const sessionUpdate = update?.['sessionUpdate'] as string | undefined;
        if (sessionUpdate === 'agent_message_chunk' || sessionUpdate === 'agent_thought_chunk') {
          const c = update['content'] as { text?: string } | undefined;
          console.debug(`[Novalist ACP] <<< ${sessionUpdate}:`, (c?.text ?? '').slice(0, 120));
        } else {
          console.debug('[Novalist ACP] <<<', trimmed.length > 500 ? trimmed.slice(0, 500) + '…' : trimmed);
        }
        this.handleMessage(msg);
      } catch {
        console.warn('[Novalist ACP] Invalid JSON line:', trimmed.slice(0, 200));
      }
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    // Response to one of our requests
    if ('id' in msg && ('result' in msg || 'error' in msg)) {
      const id = msg['id'] as number;
      const pending = this.pendingRequests.get(id);
      if (pending) {
        this.pendingRequests.delete(id);
        if ('error' in msg) {
          const err = msg['error'] as { message?: string };
          pending.reject(new Error(err?.message ?? 'ACP error'));
        } else {
          pending.resolve(msg['result']);
        }
      }
      return;
    }

    // Incoming request from the agent (e.g. permission request)
    if ('id' in msg && 'method' in msg) {
      this.handleIncomingRequest(msg);
      return;
    }

    // Notification (no id)
    if ('method' in msg && !('id' in msg)) {
      this.handleNotification(msg);
    }
  }

  private handleIncomingRequest(msg: Record<string, unknown>): void {
    const method = msg['method'] as string;
    const id = msg['id'] as number;
    if (method === 'session/request_permission') {
      // Auto-reject all permission requests — we only want text generation.
      const params = msg['params'] as Record<string, unknown> | undefined;
      const options = (params?.['options'] ?? []) as Array<{ optionId?: string; kind?: string }>;
      const rejectOpt = options.find(o => o.kind === 'reject_once') ?? options.find(o => o.kind === 'reject_always');
      if (rejectOpt?.optionId) {
        this.sendMessage({ jsonrpc: '2.0', id, result: { outcome: { outcome: 'selected', optionId: rejectOpt.optionId } } });
      } else {
        this.sendMessage({ jsonrpc: '2.0', id, result: { outcome: { outcome: 'cancelled' } } });
      }
    } else {
      this.sendMessage({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not supported' } });
    }
  }

  private handleNotification(msg: Record<string, unknown>): void {
    const method = msg['method'] as string;
    if (method !== 'session/update') return;
    const params = msg['params'] as Record<string, unknown> | undefined;
    const update = params?.['update'] as Record<string, unknown> | undefined;
    if (!update) return;

    if (update['sessionUpdate'] === 'agent_message_chunk') {
      const content = update['content'] as { type?: string; text?: string } | undefined;
      if (content?.type === 'text' && content.text) {
        this.promptText += content.text;
        this.onChunk?.(content.text);
      }
    }

    if (update['sessionUpdate'] === 'agent_thought_chunk') {
      const content = update['content'] as { type?: string; text?: string } | undefined;
      if (content?.type === 'text' && content.text) {
        this.onThinkingChunk?.(content.text);
      }
    }
  }
}

// ─── Service ────────────────────────────────────────────────────────

export class OllamaService {
  private baseUrl: string;
  private model: string;
  private provider: AiProvider;
  private analysisMode: AiAnalysisMode;
  private copilotClient: CopilotAcpClient;
  private abortController: AbortController | null = null;

  constructor(
    baseUrl: string,
    model: string,
    provider: AiProvider = 'ollama',
    analysisMode: AiAnalysisMode = 'paragraph',
    copilotPath = 'copilot',
    vaultPath = '',
    copilotModel = '',
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.model = model;
    this.provider = provider;
    this.analysisMode = analysisMode;
    this.copilotClient = new CopilotAcpClient(copilotPath);
    this.copilotClient.vaultPath = vaultPath;
    this.copilotClient.modelId = copilotModel;
  }

  setModel(model: string): void {
    this.model = model;
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  setProvider(provider: AiProvider): void {
    this.provider = provider;
  }

  setAnalysisMode(mode: AiAnalysisMode): void {
    this.analysisMode = mode;
  }

  setCopilotPath(path: string): void {
    const vp = this.copilotClient.vaultPath;
    const mid = this.copilotClient.modelId;
    this.copilotClient = new CopilotAcpClient(path);
    this.copilotClient.vaultPath = vp;
    this.copilotClient.modelId = mid;
  }

  async setCopilotModel(modelId: string): Promise<void> {
    this.copilotClient.modelId = modelId;
    // If the session is already running, apply the model switch immediately
    if (this.copilotClient.isAlive) {
      await this.copilotClient.applyModel(modelId);
    }
  }

  /** Reset the Copilot ACP session so server-side conversation history
   *  is cleared. No-op when using Ollama (stateless HTTP). */
  async resetChatSession(): Promise<void> {
    if (this.provider === 'copilot') {
      await this.copilotClient.resetSession();
    }
  }

  /** List available models from the Copilot CLI via ACP. */
  async listCopilotModels(): Promise<CopilotModelInfo[]> {
    return this.copilotClient.listModels();
  }

  /** Cancel any in-flight request. */
  cancel(): void {
    if (this.provider === 'copilot') {
      this.copilotClient.cancelPrompt();
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  // ── Connection helpers ──────────────────────────────────────────

  /** Check whether the Ollama server is reachable. */
  async isServerRunning(): Promise<boolean> {
    try {
      await requestUrl({ url: `${this.baseUrl}/api/tags`, method: 'GET' });
      return true;
    } catch {
      return false;
    }
  }

  /** List all models available on the Ollama server. */
  async listModels(): Promise<OllamaModel[]> {
    try {
      const res = await requestUrl({ url: `${this.baseUrl}/api/tags`, method: 'GET' });
      const data = res.json as { models?: OllamaModel[] };
      return data.models ?? [];
    } catch {
      return [];
    }
  }

  /** Check whether the currently configured model is loaded. */
  async isModelLoaded(): Promise<boolean> {
    try {
      const res = await requestUrl({ url: `${this.baseUrl}/api/ps`, method: 'GET' });
      const data = res.json as { models?: Array<{ name: string }> };
      return (data.models ?? []).some(m => m.name === this.model || m.name.startsWith(this.model.split(':')[0]));
    } catch {
      return false;
    }
  }

  /** Load the model (warm it up) by sending a minimal generate call. */
  async loadModel(): Promise<boolean> {
    try {
      const body: OllamaGenerateRequest = {
        model: this.model,
        prompt: '',
        stream: false,
        options: { num_predict: 1 },
      };
      await requestUrl({
        url: `${this.baseUrl}/api/generate`,
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Unload the model from GPU/memory by setting keep_alive to 0. */
  async unloadModel(): Promise<boolean> {
    try {
      await requestUrl({
        url: `${this.baseUrl}/api/generate`,
        method: 'POST',
        body: JSON.stringify({ model: this.model, prompt: '', stream: false, keep_alive: 0 }),
        headers: { 'Content-Type': 'application/json' },
      });
      return true;
    } catch {
      return false;
    }
  }

  // ── Copilot helpers ────────────────────────────────────────────

  /** Check whether the Copilot CLI is reachable. */
  async isCopilotAvailable(): Promise<boolean> {
    return this.copilotClient.isAvailable();
  }

  /** Start the Copilot ACP session (equivalent to loadModel for Ollama). */
  async startCopilot(): Promise<boolean> {
    try {
      await this.copilotClient.start();
      return true;
    } catch {
      return false;
    }
  }

  /** Stop the Copilot ACP session (equivalent to unloadModel for Ollama). */
  async stopCopilot(): Promise<boolean> {
    try {
      await this.copilotClient.stop();
      return true;
    } catch {
      return false;
    }
  }

  /** Whether the Copilot process is currently alive. */
  get isCopilotRunning(): boolean {
    return this.copilotClient.isAlive;
  }

  // ── Generation ─────────────────────────────────────────────────

  private async generate(prompt: string, temperature = 0.3, maxTokens = 4096): Promise<string> {
    if (this.provider === 'copilot') {
      return this.copilotClient.generate(prompt);
    }
    return this.generateOllama(prompt, temperature, maxTokens);
  }

  private async generateOllama(prompt: string, temperature: number, maxTokens: number): Promise<string> {
    this.abortController = new AbortController();
    const body: OllamaGenerateRequest = {
      model: this.model,
      prompt,
      stream: false,
      options: { temperature, num_predict: maxTokens },
    };

    const params: RequestUrlParam = {
      url: `${this.baseUrl}/api/generate`,
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    };

    const res = await requestUrl(params);
    this.abortController = null;
    const data = res.json as OllamaGenerateResponse;
    return data.response ?? '';
  }

  // ── Streaming chat generation ──────────────────────────────────

  /**
   * Generate a chat completion with streaming, invoking `onChunk` for each
   * token as it arrives.  Returns the full response text once complete.
   *
   * The `messages` array uses OpenAI-style roles: system, user, assistant.
   *
   * `onThinkingChunk` is called for thinking/reasoning tokens emitted by
   * models that support chain-of-thought (e.g. DeepSeek-R1, Qwen3).
   */
  async generateChat(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    onChunk: (token: string) => void,
    temperature = 0.7,
    maxTokens = 8192,
    onThinkingChunk?: (token: string) => void,
  ): Promise<{ response: string; thinking: string }> {
    if (this.provider === 'copilot') {
      return this.generateChatCopilot(messages, onChunk, onThinkingChunk);
    }
    return this.generateChatOllama(messages, onChunk, temperature, maxTokens, onThinkingChunk);
  }

  private async generateChatOllama(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    onChunk: (token: string) => void,
    temperature: number,
    maxTokens: number,
    onThinkingChunk?: (token: string) => void,
  ): Promise<{ response: string; thinking: string }> {
    this.abortController = new AbortController();
    const body = {
      model: this.model,
      messages,
      stream: true,
      options: { temperature, num_predict: maxTokens },
    };

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: this.abortController.signal,
    });

    if (!response.ok || !response.body) {
      this.abortController = null;
      throw new Error(`Ollama chat request failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let thinkingText = '';
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const json = JSON.parse(trimmed) as { message?: { content?: string; thinking?: string }; done?: boolean };
            const thinking = json.message?.thinking ?? '';
            if (thinking) {
              thinkingText += thinking;
              onThinkingChunk?.(thinking);
            }
            const token = json.message?.content ?? '';
            if (token) {
              fullText += token;
              onChunk(token);
            }
          } catch { /* skip malformed lines */ }
        }
      }
    } finally {
      this.abortController = null;
    }

    return { response: fullText, thinking: thinkingText };
  }

  private async generateChatCopilot(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    onChunk: (token: string) => void,
    onThinkingChunk?: (token: string) => void,
  ): Promise<{ response: string; thinking: string }> {
    // Copilot ACP doesn't have a native chat-messages API, so we
    // flatten the messages into a single prompt and stream via the
    // existing `generate` method with the onChunk callback.
    this.copilotClient.onChunk = onChunk;
    this.copilotClient.onThinkingChunk = onThinkingChunk ?? null;
    let thinkingText = '';
    const origThinkCb = onThinkingChunk;
    if (origThinkCb) {
      // Capture thinking tokens streamed via ACP notifications.
      this.copilotClient.onThinkingChunk = (t: string) => {
        thinkingText += t;
        origThinkCb(t);
      };
    }
    const prompt = messages.map(m => {
      if (m.role === 'system') return `[System]\n${m.content}`;
      if (m.role === 'assistant') return `[Assistant]\n${m.content}`;
      return `[User]\n${m.content}`;
    }).join('\n\n');
    try {
      const raw = await this.copilotClient.generate(prompt);
      // Some models also emit thinking wrapped in <think>…</think>
      // tags inline.  Extract it so we can display it separately.
      const thinkParts: string[] = [];
      const cleaned = raw.replace(/<think>([\s\S]*?)<\/think>/g, (_, inner: string) => {
        thinkParts.push(inner.trim());
        origThinkCb?.(inner.trim());
        return '';
      });
      if (thinkParts.length > 0) {
        thinkingText = (thinkingText + '\n\n' + thinkParts.join('\n\n')).trim();
      }
      return { response: cleaned.trim(), thinking: thinkingText };
    } finally {
      this.copilotClient.onChunk = null;
      this.copilotClient.onThinkingChunk = null;
    }
  }

  // ── Analysis methods ───────────────────────────────────────────

  /**
   * Split text into paragraphs suitable for per-paragraph LLM analysis.
   * Splits on blank lines.  Very short consecutive paragraphs (headings,
   * single-line dialogue) are merged so we don't flood the LLM with tiny
   * requests.
   */
  static splitParagraphs(text: string): string[] {
    // Split on one or more blank lines
    const raw = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
    if (raw.length === 0) return [];

    // Merge very short consecutive blocks so each chunk is ≥ 120 chars
    const merged: string[] = [];
    let buf = '';
    for (const p of raw) {
      if (buf.length === 0) {
        buf = p;
      } else if (buf.length + p.length < 300) {
        buf += '\n\n' + p;
      } else {
        merged.push(buf);
        buf = p;
      }
    }
    if (buf.length > 0) merged.push(buf);
    return merged;
  }

  /** Build the task instructions block shared by paragraph and chapter prompts. */
  private buildTaskInstructions(checks: EnabledChecks, alreadyFound?: string[]): string[] {
    const tasks: string[] = [];
    let taskNum = 1;
    const doRefs = checks.references;
    const doIncon = checks.inconsistencies;
    const doSug = checks.suggestions;

    if (doRefs) {
      tasks.push(`${taskNum}. **References** ("type":"reference"): Find places where a known entity is referenced INDIRECTLY — through relationship terms (e.g. "his wife", "her mother"), pronouns that resolve to a specific entity, nicknames, or abbreviated names. Direct name mentions that simple regex matching would catch should NOT be reported.${alreadyFound && alreadyFound.length > 0 ? ' The regex system has already found: ' + alreadyFound.join(', ') + '. Only report references the regex missed.' : ''} Use the relationship data to resolve indirect references to the correct entity. For each reference, set entityName to the full entity name.`);
      taskNum++;
    }
    if (doIncon) {
      tasks.push(`${taskNum}. **Inconsistencies** ("type":"inconsistency"): Compare the text against the known entity details (e.g. hair colour, eye colour, gender, location description, item properties). Also use relationships to check indirect references — e.g. if "his wife" is described with blue eyes but the resolved character has brown eyes, report it. Report any contradictions.`);
      taskNum++;
    }
    if (doSug) {
      tasks.push(`${taskNum}. **Suggestions** ("type":"suggestion"): Identify character names, place names, or notable objects mentioned in the text that do NOT match any known entity and could be added as new entities.`);
    }
    return tasks;
  }

  /**
   * Analyse a single paragraph against known entities.
   * Smaller context → more deterministic output than whole-chapter analysis.
   */
  async analyseParagraph(
    paragraph: string,
    entities: EntitySummary[],
    alreadyFound?: string[],
    context?: ChapterContext,
    checks?: EnabledChecks,
  ): Promise<AiFinding[]> {
    const doRefs = checks?.references ?? true;
    const doIncon = checks?.inconsistencies ?? true;
    const doSug = checks?.suggestions ?? true;
    if (!doRefs && !doIncon && !doSug) return [];

    const entityBlock = entities.map(e => `- [${e.type}] ${e.name}: ${e.details}`).join('\n');

    const alreadyFoundBlock = alreadyFound && alreadyFound.length > 0
      ? `\nEntities already detected by regex matching (DO NOT report these as basic name-match references — only report them if you find an INDIRECT reference such as a pronoun, nickname, relationship term, or abbreviated name that the regex cannot catch):\n${alreadyFound.join(', ')}\n`
      : '';

    const contextBlock = context
      ? `\nChapter context: Chapter "${context.chapterName}"${context.actName ? `, Act "${context.actName}"` : ''}${context.sceneName ? `, Scene "${context.sceneName}"` : ''}. The entity details above already reflect any act/chapter/scene-specific overrides.\n`
      : '';

    const tasks = this.buildTaskInstructions({ references: doRefs, inconsistencies: doIncon, suggestions: doSug }, alreadyFound);

    const prompt = `You are a fiction-writing assistant analysing a short passage from a novel. The project tracks entities (characters, locations, items, lore) by matching their names as plain text — no special markup is used.

Known entities (note: relationship fields tell you who is connected — e.g. if John Doe has "Wife: Jane Doe", then "his wife" refers to Jane Doe):
${entityBlock || '(no entities registered yet)'}
${alreadyFoundBlock}${contextBlock}
Passage:
"""
${paragraph}
"""

Perform the following task(s) and return ONLY a JSON array (no markdown fences, no explanation outside the array). Each element must be an object with these fields:
- "type": one of "reference", "inconsistency", or "suggestion"
- "title": short heading (max 80 chars)
- "description": concise explanation
- "excerpt": the EXACT text from the passage that this finding refers to (verbatim copy, max 120 chars). This will be used to locate the finding in the document.
- "entityName": the entity name this relates to (or empty string)
- "entityType": "character", "location", "item", "lore", or empty string

${tasks.join('\n')}

If a task has no findings, simply omit entries for it. Return an empty array [] if nothing is found.`;

    const raw = await this.generate(prompt, 0, 2048);
    return this.parseFindings(raw);
  }

  /**
   * Analyse an entire chapter in a single LLM call.
   * Better for large-context models; gives the LLM full narrative context.
   */
  async analyseChapterWhole(
    chapterText: string,
    entities: EntitySummary[],
    alreadyFound?: string[],
    context?: ChapterContext,
    checks?: EnabledChecks,
  ): Promise<AiFinding[]> {
    const doRefs = checks?.references ?? true;
    const doIncon = checks?.inconsistencies ?? true;
    const doSug = checks?.suggestions ?? true;
    if (!doRefs && !doIncon && !doSug) return [];

    const entityBlock = entities.map(e => `- [${e.type}] ${e.name}: ${e.details}`).join('\n');

    const alreadyFoundBlock = alreadyFound && alreadyFound.length > 0
      ? `\nEntities already detected by regex matching (DO NOT report these as basic name-match references — only report them if you find an INDIRECT reference such as a pronoun, nickname, relationship term, or abbreviated name that the regex cannot catch):\n${alreadyFound.join(', ')}\n`
      : '';

    const contextBlock = context
      ? `\nChapter context: Chapter "${context.chapterName}"${context.actName ? `, Act "${context.actName}"` : ''}${context.sceneName ? `, Scene "${context.sceneName}"` : ''}. The entity details above already reflect any act/chapter/scene-specific overrides.\n`
      : '';

    const tasks = this.buildTaskInstructions({ references: doRefs, inconsistencies: doIncon, suggestions: doSug }, alreadyFound);

    const prompt = `You are a fiction-writing assistant analysing a COMPLETE chapter from a novel. The project tracks entities (characters, locations, items, lore) by matching their names as plain text — no special markup is used. You have the full chapter text, so you can detect cross-paragraph patterns and narrative-level inconsistencies.

Known entities (note: relationship fields tell you who is connected — e.g. if John Doe has "Wife: Jane Doe", then "his wife" refers to Jane Doe):
${entityBlock || '(no entities registered yet)'}
${alreadyFoundBlock}${contextBlock}
Full chapter text:
"""
${chapterText}
"""

Perform the following task(s) and return ONLY a JSON array (no markdown fences, no explanation outside the array). Each element must be an object with these fields:
- "type": one of "reference", "inconsistency", or "suggestion"
- "title": short heading (max 80 chars)
- "description": concise explanation
- "excerpt": the EXACT text from the chapter that this finding refers to (verbatim copy, max 120 chars). This will be used to locate the finding in the document.
- "entityName": the entity name this relates to (or empty string)
- "entityType": "character", "location", "item", "lore", or empty string

${tasks.join('\n')}

If a task has no findings, simply omit entries for it. Return an empty array [] if nothing is found.`;

    const raw = await this.generate(prompt, 0, 8192);
    return this.parseFindings(raw);
  }

  /**
   * Analyse chapter text paragraph-by-paragraph.
   * Reports progress via an optional callback: (done, total) => void.
   * Returns the aggregated findings.
   *
   * When {@link useWholeChapter} is true (or the service-level analysisMode
   * is 'chapter'), the entire text is sent as a single prompt instead.
   */
  async analyseChapter(
    chapterText: string,
    entities: EntitySummary[],
    alreadyFound?: string[],
    context?: ChapterContext,
    checks?: EnabledChecks,
    onProgress?: (done: number, total: number) => void,
    paragraphHashes?: Map<number, string>,
    cachedFindings?: Map<number, AiFinding[]>,
    useWholeChapter?: boolean,
  ): Promise<{ findings: AiFinding[]; hashes: Map<number, string> }> {
    const wholeChapter = useWholeChapter ?? (this.analysisMode === 'chapter');

    if (wholeChapter) {
      onProgress?.(0, 1);
      const findings = await this.analyseChapterWhole(chapterText, entities, alreadyFound, context, checks);
      onProgress?.(1, 1);
      return { findings, hashes: new Map() };
    }

    const doRefs = checks?.references ?? true;
    const doIncon = checks?.inconsistencies ?? true;
    const doSug = checks?.suggestions ?? true;
    if (!doRefs && !doIncon && !doSug) return { findings: [], hashes: new Map() };

    const paragraphs = OllamaService.splitParagraphs(chapterText);
    const total = paragraphs.length;
    const newHashes = new Map<number, string>();
    const allFindings: AiFinding[] = [];

    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i];
      const hash = this.hashStr(p);
      newHashes.set(i, hash);

      // Skip unchanged paragraphs when hashes are provided
      if (paragraphHashes && paragraphHashes.get(i) === hash && cachedFindings) {
        const cached = cachedFindings.get(i) ?? [];
        allFindings.push(...cached);
        onProgress?.(i + 1, total);
        continue;
      }

      const findings = await this.analyseParagraph(p, entities, alreadyFound, context, checks);
      // Tag findings with paragraph index for caching
      for (const f of findings) {
        (f as AiFinding & { _paraIdx?: number })._paraIdx = i;
      }
      allFindings.push(...findings);
      onProgress?.(i + 1, total);
    }

    return { findings: allFindings, hashes: newHashes };
  }

  // ── Helpers ────────────────────────────────────────────────────

  /** Simple string hash (same algorithm used by the sidebar). */
  private hashStr(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return String(hash);
  }

  // ── JSON parsing ───────────────────────────────────────────────

  private parseFindings(raw: string): AiFinding[] {
    // Strip markdown code fences if the model wraps them anyway
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }
    // Try to extract the first JSON array
    const startIdx = cleaned.indexOf('[');
    const endIdx = cleaned.lastIndexOf(']');
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return [];
    const jsonStr = cleaned.substring(startIdx, endIdx + 1);
    try {
      const parsed: unknown = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is AiFinding => {
        if (typeof item !== 'object' || item === null) return false;
        const obj = item as Record<string, unknown>;
        return (
          typeof obj['type'] === 'string' &&
          typeof obj['title'] === 'string' &&
          typeof obj['description'] === 'string'
        );
      }).map(f => ({
        type: f.type,
        title: f.title,
        description: f.description,
        excerpt: f.excerpt ?? '',
        entityName: f.entityName ?? '',
        entityType: f.entityType ?? '',
      }));
    } catch {
      return [];
    }
  }
}
