import type { ItemSheetData } from '../types';
import { extractFrontmatterAndBody, serializeFrontmatterAndBody } from '../services/FrontmatterUtils';

/** Helper: detect YAML‑frontmatter content. */
function isYamlContent(content: string): boolean {
  return content.trimStart().startsWith('---\n') || content.trimStart().startsWith('---\r\n');
}

/** Safely coerce an unknown frontmatter value to string. */
function str(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

// ── YAML → ItemSheetData ────────────────────────────────────────────

function parseItemFromYaml(content: string): ItemSheetData {
  const { frontmatter: fm, body } = extractFrontmatterAndBody(content);

  const rawCustom = (fm.custom ?? {}) as Record<string, string>;
  const customProperties: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawCustom)) {
    customProperties[k] = str(v);
  }

  // Images: prefer novalist_images array, fall back to single `image` field
  const images: { name: string; path: string }[] = [];
  const rawImages = fm.novalist_images as { name?: string; path?: string }[] | undefined;
  if (Array.isArray(rawImages) && rawImages.length > 0) {
    for (const img of rawImages) {
      const p = str(img.path).replace(/\[\[|\]\]/g, '').replace(/^!/, '').trim();
      if (p) images.push({ name: str(img.name) || 'Main', path: `[[${p}]]` });
    }
  } else {
    const primaryImage = str(fm.image).replace(/^!/, '').trim();
    if (primaryImage) {
      images.push({ name: 'Main', path: `[[${primaryImage.replace(/\[\[|\]\]/g, '')}]]` });
    }
  }

  const sections: { title: string; content: string }[] = [];
  if (body.trim()) {
    const sectionBlocks = body.split(/^## /m).filter(Boolean);
    for (const block of sectionBlocks) {
      const lines = block.split('\n');
      const title = lines[0].trim();
      const sectionContent = lines.slice(1).join('\n').trim();
      if (title) sections.push({ title, content: sectionContent });
    }
    if (sections.length === 0 && body.trim()) {
      sections.push({ title: 'Notes', content: body.trim() });
    }
  }

  return {
    name: str(fm.name),
    type: str(fm.itemType),
    description: str(fm.description),
    origin: str(fm.origin),
    images,
    customProperties,
    sections,
    templateId: fm.novalist_templateId ? str(fm.novalist_templateId) : undefined,
  };
}

// ── ItemSheetData → YAML ────────────────────────────────────────────

function serializeItemToYaml(data: ItemSheetData): string {
  const fm: Record<string, unknown> = {
    type: 'item',
    name: data.name,
  };
  if (data.type) fm.itemType = data.type;
  if (data.origin) fm.origin = data.origin;
  if (data.description) fm.description = data.description;

  const allImages = data.images
    .map(i => ({ name: i.name, path: i.path.replace(/\[\[|\]\]/g, '').replace(/^!/, '').trim() }))
    .filter(i => i.path);
  const primaryImage = allImages[0]?.path;
  if (primaryImage) fm.image = primaryImage;
  if (allImages.length > 0) fm.novalist_images = allImages;

  if (Object.keys(data.customProperties).length > 0) {
    fm.custom = data.customProperties;
  }
  if (data.templateId) fm.novalist_templateId = data.templateId;

  const bodyParts: string[] = [];
  for (const section of data.sections) {
    bodyParts.push(`## ${section.title}\n\n${section.content}`);
  }
  const body = bodyParts.join('\n\n');

  return serializeFrontmatterAndBody(fm, body);
}

/**
 * Parse an item markdown file into structured ItemSheetData.
 * Supports both YAML frontmatter format (new) and legacy ## ItemSheet blocks.
 */
