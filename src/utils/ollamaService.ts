import { requestUrl, RequestUrlParam } from 'obsidian';

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

// ─── Service ────────────────────────────────────────────────────────

export class OllamaService {
  private baseUrl: string;
  private model: string;
  private abortController: AbortController | null = null;

  constructor(baseUrl: string, model: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.model = model;
  }

  setModel(model: string): void {
    this.model = model;
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  /** Cancel any in-flight request. */
  cancel(): void {
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

  // ── Generation ─────────────────────────────────────────────────

  private async generate(prompt: string, temperature = 0.3, maxTokens = 4096): Promise<string> {
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

    const tasks: string[] = [];
    let taskNum = 1;
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
   * Analyse chapter text paragraph-by-paragraph.
   * Reports progress via an optional callback: (done, total) => void.
   * Returns the aggregated findings.
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
  ): Promise<{ findings: AiFinding[]; hashes: Map<number, string> }> {
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
