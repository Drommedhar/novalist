/**
 * LoreService — CRUD for lore/encyclopedia files with YAML frontmatter.
 *
 * Lore entries are Novalist-only entities (no StoryLine equivalent).
 * They live in the Lore/ folder and use `type: lore` frontmatter.
 */

import { TFile, type Vault } from 'obsidian';
import type { NovalistLore } from '../types/novalist-extensions';
import {
  extractFrontmatterAndBody,
  serializeFrontmatterAndBody,
  createEntityFile,
  isoDate,
} from './FrontmatterUtils';

// ── CRUD ────────────────────────────────────────────────────────────

/**
 * Read a lore file and return a NovalistLore.
 */
export async function readLore(vault: Vault, file: TFile): Promise<NovalistLore> {
  const content = await vault.read(file);
  return parseLoreContent(content, file.path);
}

/**
 * Parse a lore entry from its raw markdown content.
 */
export function parseLoreContent(content: string, filePath: string): NovalistLore {
  const { frontmatter: fm, body } = extractFrontmatterAndBody(content);

  return {
    type: 'lore',
    filePath,
    name: (fm.name as string) || filePath.split('/').pop()?.replace(/\.md$/, '') || '',
    loreCategory: fm.loreCategory as string | undefined,
    description: fm.description as string | undefined,
    image: fm.image as string | undefined,
    custom: (fm.custom as Record<string, string>) || {},
    notes: body || undefined,
    novalist_templateId: fm.novalist_templateId as string | undefined,
    created: fm.created as string | undefined,
    modified: fm.modified as string | undefined,
  };
}

/**
 * Write a NovalistLore back to its file.
 */
export async function writeLore(vault: Vault, lore: NovalistLore): Promise<void> {
  const file = vault.getAbstractFileByPath(lore.filePath);
  if (!(file instanceof TFile)) return;

  const { frontmatter, body } = loreToFrontmatterAndBody(lore);
  const content = serializeFrontmatterAndBody(frontmatter, body);
  await vault.modify(file, content);
}

/**
 * Create a new lore file.
 */
export async function createLore(
  vault: Vault,
  loreFolder: string,
  name: string,
  options?: Partial<NovalistLore>
): Promise<NovalistLore> {
  const safeName = name.replace(/[\\/:*?"<>|]/g, '_');
  const filePath = `${loreFolder}/${safeName}.md`;

  const now = isoDate();
  const lore: NovalistLore = {
    type: 'lore',
    filePath,
    name,
    loreCategory: options?.loreCategory || '',
    description: options?.description || '',
    image: options?.image,
    custom: options?.custom || {},
    notes: options?.notes || '',
    novalist_templateId: options?.novalist_templateId,
    created: now,
    modified: now,
  };

  const { frontmatter, body } = loreToFrontmatterAndBody(lore);
  const file = await createEntityFile(vault, filePath, frontmatter, body);
  lore.filePath = file.path;

  return lore;
}

/**
 * List all lore entries in a folder.
 */
export async function listLore(vault: Vault, loreFolder: string): Promise<NovalistLore[]> {
  const mdFiles = vault.getFiles().filter(f =>
    f.path.startsWith(loreFolder + '/') && f.extension === 'md'
  );

  const entries: NovalistLore[] = [];
  for (const file of mdFiles) {
    try {
      const content = await vault.read(file);
      const { frontmatter } = extractFrontmatterAndBody(content);
      if (frontmatter.type === 'lore') {
        entries.push(parseLoreContent(content, file.path));
      }
    } catch {
      // Skip unparseable files
    }
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Internal Helpers ────────────────────────────────────────────────

function loreToFrontmatterAndBody(lore: NovalistLore): { frontmatter: Record<string, unknown>; body: string } {
  const fm: Record<string, unknown> = {
    type: 'lore',
    name: lore.name,
  };

  if (lore.loreCategory) fm.loreCategory = lore.loreCategory;
  if (lore.description) fm.description = lore.description;
  if (lore.image) fm.image = lore.image;
  if (lore.novalist_images && lore.novalist_images.length > 0) {
    fm.novalist_images = lore.novalist_images;
  }
  if (lore.custom && Object.keys(lore.custom).length > 0) fm.custom = lore.custom;
  fm.created = lore.created || isoDate();
  fm.modified = lore.modified || isoDate();
  if (lore.novalist_templateId) fm.novalist_templateId = lore.novalist_templateId;

  return { frontmatter: fm, body: lore.notes || '' };
}