export function parseItemSheet(content: string): ItemSheetData {
  // Detect format
  if (isYamlContent(content)) {
    const { frontmatter } = extractFrontmatterAndBody(content);
    if (frontmatter.type === 'item') {
      return parseItemFromYaml(content);
    }
  }

  // ── Legacy parser ─────────────────────────────────────────────────
  const normalized = content.replace(/\r\n/g, '\n');
  const data: ItemSheetData = {
    name: '',
    type: '',
    description: '',
    origin: '',
    images: [],
    customProperties: {},
    sections: []
  };

  // Extract name from title (first # heading)
  const titleMatch = normalized.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    data.name = titleMatch[1].trim();
  }

  const sheetContent = getSheetSection(normalized, 'ItemSheet');
  if (!sheetContent) return data;

  const parseField = (fieldContent: string, fieldName: string): string => {
    const pattern = new RegExp(`^[ \\t]*${fieldName}:[ \\t]*(.*?)$`, 'm');
    const match = fieldContent.match(pattern);
    if (!match) return '';
    const value = match[1].trim();
    const knownFields = ['Name:', 'Type:', 'Description:', 'Origin:', 'CustomProperties:', 'Sections:', 'TemplateId:', 'Images:'];
    for (const field of knownFields) {
      if (value.includes(field)) {
        return value.substring(0, value.indexOf(field)).trim();
      }
    }
    return value;
  };

  const parsedName = parseField(sheetContent, 'Name');
  if (parsedName) data.name = parsedName;

  data.type = parseField(sheetContent, 'Type');
  data.origin = parseField(sheetContent, 'Origin');
  data.templateId = parseField(sheetContent, 'TemplateId') || undefined;

  // Parse description (multi-line)
  const descSectionIdx = sheetContent.indexOf('\nDescription:\n');
  if (descSectionIdx !== -1) {
    const startIdx = descSectionIdx + '\nDescription:\n'.length;
    let endIdx = sheetContent.length;
    const nextSections = ['Origin:', 'Type:', 'Images:', 'CustomProperties:', 'Sections:'];
    for (const nextSec of nextSections) {
      const nextMatch = sheetContent.indexOf('\n' + nextSec, startIdx);
      if (nextMatch !== -1 && nextMatch < endIdx) {
        endIdx = nextMatch;
      }
    }
    data.description = sheetContent.substring(startIdx, endIdx).trim();
  } else {
    const inlineDesc = parseField(sheetContent, 'Description');
    if (inlineDesc) data.description = inlineDesc;
  }

  // Parse images
  const imagesSectionIdx = sheetContent.indexOf('\nImages:\n');
  if (imagesSectionIdx !== -1) {
    const startIdx = imagesSectionIdx + '\nImages:\n'.length;
    let endIdx = sheetContent.length;
    const nextSections = ['CustomProperties:', 'Sections:'];
    for (const nextSec of nextSections) {
      const nextMatch = sheetContent.indexOf('\n' + nextSec, startIdx);
      if (nextMatch !== -1 && nextMatch < endIdx) {
        endIdx = nextMatch;
      }
    }
    const imagesContent = sheetContent.substring(startIdx, endIdx).trim();
    for (const line of imagesContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const imgMatch = trimmed.match(/^[-*]\s+(.+?)\s*:\s*(.+)$/);
      if (imgMatch) {
        data.images.push({ name: imgMatch[1].trim(), path: imgMatch[2].trim() });
      }
    }
  }

  // Parse custom properties
  const customSectionIdx = sheetContent.indexOf('\nCustomProperties:\n');
  if (customSectionIdx !== -1) {
    const startIdx = customSectionIdx + '\nCustomProperties:\n'.length;
    let endIdx = sheetContent.length;
    const nextSections = ['Sections:'];
    for (const nextSec of nextSections) {
      const nextMatch = sheetContent.indexOf('\n' + nextSec, startIdx);
      if (nextMatch !== -1 && nextMatch < endIdx) {
        endIdx = nextMatch;
      }
    }
    const customContent = sheetContent.substring(startIdx, endIdx).trim();
    for (const line of customContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const propMatch = trimmed.match(/^[-*]\s+(.+?)\s*:\s*(.*)$/);
      if (propMatch) {
        data.customProperties[propMatch[1].trim()] = propMatch[2].trim();
      }
    }
  }

  // Parse sections
  const sectionsIdx = sheetContent.indexOf('\nSections:\n');
  if (sectionsIdx !== -1) {
    const startIdx = sectionsIdx + '\nSections:\n'.length;
    const sectionsText = sheetContent.substring(startIdx).trim();
    const sectionBlocks = sectionsText.split(/^\s*---\s*$/m);
    for (const block of sectionBlocks) {
      const trimmedBlock = block.trim();
      if (!trimmedBlock) continue;
      const lines = trimmedBlock.split('\n');
      const title = lines[0].trim();
      const sectionContent = lines.slice(1).join('\n').trim();
      if (title) {
        data.sections.push({ title, content: sectionContent });
      }
    }
  }

  return data;
}

/**
 * Serialize ItemSheetData to YAML frontmatter format.
 */
export function serializeItemSheet(data: ItemSheetData): string {
  return serializeItemToYaml(data);
}

function getSheetSection(content: string, heading: string): string | null {
  const lines = content.split('\n');
  const startIdx = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (startIdx === -1) return null;

  const sectionLines: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('## ')) break;
    sectionLines.push(lines[i]);
  }

  return sectionLines.join('\n');
}
