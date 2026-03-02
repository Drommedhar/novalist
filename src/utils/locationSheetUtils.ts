import type {
  LocationSheetData
} from '../types';
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

// ── YAML → LocationSheetData ────────────────────────────────────────

function parseLocationFromYaml(content: string): LocationSheetData {
  const { frontmatter: fm, body } = extractFrontmatterAndBody(content);

  const rawCustom = (fm.custom ?? {}) as Record<string, string>;
  const customProperties: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawCustom)) {
    customProperties[k] = str(v);
  }

  // Parse relationships (Novalist extension)
  const rawRels = (fm.novalist_relationships ?? []) as { role?: string; target?: string }[];
  const relationships = rawRels.map(r => ({
    role: str(r.role),
    target: r.target ? `[[${str(r.target).replace(/\[\[|\]\]/g, '')}]]` : '',
  }));

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

  // Parent
  const parentRaw = str(fm.parent);
  const parent = parentRaw ? `[[${parentRaw.replace(/\[\[|\]\]/g, '')}]]` : '';

  // Sections from body
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
    type: str(fm.locationType),
    parent,
    description: str(fm.description),
    images,
    relationships,
    customProperties,
    sections,
    templateId: fm.novalist_templateId ? str(fm.novalist_templateId) : undefined,
  };
}

// ── LocationSheetData → YAML ────────────────────────────────────────

function serializeLocationToYaml(data: LocationSheetData): string {
  const fm: Record<string, unknown> = {
    type: 'location',
    name: data.name,
  };
  if (data.type) fm.locationType = data.type;
  if (data.parent) {
    fm.parent = data.parent.replace(/\[\[|\]\]/g, '').trim();
  }
  if (data.description) fm.description = data.description;

  const allImages = data.images
    .map(i => ({ name: i.name, path: i.path.replace(/\[\[|\]\]/g, '').replace(/^!/, '').trim() }))
    .filter(i => i.path);
  const primaryImage = allImages[0]?.path;
  if (primaryImage) fm.image = primaryImage;
  if (allImages.length > 0) fm.novalist_images = allImages;

  if (data.relationships.length > 0) {
    fm.novalist_relationships = data.relationships.map(r => ({
      role: r.role,
      target: r.target.replace(/\[\[|\]\]/g, '').trim(),
    }));
  }
  if (Object.keys(data.customProperties).length > 0) {
    fm.custom = data.customProperties;
  }
  if (data.templateId) fm.novalist_templateId = data.templateId;

  // Body from sections
  const bodyParts: string[] = [];
  for (const section of data.sections) {
    bodyParts.push(`## ${section.title}\n\n${section.content}`);
  }
  const body = bodyParts.join('\n\n');

  return serializeFrontmatterAndBody(fm, body);
}

/**
 * Parse a location markdown file into structured LocationSheetData.
 * Supports both YAML frontmatter format (new) and legacy ## LocationSheet blocks.
 */
