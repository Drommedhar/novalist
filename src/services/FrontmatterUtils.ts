/**
 * FrontmatterUtils — shared YAML frontmatter read/write helpers for all services.
 *
 * These utilities handle the conversion between Obsidian vault files with YAML
 * frontmatter and the StoryLine-compatible data models.
 */

import { TFile } from 'obsidian';
import type { Vault } from 'obsidian';

// ── Frontmatter Parsing ─────────────────────────────────────────────

/**
 * Split a markdown file's content into its YAML frontmatter record and body text.
 * Returns `{ frontmatter, body }`.  If no frontmatter block is found, frontmatter
 * will be an empty record and body will be the full content.
 */
export function extractFrontmatterAndBody(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { frontmatter: {}, body: normalized };
  }

  const endIdx = normalized.indexOf('\n---', 4);
  if (endIdx === -1) {
    return { frontmatter: {}, body: normalized };
  }

  const fmBlock = normalized.substring(4, endIdx);
  const body = normalized.substring(endIdx + 4).replace(/^\n+/, '');
  const frontmatter = parseYamlBlock(fmBlock);
  return { frontmatter, body };
}

/**
 * Parse a simple YAML block into a key-value record.
 * Supports: strings, numbers, booleans, arrays (inline and multi-line), nested objects (one level).
 */
