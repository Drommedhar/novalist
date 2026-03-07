import { requestUrl } from 'obsidian';
import { spawn, type ChildProcess } from 'child_process';
import type { AiProvider, AiAnalysisMode } from '../types';
import { getLanguageName } from '../i18n';

// ─── Types ──────────────────────────────────────────────────────────

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

export type AiFindingType = 'reference' | 'inconsistency' | 'suggestion' | 'scene_stats';

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
  /** AI-determined POV character name (only for type "scene_stats"). */
  scenePov?: string;
  /** AI-determined dominant emotion (only for type "scene_stats"). */
  sceneEmotion?: string;
  /** AI-determined narrative intensity -10..+10 (only for type "scene_stats"). */
  sceneIntensity?: number;
  /** AI-determined conflict summary (only for type "scene_stats"). */
  sceneConflict?: string;
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
  /** In-story date assigned to the chapter or scene (from frontmatter). */
  date?: string;
}

/** Which analysis tasks to include in the request. */
export interface EnabledChecks {
  references: boolean;
  inconsistencies: boolean;
  suggestions: boolean;
  sceneStats?: boolean;
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
  private lmStudioBaseUrl: string;
  private lmStudioModel: string;
  private lmStudioApiToken: string;
  private provider: AiProvider;
  private analysisMode: AiAnalysisMode;
  private temperature: number;
  private contextLength: number;
  private topP: number;
  private minP: number;
  private frequencyPenalty: number;
  private repeatLastN: number;
  private copilotClient: CopilotAcpClient;
  private abortController: AbortController | null = null;
  /** User-configured system prompt (from settings). Applied as additional
   *  context in analysis methods so the LLM respects the author's guidelines. */
  private systemPrompt = '';

  constructor(
    lmStudioBaseUrl: string,
    lmStudioModel: string,
    lmStudioApiToken: string,
    provider: AiProvider = 'lmstudio',
    analysisMode: AiAnalysisMode = 'paragraph',
    copilotPath = 'copilot',
    vaultPath = '',
    copilotModel = '',
    temperature = 0.7,
    contextLength = 0,
    topP = 0.9,
    minP = 0.05,
    frequencyPenalty = 1.1,
    repeatLastN = 64,
  ) {
    this.lmStudioBaseUrl = lmStudioBaseUrl.replace(/\/+$/, '');
    this.lmStudioModel = lmStudioModel;
    this.lmStudioApiToken = lmStudioApiToken;
    this.provider = provider;
    this.analysisMode = analysisMode;
    this.temperature = temperature;
    this.contextLength = contextLength;
    this.topP = topP;
    this.minP = minP;
    this.frequencyPenalty = frequencyPenalty;
    this.repeatLastN = repeatLastN;
    this.copilotClient = new CopilotAcpClient(copilotPath);
    this.copilotClient.vaultPath = vaultPath;
    this.copilotClient.modelId = copilotModel;
  }

  setLmStudioBaseUrl(url: string): void {
    this.lmStudioBaseUrl = url.replace(/\/+$/, '');
  }

  setLmStudioModel(model: string): void {
    this.lmStudioModel = model;
  }

  setLmStudioApiToken(token: string): void {
    this.lmStudioApiToken = token;
  }

  setProvider(provider: AiProvider): void {
    this.provider = provider;
  }

  setAnalysisMode(mode: AiAnalysisMode): void {
    this.analysisMode = mode;
  }

  setTemperature(value: number): void {
    this.temperature = value;
  }

  setContextLength(value: number): void {
    this.contextLength = value;
  }

  setTopP(value: number): void {
    this.topP = value;
  }

  setMinP(value: number): void {
    this.minP = value;
  }

  setFrequencyPenalty(value: number): void {
    this.frequencyPenalty = value;
  }

  setRepeatLastN(value: number): void {
    this.repeatLastN = value;
  }

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
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
   *  is cleared. No-op when using LM Studio (stateless HTTP). */
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

  // ── LM Studio helpers ──────────────────────────────────────────