export function parseLocationSheet(content: string): LocationSheetData {
  // Detect format
  if (isYamlContent(content)) {
    const { frontmatter } = extractFrontmatterAndBody(content);
    if (frontmatter.type === 'location' || frontmatter.type === 'world') {
      return parseLocationFromYaml(content);
    }
  }

  // ── Legacy parser ─────────────────────────────────────────────────
  const normalized = content.replace(/\r\n/g, '\n');
  const data: LocationSheetData = {
    name: '',
    type: '',
    parent: '',
    description: '',
    images: [],
    relationships: [], // Still parsed, even if UI is hidden, to avoid data loss
    customProperties: {},
    sections: []
  };

  // Extract name from title (first # heading)
  const titleMatch = normalized.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    data.name = titleMatch[1].trim();
  }

  const sheetContent = getSheetSection(normalized, 'LocationSheet');
  
  if (sheetContent) {
    
    // Helper to parse a single-line value
    const parseField = (content: string, fieldName: string): string => {
      const pattern = new RegExp(`^[ \\t]*${fieldName}:[ \\t]*(.*?)$`, 'm');
      const match = content.match(pattern);
      if (!match) return '';
      const value = match[1].trim();
      const knownFields = ['Name:', 'Type:', 'Parent:', 'Description:', 'Relationships:', 'CustomProperties:', 'Sections:', 'TemplateId:', 'Images:'];
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
    data.parent = parseField(sheetContent, 'Parent');
    data.templateId = parseField(sheetContent, 'TemplateId') || undefined;

    // Parse description (multi-line)
    const descSectionIdx = sheetContent.indexOf('\nDescription:\n');
    if (descSectionIdx !== -1) {
      const startIdx = descSectionIdx + '\nDescription:\n'.length;
      let endIdx = sheetContent.length;
      const nextSections = ['Type:', 'Images:', 'Relationships:', 'CustomProperties:', 'Sections:'];
      for (const nextSec of nextSections) {
        const nextMatch = sheetContent.indexOf('\n' + nextSec, startIdx);
        if (nextMatch !== -1 && nextMatch < endIdx) {
          endIdx = nextMatch;
        }
      }
      data.description = sheetContent.substring(startIdx, endIdx).trim();
    } else {
        // Fallback for single line style if someone wrote Description: ...
        const inlineDesc = parseField(sheetContent, 'Description');
        if (inlineDesc) data.description = inlineDesc;
    }
    
    // Parse relationships (multi-line)
    const relSectionIdx = sheetContent.indexOf('\nRelationships:\n');
    if (relSectionIdx !== -1) {
      const startIdx = relSectionIdx + '\nRelationships:\n'.length;
      let endIdx = sheetContent.length;
      // Look for next sections
      const nextSections = ['CustomProperties:', 'Sections:'];
      for (const nextSec of nextSections) {
        const nextMatch = sheetContent.indexOf('\n' + nextSec, startIdx);
        if (nextMatch !== -1 && nextMatch < endIdx) {
          endIdx = nextMatch;
        }
      }
      const relContent = sheetContent.substring(startIdx, endIdx).trim();
      const relLines = relContent.split('\n');
      for (const line of relLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Only match list items (- or * followed by space)
        const relMatch = trimmed.match(/^[-*]\s+(.+?)\s*:\s*(.+)$/);
        if (relMatch) {
            data.relationships.push({
                role: relMatch[1].trim(),
                target: relMatch[2].trim()
            });
        }
      }
    }
    
    // Parse images (reuse format)
    const imagesSectionIdx = sheetContent.indexOf('\nImages:\n');
    if (imagesSectionIdx !== -1) {
      const startIdx = imagesSectionIdx + '\nImages:\n'.length;
      let endIdx = sheetContent.length;
      const nextSections = ['Relationships:', 'CustomProperties:', 'Sections:'];
      for (const nextSec of nextSections) {
        const nextMatch = sheetContent.indexOf('\n' + nextSec, startIdx);
        if (nextMatch !== -1 && nextMatch < endIdx) {
          endIdx = nextMatch;
        }
      }
      const imagesContent = sheetContent.substring(startIdx, endIdx).trim();
      const imageLines = imagesContent.split('\n');
      for (const line of imageLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Only match list items (- or * followed by space)
        const imgMatch = trimmed.match(/^[-*]\s+(.+?)\s*:\s*(.+)$/);
        if (imgMatch) {
          data.images.push({
            name: imgMatch[1].trim(),
            path: imgMatch[2].trim()
          });
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
      const customLines = customContent.split('\n');
      for (const line of customLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Only match list items (- or * followed by space), not markdown bold (**text**)
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
      let endIdx = sheetContent.length;
      // No more sections after this usually
      const sectionsText = sheetContent.substring(startIdx, endIdx).trim();
      const sectionBlocks = sectionsText.split(/^\s*---\s*$/m);
      
      for (const block of sectionBlocks) {
        const trimmedBlock = block.trim();
        if (!trimmedBlock) continue;
        const lines = trimmedBlock.split('\n');
        const title = lines[0].trim();
        const content = lines.slice(1).join('\n').trim();
        if (title) {
          data.sections.push({ title, content });
        }
      }
    }
    

  } else {
    // Fallback? Assuming new files, or simple fallback
    // Try to parse basic Description from body if no Sheet block
    // Look for ## Description
    const descMatch = normalized.match(/^##\s+Description\s*\n([\s\S]*?)(?=\n##|$)/m);
    if (descMatch) {
        data.description = descMatch[1].trim();
    }
  }

  return data;
}

/**
 * Serialize LocationSheetData to YAML frontmatter format.
 */
export function serializeLocationSheet(data: LocationSheetData): string {
  return serializeLocationToYaml(data);
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