export function parseYamlBlock(block: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = block.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(/^(\w[\w_]*)\s*:\s*(.*)/);
    if (!match) { i++; continue; }

    const key = match[1];
    let rawValue = match[2].trim();

    // Inline array: [a, b, c]
    if (rawValue.startsWith('[')) {
      result[key] = parseInlineArray(rawValue);
      i++;
      continue;
    }

    // Multi-line array: items starting with "  - "
    if (rawValue === '' || rawValue === '[]') {
      // Could be empty or start of multi-line array or nested object
      const nextLineIndented = i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1]);
      const nextLineNested = i + 1 < lines.length && /^\s+[\w"']/.test(lines[i + 1]) && !nextLineIndented;

      if (nextLineIndented) {
        const arr: unknown[] = [];
        i++;
        while (i < lines.length && /^\s+-\s/.test(lines[i])) {
          const itemMatch = lines[i].match(/^\s+-\s+(.*)/);
          if (itemMatch) {
            // Check for nested object in array: "  - category: family"
            const objStart = itemMatch[1];
            if (objStart.includes(':')) {
              const obj: Record<string, unknown> = {};
              const firstEntry = objStart.match(/^(?:"([^"]*(?:\\.[^"]*)*)"|'([^']*)'|(\w[\w_]*))\s*:\s*(.*)/);
              if (firstEntry) {
                const fKey = firstEntry[1] ?? firstEntry[2] ?? firstEntry[3];
                obj[fKey] = parseScalar(firstEntry[4].trim());
              }
              // Consume indented continuation lines (sub-keys and nested sub-arrays)
              while (i + 1 < lines.length && /^\s{4,}/.test(lines[i + 1])) {
                i++;
                // Sub-array within an object inside an array: "      - name: ..."
                const subArrayItemMatch = lines[i].match(/^\s{4,}-\s+(.*)/);
                if (subArrayItemMatch) {
                  // Walk back to find which key owns this sub-array
                  // The last key added to obj that has '' or undefined value is the parent
                  const parentKey = Object.keys(obj).pop();
                  if (parentKey && (obj[parentKey] === '' || obj[parentKey] === undefined || Array.isArray(obj[parentKey]))) {
                    if (!Array.isArray(obj[parentKey])) obj[parentKey] = [];
                    const subArr = obj[parentKey] as unknown[];
                    const subObjStart = subArrayItemMatch[1];
                    if (subObjStart.includes(':')) {
                      const subObj: Record<string, unknown> = {};
                      const subFirst = subObjStart.match(/^(?:"([^"]*(?:\\.[^"]*)*)"|'([^']*)'|(\w[\w_]*))\s*:\s*(.*)/);
                      if (subFirst) {
                        const sKey = subFirst[1] ?? subFirst[2] ?? subFirst[3];
                        subObj[sKey] = parseScalar(subFirst[4].trim());
                      }
                      // Read further indented continuation for this sub-object
                      while (i + 1 < lines.length && /^\s{8,}\w/.test(lines[i + 1])) {
                        i++;
                        const deepMatch = lines[i].match(/^\s+(?:"([^"]*(?:\\.[^"]*)*)"|'([^']*)'|(\w[\w_]*))\s*:\s*(.*)/);
                        if (deepMatch) {
                          const dKey = deepMatch[1] ?? deepMatch[2] ?? deepMatch[3];
                          subObj[dKey] = parseScalar(deepMatch[4].trim());
                        }
                      }
                      subArr.push(subObj);
                    } else {
                      subArr.push(parseScalar(subObjStart));
                    }
                  }
                  continue;
                }
                const contMatch = lines[i].match(/^\s+(?:"([^"]*(?:\\.[^"]*)*)"|'([^']*)'|(\w[\w_]*))\s*:\s*(.*)/);
                if (contMatch) {
                  const cKey = contMatch[1] ?? contMatch[2] ?? contMatch[3];
                  const cVal = contMatch[4].trim();
                  // Check if this key starts a sub-array (value is empty and next line is deeper indented with -)
                  if (cVal === '' && i + 1 < lines.length && /^\s{6,}-\s/.test(lines[i + 1])) {
                    obj[cKey] = '';  // Placeholder — sub-array items will be consumed on next iteration
                  } else if (cVal.startsWith('[')) {
                    obj[cKey] = parseInlineArray(cVal);
                  } else {
                    obj[cKey] = parseScalar(cVal);
                  }
                }
              }
              arr.push(obj);
            } else {
              arr.push(parseScalar(objStart));
            }
          }
          i++;
        }
        result[key] = arr;
        continue;
      }

      if (nextLineNested) {
        // Nested object
        const obj: Record<string, unknown> = {};
        i++;
        while (i < lines.length && /^\s+[\w"']/.test(lines[i])) {
          const nestedMatch = lines[i].match(/^\s+(?:"([^"]*(?:\\.[^"]*)*)"|'([^']*)'|(\w[\w_]*))\s*:\s*(.*)/);
          if (nestedMatch) {
            const nKey = nestedMatch[1] ?? nestedMatch[2] ?? nestedMatch[3];
            obj[nKey] = parseScalar(nestedMatch[4].trim());
          }
          i++;
        }
        result[key] = obj;
        continue;
      }

      // Empty value
      if (rawValue === '[]') {
        result[key] = [];
      } else {
        result[key] = '';
      }
      i++;
      continue;
    }

    // Scalar value
    result[key] = parseScalar(rawValue);
    i++;
  }

  return result;
}

function parseScalar(value: string): string | number | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return '';
  // Remove surrounding quotes
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  // Number
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function parseInlineArray(value: string): unknown[] {
  // Remove [ ]
  const inner = value.slice(1, -1).trim();
  if (inner === '') return [];
  return inner.split(',').map(s => parseScalar(s.trim()));
}

// ── Frontmatter Serialization ───────────────────────────────────────

/**
 * Serialize a frontmatter record and body text into a complete markdown file string
 * with YAML frontmatter block.
 */
export function serializeFrontmatterAndBody(frontmatter: Record<string, unknown>, body: string): string {
  const fmStr = serializeYamlBlock(frontmatter);
  const bodyTrimmed = body.trim();
  return `---\n${fmStr}---\n${bodyTrimmed ? '\n' + bodyTrimmed + '\n' : ''}`;
}

/**
 * Serialize a record into a YAML block string (without the `---` delimiters).
 */
export function serializeYamlBlock(data: Record<string, unknown>): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else if (value.every(v => typeof v === 'object' && v !== null && !Array.isArray(v))) {
        // Array of objects
        lines.push(`${key}:`);
        for (const obj of value) {
          const entries = Object.entries(obj as Record<string, unknown>);
          if (entries.length === 0) continue;
          const [firstKey, firstVal] = entries[0];
          lines.push(`  - ${serializeEntryKey(firstKey)}: ${serializeScalar(firstVal)}`);
          for (let j = 1; j < entries.length; j++) {
            const eKey = entries[j][0];
            const eVal = entries[j][1];
            if (eVal === undefined || eVal === null) continue;
            // Nested array of objects within an array item
            if (Array.isArray(eVal) && eVal.length > 0 && eVal.every(v => typeof v === 'object' && v !== null && !Array.isArray(v))) {
              lines.push(`    ${serializeEntryKey(eKey)}:`);
              for (const subObj of eVal) {
                const subEntries = Object.entries(subObj as Record<string, unknown>);
                if (subEntries.length === 0) continue;
                const [sFirstKey, sFirstVal] = subEntries[0];
                lines.push(`      - ${serializeEntryKey(sFirstKey)}: ${serializeScalar(sFirstVal)}`);
                for (let k = 1; k < subEntries.length; k++) {
                  lines.push(`        ${serializeEntryKey(subEntries[k][0])}: ${serializeScalar(subEntries[k][1])}`);
                }
              }
            } else if (Array.isArray(eVal)) {
              // Simple nested array
              if (eVal.length === 0) {
                lines.push(`    ${serializeEntryKey(eKey)}: []`);
              } else {
                lines.push(`    ${serializeEntryKey(eKey)}: [${eVal.map(v => serializeScalar(v)).join(', ')}]`);
              }
            } else if (typeof eVal === 'object' && eVal !== null) {
              // Nested object within an array item
              lines.push(`    ${serializeEntryKey(eKey)}:`);
              for (const [subK, subV] of Object.entries(eVal as Record<string, unknown>)) {
                if (subV === undefined || subV === null) continue;
                lines.push(`      ${serializeEntryKey(subK)}: ${serializeScalar(subV)}`);
              }
            } else {
              lines.push(`    ${serializeEntryKey(eKey)}: ${serializeScalar(eVal)}`);
            }
          }
        }
      } else {
        // Simple array — use inline format for short arrays, multi-line for long ones
        if (value.length <= 5 && value.every(v => typeof v === 'string' && v.length < 30)) {
          lines.push(`${key}: [${value.map(v => serializeScalar(v)).join(', ')}]`);
        } else {
          lines.push(`${key}:`);
          for (const item of value) {
            lines.push(`  - ${serializeScalar(item)}`);
          }
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      // Nested object
      lines.push(`${key}:`);
      for (const [subKey, subVal] of Object.entries(value as Record<string, unknown>)) {
        if (subVal === undefined || subVal === null) continue;
        lines.push(`  ${serializeEntryKey(subKey)}: ${serializeScalar(subVal)}`);
      }
    } else {
      lines.push(`${key}: ${serializeScalar(value)}`);
    }
  }

  return lines.join('\n') + '\n';
}

/** Quote a YAML key if it contains special characters. */
function serializeEntryKey(key: string): string {
  if (/[:#[\]{},|>&*!?@`'"]/m.test(key)) {
    return `"${key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return key;
}

function serializeScalar(value: unknown): string {
  if (typeof value === 'string') {
    // Quote if contains special chars, is empty, or could be misinterpreted
    if (value === '' || /[:#[\]{},|>&*!?@`'"]/m.test(value) || /^\s/.test(value) || /\s$/.test(value)) {
      return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    // Quote if it looks like a number or boolean
    if (/^(true|false|null|~|-?\d+(\.\d+)?)$/.test(value)) {
      return `"${value}"`;
    }
    return value;
  }
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return typeof value === 'undefined' ? '' : String(value as string | number | boolean);
}

// ── File Helpers ─────────────────────────────────────────────────────

/**
 * Read a vault file and extract its frontmatter and body.
 */
export async function readEntityFile(vault: Vault, file: TFile): Promise<{ frontmatter: Record<string, unknown>; body: string }> {
  const content = await vault.read(file);
  return extractFrontmatterAndBody(content);
}

/**
 * Write frontmatter + body back to a vault file.
 */
export async function writeEntityFile(vault: Vault, file: TFile, frontmatter: Record<string, unknown>, body: string): Promise<void> {
  const content = serializeFrontmatterAndBody(frontmatter, body);
  await vault.modify(file, content);
}

/**
 * Create a new entity file with frontmatter and optional body text.
 * Ensures the parent folder exists.
 */
export async function createEntityFile(vault: Vault, filePath: string, frontmatter: Record<string, unknown>, body: string): Promise<TFile> {
  // Ensure parent folder exists
  const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));
  if (folderPath && !vault.getAbstractFileByPath(folderPath)) {
    try {
      await vault.createFolder(folderPath);
    } catch {
      // Folder may already exist (stale cache) — ignore
    }
  }

  const content = serializeFrontmatterAndBody(frontmatter, body);

  // If the file already exists, overwrite it instead of throwing
  const existing = vault.getAbstractFileByPath(filePath);
  if (existing instanceof TFile) {
    await vault.modify(existing, content);
    return existing;
  }

  return await vault.create(filePath, content);
}

/**
 * Get the current ISO date string (YYYY-MM-DD).
 */
export function isoDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Generate a UUID v4 for entity identifiers.
 */
export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