  /** Build request headers for LM Studio API calls. */
  private lmStudioHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.lmStudioApiToken) {
      headers['Authorization'] = `Bearer ${this.lmStudioApiToken}`;
    }
    return headers;
  }

  /** Check whether the LM Studio server is reachable. */
  async isServerRunning(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      if (this.lmStudioApiToken) {
        headers['Authorization'] = `Bearer ${this.lmStudioApiToken}`;
      }
      await requestUrl({ url: `${this.lmStudioBaseUrl}/api/v1/models`, method: 'GET', headers });
      return true;
    } catch {
      return false;
    }
  }

  /** List all LLM models available on the LM Studio server. */
  async listModels(): Promise<OllamaModel[]> {
    try {
      const headers: Record<string, string> = {};
      if (this.lmStudioApiToken) {
        headers['Authorization'] = `Bearer ${this.lmStudioApiToken}`;
      }
      const res = await requestUrl({ url: `${this.lmStudioBaseUrl}/api/v1/models`, method: 'GET', headers });
      const body = res.json as { models?: Array<{ type?: string; key?: string; display_name?: string; size_bytes?: number }> };
      console.debug('[Novalist LM Studio] /api/v1/models response:', JSON.stringify(body).slice(0, 2000));
      const models = (body.models ?? []).filter(m => m.type === 'llm');
      return models.map(m => ({ name: m.key ?? '', modified_at: '', size: m.size_bytes ?? 0 }));
    } catch (e) {
      console.warn('[Novalist LM Studio] Failed to list models:', e);
      return [];
    }
  }

  /** Load a model on the LM Studio server. */
  async loadModel(): Promise<boolean> {
    try {
      const payload: Record<string, unknown> = { model: this.lmStudioModel };
      if (this.contextLength > 0) {
        payload['context_length'] = this.contextLength;
      }
      console.debug('[Novalist LM Studio] loadModel()', JSON.stringify(payload));
      await requestUrl({
        url: `${this.lmStudioBaseUrl}/api/v1/models/load`,
        method: 'POST',
        body: JSON.stringify(payload),
        headers: this.lmStudioHeaders(),
      });
      return true;
    } catch (e) {
      console.warn('[Novalist LM Studio] loadModel() failed:', e);
      return false;
    }
  }

  /**
   * Ensure the current model is loaded with the configured context length.
   * If already loaded with a matching context length (or no preference is set),
   * this is a no-op. Otherwise unloads all instances and reloads.
   */
  async ensureModelLoaded(): Promise<void> {
    if (!this.lmStudioModel) return;
    try {
      const res = await requestUrl({
        url: `${this.lmStudioBaseUrl}/api/v1/models`,
        method: 'GET',
        headers: this.lmStudioHeaders(),
      });
      const body = res.json as {
        models?: Array<{
          key?: string;
          loaded_instances?: Array<{
            id?: string;
            config?: { context_length?: number };
          }>;
        }>;
      };
      const entry = (body.models ?? []).find(m => m.key === this.lmStudioModel);
      const instances = entry?.loaded_instances ?? [];

      // Check if any instance already matches the desired context length
      if (instances.length > 0) {
        if (this.contextLength <= 0) {
          // No preference — any loaded instance is fine
          console.debug('[Novalist LM Studio] ensureModelLoaded() — already loaded, no context preference');
          return;
        }
        const hasMatch = instances.some(
          inst => inst.config?.context_length === this.contextLength,
        );
        if (hasMatch && instances.length === 1) {
          console.debug('[Novalist LM Studio] ensureModelLoaded() — already loaded with correct context');
          return;
        }
      }

      // Unload all existing instances first
      if (instances.length > 0) {
        console.debug('[Novalist LM Studio] ensureModelLoaded() — unloading', instances.length, 'instance(s)');
        await this.unloadModel();
      }

      // Load with correct context length
      await this.loadModel();
    } catch (e) {
      console.warn('[Novalist LM Studio] ensureModelLoaded() failed:', e);
    }
  }

  /** Unload all loaded instances of the current model from LM Studio. */
  async unloadModel(): Promise<boolean> {
    try {
      // List models to find all loaded instances with a matching key
      const res = await requestUrl({
        url: `${this.lmStudioBaseUrl}/api/v1/models`,
        method: 'GET',
        headers: this.lmStudioHeaders(),
      });
      const body = res.json as {
        models?: Array<{
          type?: string;
          key?: string;
          loaded_instances?: Array<{ id?: string }>;
        }>;
      };
      const entry = (body.models ?? []).find(m => m.key === this.lmStudioModel);
      const instances = entry?.loaded_instances ?? [];

      if (instances.length === 0) {
        console.debug('[Novalist LM Studio] unloadModel() — no loaded instances found');
        return true;
      }

      // Unload each loaded instance by its id
      for (const inst of instances) {
        const instanceId = inst.id ?? this.lmStudioModel;
        console.debug('[Novalist LM Studio] unloadModel() — unloading instance:', instanceId);
        await requestUrl({
          url: `${this.lmStudioBaseUrl}/api/v1/models/unload`,
          method: 'POST',
          body: JSON.stringify({ instance_id: instanceId }),
          headers: this.lmStudioHeaders(),
        });
      }
      return true;
    } catch (e) {
      console.warn('[Novalist LM Studio] unloadModel() failed:', e);
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

  private async generate(
    prompt: string,
    temperature?: number,
    onChunk?: (token: string) => void,
    onThinkingChunk?: (token: string) => void,
    systemPrompt?: string,
  ): Promise<string> {
    const temp = temperature ?? this.temperature;
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });
    console.debug('[Novalist LM Studio] generate() called —', {
      provider: this.provider,
      model: this.lmStudioModel,
      promptLength: prompt.length,
      hasSystemPrompt: !!systemPrompt,
      temperature: temp,
    });
    if (this.provider === 'copilot') {
      // Copilot ACP doesn't support system messages natively — flatten
      const flat = messages.map(m => m.role === 'system' ? `[System]\n${m.content}` : m.content).join('\n\n');
      return this.copilotClient.generate(flat);
    }
    // provider === 'lmstudio'
    const result = await this.generateChatLmStudio(messages, onChunk ?? (() => {}), temp, onThinkingChunk);
    console.debug('[Novalist LM Studio] generate() result —', {
      responseLength: result.response.length,
      thinkingLength: result.thinking.length,
      responsePreview: result.response.slice(0, 200),
    });
    return result.response;
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
    temperature?: number,
    onThinkingChunk?: (token: string) => void,
  ): Promise<{ response: string; thinking: string }> {
    const temp = temperature ?? this.temperature;
    console.debug('[Novalist LM Studio] generateChat() called —', {
      provider: this.provider,
      model: this.lmStudioModel,
      messageCount: messages.length,
      roles: messages.map(m => m.role),
      totalChars: messages.reduce((s, m) => s + m.content.length, 0),
      hasOnThinkingChunk: !!onThinkingChunk,
    });
    if (this.provider === 'copilot') {
      return this.generateChatCopilot(messages, onChunk, onThinkingChunk);
    }
    // provider === 'lmstudio'
    return this.generateChatLmStudio(messages, onChunk, temp, onThinkingChunk);
  }

  // ── LM Studio generation (native v1 API with named SSE) ───────

  /** Copilot ACP streaming chat — flatten messages and feed through CopilotAcpClient. */
  private async generateChatCopilot(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    onChunk: (token: string) => void,
    onThinkingChunk?: (token: string) => void,
  ): Promise<{ response: string; thinking: string }> {
    this.copilotClient.onChunk = onChunk;
    this.copilotClient.onThinkingChunk = onThinkingChunk ?? null;

    const flat = messages
      .map(m => m.role === 'system' ? `[System]\n${m.content}` : m.content)
      .join('\n\n');
    const response = await this.copilotClient.generate(flat);

    this.copilotClient.onChunk = null;
    this.copilotClient.onThinkingChunk = null;

    return { response, thinking: '' };
  }

  private async generateChatLmStudio(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    onChunk: (token: string) => void,
    temperature: number,
    onThinkingChunk?: (token: string) => void,
  ): Promise<{ response: string; thinking: string }> {
    // Ensure the model is loaded with the correct context length before inference
    await this.ensureModelLoaded();

    this.abortController = new AbortController();

    const body: Record<string, unknown> = {
      model: this.lmStudioModel,
      messages,
      stream: true,
      temperature,
      top_p: this.topP,
      min_p: this.minP,
      frequency_penalty: this.frequencyPenalty,
      repeat_last_n: this.repeatLastN,
    };

    const url = `${this.lmStudioBaseUrl}/v1/chat/completions`;
    console.debug('[Novalist LM Studio] POST', url, {
      model: this.lmStudioModel,
      messageCount: messages.length,
      temperature,
      topP: this.topP,
      minP: this.minP,
      frequencyPenalty: this.frequencyPenalty,
      repeatLastN: this.repeatLastN,
      firstMsgRole: messages[0]?.role,
      promptLength: messages.reduce((s, m) => s + m.content.length, 0),
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: this.lmStudioHeaders(),
      body: JSON.stringify(body),
      signal: this.abortController.signal,
    });

    console.debug('[Novalist LM Studio] Response status:', response.status, response.statusText, 'body:', !!response.body);

    if (!response.ok || !response.body) {
      this.abortController = null;
      throw new Error(`LM Studio chat request failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let thinkingText = '';
    let buffer = '';
    let sseLineCount = 0;
    let chunkCount = 0;
    let sseError: string | null = null;
    /** Track whether we are inside an inline `<think>` block so we can
     *  route tokens to the thinking callback during streaming. */
    let insideThinkTag = false;
    /** Buffer for accumulating a potential partial `<think>` or `</think>` tag
     *  that arrived split across SSE chunks. */
    let tagBuffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunkCount++;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed === 'data: [DONE]') {
            console.debug('[Novalist LM Studio] SSE stream ended (data: [DONE])');
            continue;
          }
          if (!trimmed.startsWith('data: ')) {
            // Log unexpected non-data lines (e.g. event: lines)
            if (sseLineCount < 5) {
              console.debug('[Novalist LM Studio] Non-data SSE line:', trimmed.slice(0, 200));
            }
            continue;
          }
          sseLineCount++;
          const jsonStr = trimmed.slice(6);
          try {
            const json = JSON.parse(jsonStr) as Record<string, unknown>;
            // Log the first few raw SSE data objects for debugging
            if (sseLineCount <= 3) {
              console.debug(`[Novalist LM Studio] SSE data #${sseLineCount}:`, JSON.stringify(json).slice(0, 500));
            }

            // Detect error responses from LM Studio
            const errorObj = json['error'] as Record<string, unknown> | undefined;
            if (errorObj) {
              sseError = (errorObj['message'] as string) ?? JSON.stringify(errorObj);
              console.error('[Novalist LM Studio] SSE error from server:', sseError);
              continue;
            }

            const choices = json['choices'] as Array<Record<string, unknown>> | undefined;
            const delta = choices?.[0]?.['delta'] as Record<string, unknown> | undefined;
            if (!delta) {
              if (sseLineCount <= 5) {
                console.debug('[Novalist LM Studio] SSE line has no delta:', JSON.stringify(json).slice(0, 300));
              }
              continue;
            }
            const reasoning = (delta['reasoning_content'] as string | undefined) ?? '';
            if (reasoning) {
              thinkingText += reasoning;
              onThinkingChunk?.(reasoning);
            }
            const token = (delta['content'] as string | undefined) ?? '';
            if (token) {
              // Route tokens through inline <think> tag detection so models
              // that embed chain-of-thought in content (e.g. Qwen3) get
              // their thinking routed to the correct callback during streaming.
              let pending = tagBuffer + token;
              tagBuffer = '';

              while (pending.length > 0) {
                if (insideThinkTag) {
                  const closeIdx = pending.indexOf('</think>');
                  if (closeIdx !== -1) {
                    // Everything before the close tag is thinking
                    const chunk = pending.slice(0, closeIdx);
                    if (chunk) {
                      thinkingText += chunk;
                      onThinkingChunk?.(chunk);
                    }
                    insideThinkTag = false;
                    pending = pending.slice(closeIdx + 8); // skip </think>
                  } else if (pending.includes('</') && pending.length < 8) {
                    // Might be a partial </think> — buffer it
                    tagBuffer = pending;
                    pending = '';
                  } else {
                    // All thinking content
                    thinkingText += pending;
                    onThinkingChunk?.(pending);
                    pending = '';
                  }
                } else {
                  const openIdx = pending.indexOf('<think>');
                  if (openIdx !== -1) {
                    // Everything before the open tag is response content
                    const chunk = pending.slice(0, openIdx);
                    if (chunk) {
                      fullText += chunk;
                      onChunk(chunk);
                    }
                    insideThinkTag = true;
                    pending = pending.slice(openIdx + 7); // skip <think>
                  } else if (pending.endsWith('<') || (pending.length < 7 && pending.includes('<'))) {
                    // Might be a partial <think> — buffer it
                    const ltIdx = pending.lastIndexOf('<');
                    const before = pending.slice(0, ltIdx);
                    if (before) {
                      fullText += before;
                      onChunk(before);
                    }
                    tagBuffer = pending.slice(ltIdx);
                    pending = '';
                  } else {
                    // Normal response content
                    fullText += pending;
                    onChunk(pending);
                    pending = '';
                  }
                }
              }
            }
          } catch {
            console.warn('[Novalist LM Studio] Malformed SSE JSON:', jsonStr.slice(0, 200));
          }
        }
      }
    } finally {
      this.abortController = null;
    }

    // Flush any remaining tag buffer
    if (tagBuffer) {
      if (insideThinkTag) {
        thinkingText += tagBuffer;
        onThinkingChunk?.(tagBuffer);
      } else {
        fullText += tagBuffer;
        onChunk(tagBuffer);
      }
    }

    console.debug('[Novalist LM Studio] Stream complete —', {
      sseLines: sseLineCount,
      rawChunks: chunkCount,
      responseLength: fullText.length,
      thinkingLength: thinkingText.length,
      responsePreview: fullText.slice(0, 200),
      thinkingPreview: thinkingText.slice(0, 200),
      sseError,
    });

    // If the server returned an error and no content was generated, throw
    if (sseError && fullText.length === 0) {
      throw new Error(`LM Studio: ${sseError}`);
    }

    return { response: fullText, thinking: thinkingText };
  }

  // ── Analysis methods ───────────────────────────────────────────

  /**
   * Split text into paragraphs suitable for per-paragraph LLM analysis.
   * Splits on blank lines.  Very short consecutive paragraphs (headings,
   * single-line dialogue) are merged so we don't flood the LLM with tiny
   * requests.
   */
  /**
   * Strip inline `<think>…</think>` blocks from text and return the
   * cleaned response plus the extracted thinking content.  Models like
   * DeepSeek-R1 and some Qwen variants embed chain-of-thought inside
   * these tags rather than using a dedicated thinking field.
   */
  static stripInlineThinking(text: string): { cleaned: string; thinking: string } {
    const thinkParts: string[] = [];
    const cleaned = text.replace(/<think>([\s\S]*?)<\/think>/g, (_, inner: string) => {
      const part = inner.trim();
      if (part) thinkParts.push(part);
      return '';
    });
    return { cleaned: cleaned.trim(), thinking: thinkParts.join('\n\n') };
  }

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

  /** Build the task instructions block shared by paragraph and chapter prompts.
   *  When `findAllReferences` is true, the AI is asked to report every entity
   *  reference — both direct name mentions and indirect ones — because the
   *  regex scanner is disabled. */
  private buildTaskInstructions(checks: EnabledChecks, alreadyFound?: string[], findAllReferences = false): string[] {
    const tasks: string[] = [];
    let taskNum = 1;
    const doRefs = checks.references;
    const doIncon = checks.inconsistencies;
    const doSug = checks.suggestions;

    if (doRefs) {
      const presenceRule = ' IMPORTANT: Only report entities that are physically PRESENT in the scene or actively participating in the action. Do NOT report entities that are merely talked about, remembered, or referenced in dialogue but are not actually there. For example, if two characters discuss a third character who is not in the room, do NOT include that third character as a reference.';
      if (findAllReferences) {
        tasks.push(`${taskNum}. **References** ("type":"reference"): Find ALL known entities that are physically present or actively participating in this scene — both direct name mentions and indirect references (relationship terms like "his wife", pronouns that resolve to a specific entity, nicknames, abbreviated names).${presenceRule} For each reference, set entityName to the full entity name and entityType to "character", "location", "item", or "lore".`);
      } else {
        tasks.push(`${taskNum}. **References** ("type":"reference"): Find places where a known entity that is physically present in the scene is referenced INDIRECTLY — through relationship terms (e.g. "his wife", "her mother"), pronouns that resolve to a specific entity, nicknames, or abbreviated names. Direct name mentions that simple regex matching would catch should NOT be reported.${alreadyFound && alreadyFound.length > 0 ? ' The regex system has already found: ' + alreadyFound.join(', ') + '. Only report references the regex missed.' : ''}${presenceRule} Use the relationship data to resolve indirect references to the correct entity. For each reference, set entityName to the full entity name.`);
      }
      taskNum++;
    }
    if (doIncon) {
      tasks.push(`${taskNum}. **Inconsistencies** ("type":"inconsistency"): Compare the text against the known entity details (e.g. hair colour, eye colour, gender, location description, item properties). Also use relationships to check indirect references — e.g. if "his wife" is described with blue eyes but the resolved character has brown eyes, report it. Report any contradictions.`);
      taskNum++;
    }
    if (doSug) {
      tasks.push(`${taskNum}. **Suggestions** ("type":"suggestion"): Identify character names, place names, or notable objects mentioned in the text that do NOT match any known entity and could be added as new entities. For every suggestion you MUST set "entityName" to the exact name of the entity to create and "entityType" to one of "character", "location", "item", or "lore".`);
      taskNum++;
    }
    if (checks.sceneStats) {
      tasks.push(`${taskNum}. **Scene Stats** ("type":"scene_stats"): Determine the following scene-level metadata from the text. Return EXACTLY ONE object with type "scene_stats" and these ADDITIONAL fields (alongside the standard fields):\n- "scenePov": the name of the point-of-view character (the character whose perspective the scene is narrated from). Pick from the known characters list if possible. Empty string if unclear.\n- "sceneEmotion": the dominant emotional tone of the scene, MUST be one of: "neutral", "tense", "joyful", "melancholic", "angry", "fearful", "romantic", "mysterious", "humorous", "hopeful", "desperate", "peaceful", "chaotic", "sorrowful", "triumphant"\n- "sceneIntensity": overall narrative intensity as an integer from -10 (very calm, contemplative, slow) to +10 (extreme action, high tension, climax)\n- "sceneConflict": a one-line summary of the central conflict or tension in this scene, or empty string if there is no notable conflict\nFor this object set "title" to "Scene Stats", "description" to a brief summary of your reasoning, and "excerpt" to an empty string.`);
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
    findAllReferences = false,
  ): Promise<AiFinding[]> {
    // Reset the Copilot session so the model has no memory of previous
    // paragraphs / scenes.  No-op for Ollama (stateless HTTP).
    await this.resetChatSession();

    const doRefs = checks?.references ?? true;
    const doIncon = checks?.inconsistencies ?? true;
    const doSug = checks?.suggestions ?? true;
    if (!doRefs && !doIncon && !doSug) return [];

    const entityBlock = entities.map(e => `- [${e.type}] ${e.name}: ${e.details}`).join('\n');

    const alreadyFoundBlock = findAllReferences
      ? ''
      : (alreadyFound && alreadyFound.length > 0
        ? `\nEntities already detected by regex matching (DO NOT report these as basic name-match references — only report them if you find an INDIRECT reference such as a pronoun, nickname, relationship term, or abbreviated name that the regex cannot catch):\n${alreadyFound.join(', ')}\n`
        : '');

    const contextBlock = context
      ? `\nChapter context: Chapter "${context.chapterName}"${context.actName ? `, Act "${context.actName}"` : ''}${context.sceneName ? `, Scene "${context.sceneName}"` : ''}${context.date ? `, In-story date: ${context.date}` : ''}. The entity details above already reflect any act/chapter/scene-specific overrides.\n`
      : '';

    const tasks = this.buildTaskInstructions({ references: doRefs, inconsistencies: doIncon, suggestions: doSug }, alreadyFound, findAllReferences);

    const lang = getLanguageName();

    const prompt = `You are a fiction-writing assistant analysing a short passage from a novel. The project tracks entities (characters, locations, items, lore) by matching their names as plain text — no special markup is used.

IMPORTANT: Write all "title" and "description" values in ${lang}. The JSON keys and "type" / "entityType" enum values must remain in English.

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

    const raw = await this.generate(prompt, 0, undefined, undefined, this.systemPrompt || undefined);
    return this.parseFindings(raw);
  }

  /**
   * Analyse a text passage (scene or full chapter) in a single LLM call.
   * Better for large-context models; gives the LLM full narrative context.
   *
   * When {@link onResponseChunk} is provided the method uses the streaming
   * chat API so that reasoning / thinking tokens can be forwarded to the
   * caller in real time.
   */
  async analyseChapterWhole(
    chapterText: string,
    entities: EntitySummary[],
    alreadyFound?: string[],
    context?: ChapterContext,
    checks?: EnabledChecks,
    onResponseChunk?: (token: string) => void,
    onThinkingChunk?: (token: string) => void,
    findAllReferences = false,
  ): Promise<{ findings: AiFinding[]; rawResponse: string; thinking: string }> {
    // Reset the Copilot session so the model has no memory of previous
    // scenes / chapters.  No-op for Ollama (stateless HTTP).
    await this.resetChatSession();

    const doRefs = checks?.references ?? true;
    const doIncon = checks?.inconsistencies ?? true;
    const doSug = checks?.suggestions ?? true;
    const doStats = checks?.sceneStats ?? false;
    if (!doRefs && !doIncon && !doSug && !doStats) return { findings: [], rawResponse: '', thinking: '' };

    const entityBlock = entities.map(e => `- [${e.type}] ${e.name}: ${e.details}`).join('\n');

    const alreadyFoundBlock = findAllReferences
      ? ''
      : (alreadyFound && alreadyFound.length > 0
        ? `\nEntities already detected by regex matching (DO NOT report these as basic name-match references — only report them if you find an INDIRECT reference such as a pronoun, nickname, relationship term, or abbreviated name that the regex cannot catch):\n${alreadyFound.join(', ')}\n`
        : '');

    const contextBlock = context
      ? `\nChapter context: Chapter "${context.chapterName}"${context.actName ? `, Act "${context.actName}"` : ''}${context.sceneName ? `, Scene "${context.sceneName}"` : ''}${context.date ? `, In-story date: ${context.date}` : ''}. The entity details above already reflect any act/chapter/scene-specific overrides.\n`
      : '';

    const tasks = this.buildTaskInstructions({ references: doRefs, inconsistencies: doIncon, suggestions: doSug, sceneStats: doStats }, alreadyFound, findAllReferences);

    const lang = getLanguageName();

    const isScene = !!context?.sceneName;
    const textLabel = isScene ? 'Scene text' : 'Full chapter text';
    const scopeDescription = isScene
      ? `a scene from a novel chapter. The project tracks entities (characters, locations, items, lore) by matching their names as plain text — no special markup is used. You have the full scene text, so you can detect cross-paragraph patterns and narrative-level inconsistencies within this scene.`
      : `a complete chapter from a novel. The project tracks entities (characters, locations, items, lore) by matching their names as plain text — no special markup is used. You have the full chapter text, so you can detect cross-paragraph patterns and narrative-level inconsistencies.`;

    const typeEnum = doStats
      ? '"reference", "inconsistency", "suggestion", or "scene_stats"'
      : '"reference", "inconsistency", or "suggestion"';
    const sceneStatsFields = doStats
      ? `\n\nFor objects with "type":"scene_stats", include these ADDITIONAL fields:\n- "scenePov": POV character name (string)\n- "sceneEmotion": one of "neutral","tense","joyful","melancholic","angry","fearful","romantic","mysterious","humorous","hopeful","desperate","peaceful","chaotic","sorrowful","triumphant"\n- "sceneIntensity": integer from -10 to +10\n- "sceneConflict": one-line conflict summary (string)`
      : '';

    const prompt = `You are a fiction-writing assistant analysing ${scopeDescription}

IMPORTANT: Write all "title" and "description" values in ${lang}. The JSON keys and "type" / "entityType" enum values must remain in English.

Known entities (note: relationship fields tell you who is connected — e.g. if John Doe has "Wife: Jane Doe", then "his wife" refers to Jane Doe):
${entityBlock || '(no entities registered yet)'}
${alreadyFoundBlock}${contextBlock}
${textLabel}:
"""
${chapterText}
"""

Perform the following task(s) and return ONLY a JSON array (no markdown fences, no explanation outside the array). Each element must be an object with these fields:
- "type": one of ${typeEnum}
- "title": short heading (max 80 chars)
- "description": concise explanation
- "excerpt": the EXACT text from the ${isScene ? 'scene' : 'chapter'} that this finding refers to (verbatim copy, max 120 chars). This will be used to locate the finding in the document.
- "entityName": the entity name this relates to (or empty string)
- "entityType": "character", "location", "item", "lore", or empty string${sceneStatsFields}

${tasks.join('\n')}

If a task has no findings, simply omit entries for it. Return an empty array [] if nothing is found.`;

    let raw: string;
    let thinking = '';

    if (onResponseChunk || onThinkingChunk) {
      // Use streaming chat API so we can forward thinking + response tokens
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
      if (this.systemPrompt) {
        messages.push({ role: 'system', content: this.systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });
      const result = await this.generateChat(
        messages,
        (token) => { onResponseChunk?.(token); },
        0,
        (token) => { onThinkingChunk?.(token); },
      );
      raw = result.response;
      thinking = result.thinking;
    } else {
      raw = await this.generate(prompt, 0, undefined, undefined, this.systemPrompt || undefined);
    }

    return { findings: this.parseFindings(raw), rawResponse: raw, thinking };
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
    findAllReferences = false,
  ): Promise<{ findings: AiFinding[]; hashes: Map<number, string> }> {
    const wholeChapter = useWholeChapter ?? (this.analysisMode === 'chapter');

    if (wholeChapter) {
      onProgress?.(0, 1);
      const result = await this.analyseChapterWhole(chapterText, entities, alreadyFound, context, checks, undefined, undefined, findAllReferences);
      onProgress?.(1, 1);
      return { findings: result.findings, hashes: new Map() };
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

      const findings = await this.analyseParagraph(p, entities, alreadyFound, context, checks, findAllReferences);
      // Tag findings with paragraph index for caching
      for (const f of findings) {
        (f as AiFinding & { _paraIdx?: number })._paraIdx = i;
      }
      allFindings.push(...findings);
      onProgress?.(i + 1, total);
    }

    return { findings: allFindings, hashes: newHashes };
  }

  /**
   * Analyse ALL chapters as a single unified whole-story review.
   *
   * Sends the combined text of every chapter together with all known entities
   * and any cached per-chapter AI findings (from the detect cache) so the
   * model can verify, cross-reference, and augment the preliminary findings
   * across the complete narrative.
   *
   * This is a single LLM call that may be large – suitable for models with
   * 128 K+ context windows.  Streaming callbacks are supported so the caller
   * can display live thinking / response tokens.
   */
  async analyseWholeStory(
    chapters: Array<{ name: string; text: string }>,
    entities: EntitySummary[],
    cachedFindings: Array<{ chapterName: string; findings: Array<{ type: string; title: string; description: string; excerpt?: string; entityName?: string; entityType?: string }> }>,
    onResponseChunk?: (token: string) => void,
    onThinkingChunk?: (token: string) => void,
  ): Promise<{ findings: AiFinding[]; rawResponse: string; thinking: string }> {
    // Start fresh so the model has no memory of previous calls.
    await this.resetChatSession();

    const lang = getLanguageName();

    const entityBlock = entities.length > 0
      ? entities.map(e => `- [${e.type}] ${e.name}: ${e.details}`).join('\n')
      : '(no entities registered yet)';

    // Format cached findings per chapter
    let cachedFindingsBlock = '';
    if (cachedFindings.some(cf => cf.findings.length > 0)) {
      const lines: string[] = [];
      for (const cf of cachedFindings) {
        if (cf.findings.length === 0) continue;
        lines.push(`Chapter "${cf.chapterName}":`);
        for (const f of cf.findings) {
          lines.push(`  [${f.type}] ${f.title}: ${f.description}${f.excerpt ? ` (excerpt: "${f.excerpt}")` : ''}`);
        }
      }
      cachedFindingsBlock = lines.join('\n');
    }

    // Combine all chapter texts with clear dividers
    const storyBlock = chapters
      .map(ch => `--- Chapter: ${ch.name} ---\n${ch.text}`)
      .join('\n\n');

    const prompt = `You are a fiction-analysis assistant performing a WHOLE-STORY review of a complete novel manuscript spanning ${chapters.length} chapter(s).

IMPORTANT: Write all "title" and "description" values in ${lang}. The JSON keys and "type" / "entityType" enum values must remain in English.

## Known Entities
${entityBlock}

${cachedFindingsBlock ? `## Preliminary Per-Chapter Findings (to be verified and cross-referenced)
The following findings were discovered during previous per-chapter analysis. Treat them as preliminary hints that may contain duplicates, chapter-isolated false positives, or issues worth verifying across the full narrative:
${cachedFindingsBlock}

` : ''}## Full Story Text
${storyBlock}

## Your Task
Review the complete story and the entity data above and return a final, comprehensive list of findings. Focus on:

1. **Inconsistencies** ("type":"inconsistency"): Contradictions that span the full story — e.g. a character's appearance described differently across chapters, location descriptions that contradict each other, timeline contradictions, or entity details that contradict their registered profiles. Confirm, merge, or expand upon the preliminary findings above. Also add NEW cross-chapter inconsistencies not caught by the per-chapter analysis.

2. **Suggestions** ("type":"suggestion"): Character names, place names, or other notable entities mentioned in the story that are NOT yet registered in the entity list and should be added.

Return ONLY a JSON array (no markdown fences, no explanation outside the array). Each element must have:
- "type": "inconsistency" or "suggestion"
- "title": short heading (max 80 chars)
- "description": detailed explanation of the finding
- "excerpt": best verbatim text excerpt from the story that illustrates the finding (max 120 chars)
- "entityName": the entity name this relates to (or empty string)
- "entityType": "character", "location", "item", "lore", or empty string

Consolidate duplicate or overlapping findings into single entries. Return an empty array [] if nothing is found.

IMPORTANT: After your thinking/reasoning, you MUST produce the JSON array as plain text in your response — not inside any thinking, reasoning, or code block tags. The first non-whitespace character of your final response must be "[".`;

   let raw: string;
   let thinking = '';

   if (onResponseChunk || onThinkingChunk) {
     const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
     if (this.systemPrompt) {
       messages.push({ role: 'system', content: this.systemPrompt });
     }
     messages.push({ role: 'user', content: prompt });
     const result = await this.generateChat(
       messages,
       (token) => { onResponseChunk?.(token); },
       0,
       (token) => { onThinkingChunk?.(token); },
     );
     raw = result.response;
     thinking = result.thinking;
   } else {
     raw = await this.generate(prompt, 0, undefined, undefined, this.systemPrompt || undefined);
   }

   // Fallback: some extended-thinking models (e.g. Copilot Claude with
   // extended thinking or DeepSeek-R1) emit the JSON inside the thinking
   // block and leave the response empty.  Try to recover findings from the
   // thinking text when the response produces no findings.
   if ((!raw || !raw.trim() || this.parseFindings(raw).length === 0) && thinking) {
     const thinkingFindings = this.parseFindings(thinking);
     if (thinkingFindings.length > 0) {
       return { findings: thinkingFindings, rawResponse: raw, thinking };
     }
   }

   return { findings: this.parseFindings(raw), rawResponse: raw, thinking };
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
    console.debug('[Novalist LM Studio] parseFindings input —', {
      rawLength: raw.length,
      preview: raw.slice(0, 300),
      hasJsonArray: raw.includes('['),
    });
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

    let items: unknown[];
    try {
      const parsed: unknown = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) return [];
      items = parsed;
    } catch {
      // JSON.parse failed — likely due to unescaped quotes inside string
      // values.  Fall back to extracting individual top-level objects and
      // parsing them one-by-one for best-effort recovery.
      items = this.extractJsonObjects(jsonStr);
      if (items.length === 0) return [];
    }

    return items.filter((item): item is AiFinding => {
      if (typeof item !== 'object' || item === null) return false;
      const obj = item as Record<string, unknown>;
      return (
        typeof obj['type'] === 'string' &&
        typeof obj['title'] === 'string' &&
        typeof obj['description'] === 'string'
      );
    }).map(f => this.normalizeFinding(f));
  }

  /** Normalise a parsed finding: fill in missing entityName / entityType. */
  private normalizeFinding(f: AiFinding): AiFinding {
    let name = f.entityName ?? '';
    let etype = f.entityType ?? '';
    if (f.type === 'suggestion' && !name && f.title) {
      const asMatch = f.title.match(/^(.+?)\s+as\s+/i);
      if (asMatch) {
        name = asMatch[1].trim();
      } else {
        name = f.title;
      }
      if (!etype) etype = 'item';
    }
    const result: AiFinding = {
      type: f.type,
      title: f.title,
      description: f.description,
      excerpt: f.excerpt ?? '',
      entityName: name,
      entityType: etype,
    };
    // Preserve scene_stats fields
    if (f.type === 'scene_stats') {
      const raw = f as unknown as Record<string, unknown>;
      if (typeof raw['scenePov'] === 'string') result.scenePov = raw['scenePov'];
      if (typeof raw['sceneEmotion'] === 'string') result.sceneEmotion = raw['sceneEmotion'];
      if (typeof raw['sceneIntensity'] === 'number') result.sceneIntensity = raw['sceneIntensity'];
      else if (typeof raw['sceneIntensity'] === 'string') result.sceneIntensity = parseInt(raw['sceneIntensity'], 10) || 0;
      if (typeof raw['sceneConflict'] === 'string') result.sceneConflict = raw['sceneConflict'];
    }
    return result;
  }

  /**
   * Best-effort extraction of JSON objects from a potentially malformed
   * JSON array string.  Uses brace-depth tracking to isolate individual
   * `{…}` blocks, then attempts to parse each one.  Objects whose JSON
   * is broken (e.g. unescaped quotes) are repaired before retrying.
   */
  private extractJsonObjects(arrayStr: string): unknown[] {
    const results: unknown[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let prevChar = '';

    for (let i = 0; i < arrayStr.length; i++) {
      const ch = arrayStr[i];
      if (inString) {
        if (ch === '"' && prevChar !== '\\') inString = false;
      } else {
        if (ch === '"') inString = true;
        else if (ch === '{') {
          if (depth === 0) start = i;
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0 && start !== -1) {
            const objStr = arrayStr.substring(start, i + 1);
            const parsed = this.tryParseObject(objStr);
            if (parsed !== null) results.push(parsed);
            start = -1;
          }
        }
      }
      prevChar = ch;
    }
    return results;
  }

  /**
   * Try to parse a single JSON object string.  If it fails, attempt to
   * repair common LLM mistakes (unescaped quotes inside string values)
   * by escaping interior double-quotes within each value.
   */
  private tryParseObject(objStr: string): unknown {
    try {
      return JSON.parse(objStr);
    } catch {
      // Attempt repair: for each "key": "value" pair, re-escape any
      // unescaped double-quotes that appear inside the value portion.
      const repaired = objStr.replace(
        /"(type|title|description|excerpt|entityName|entityType)"\s*:\s*"([\s\S]*?)(?:"\s*(?=[,}\]]))/g,
        (match, key: string, val: string) => {
          const escaped = val.replace(/(?<!\\)"/g, '\\"');
          return `"${key}": "${escaped}"`;
        },
      );
      try {
        return JSON.parse(repaired);
      } catch {
        return null;
      }
    }
  }
}
