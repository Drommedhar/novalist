/**
 * ItemService — CRUD for item/artifact files with YAML frontmatter.
 *
 * Items are Novalist-only entities (no StoryLine equivalent).
 * They live in the Items/ folder and use `type: item` frontmatter.
 */

import { TFile, type Vault } from 'obsidian';
import type { NovalistItem } from '../types/novalist-extensions';
import {
  extractFrontmatterAndBody,
  serializeFrontmatterAndBody,
  createEntityFile,
  isoDate,
} from './FrontmatterUtils';

// ── CRUD ────────────────────────────────────────────────────────────

/**
 * Read an item file and return a NovalistItem.
 */
export async function readItem(vault: Vault, file: TFile): Promise<NovalistItem> {
  const content = await vault.read(file);
  return parseItemContent(content, file.path);
}

/**
 * Parse an item from its raw markdown content.
 */
export function parseItemContent(content: string, filePath: string): NovalistItem {
  const { frontmatter: fm, body } = extractFrontmatterAndBody(content);

  return {
    type: 'item',
    filePath,
    name: (fm.name as string) || filePath.split('/').pop()?.replace(/\.md$/, '') || '',
    itemType: fm.itemType as string | undefined,
    origin: fm.origin as string | undefined,
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
 * Write a NovalistItem back to its file.
 */
export async function writeItem(vault: Vault, item: NovalistItem): Promise<void> {
  const file = vault.getAbstractFileByPath(item.filePath);
  if (!(file instanceof TFile)) return;

  const { frontmatter, body } = itemToFrontmatterAndBody(item);
  const content = serializeFrontmatterAndBody(frontmatter, body);
  await vault.modify(file, content);
}

/**
 * Create a new item file.
 */
export async function createItem(
  vault: Vault,
  itemFolder: string,
  name: string,
  options?: Partial<NovalistItem>
): Promise<NovalistItem> {
  const safeName = name.replace(/[\\/:*?"<>|]/g, '_');
  const filePath = `${itemFolder}/${safeName}.md`;

  const now = isoDate();
  const item: NovalistItem = {
    type: 'item',
    filePath,
    name,
    itemType: options?.itemType || '',
    origin: options?.origin || '',
    description: options?.description || '',
    image: options?.image,
    custom: options?.custom || {},
    notes: options?.notes || '',
    novalist_templateId: options?.novalist_templateId,
    created: now,
    modified: now,
  };

  const { frontmatter, body } = itemToFrontmatterAndBody(item);
  const file = await createEntityFile(vault, filePath, frontmatter, body);
  item.filePath = file.path;

  return item;
}

/**
 * List all items in a folder.
 */
export async function listItems(vault: Vault, itemFolder: string): Promise<NovalistItem[]> {
  const mdFiles = vault.getFiles().filter(f =>
    f.path.startsWith(itemFolder + '/') && f.extension === 'md'
  );

  const items: NovalistItem[] = [];
  for (const file of mdFiles) {
    try {
      const content = await vault.read(file);
      const { frontmatter } = extractFrontmatterAndBody(content);
      if (frontmatter.type === 'item') {
        items.push(parseItemContent(content, file.path));
      }
    } catch {
      // Skip unparseable files
    }
  }

  return items.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Internal Helpers ────────────────────────────────────────────────

function itemToFrontmatterAndBody(item: NovalistItem): { frontmatter: Record<string, unknown>; body: string } {
  const fm: Record<string, unknown> = {
    type: 'item',
    name: item.name,
  };

  if (item.itemType) fm.itemType = item.itemType;
  if (item.origin) fm.origin = item.origin;
  if (item.description) fm.description = item.description;
  if (item.image) fm.image = item.image;
  if (item.novalist_images && item.novalist_images.length > 0) {
    fm.novalist_images = item.novalist_images;
  }
  if (item.custom && Object.keys(item.custom).length > 0) fm.custom = item.custom;
  fm.created = item.created || isoDate();
  fm.modified = item.modified || isoDate();
  if (item.novalist_templateId) fm.novalist_templateId = item.novalist_templateId;

  return { frontmatter: fm, body: item.notes || '' };
}
