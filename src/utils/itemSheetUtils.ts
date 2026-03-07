import type { ItemSheetData } from '../types';

/**
 * Parse an item markdown file into structured ItemSheetData
 */
export function parseItemSheet(content: string): ItemSheetData {
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

export function serializeItemSheet(data: ItemSheetData): string {
  const sanitize = (val: string): string => val.replace(/[\r\n]+/g, ' ').trim();

  let result = `# ${data.name}\n\n`;
  result += '## ItemSheet\n';
  if (data.templateId) {
    result += `TemplateId: ${sanitize(data.templateId)}\n`;
  }
  result += `Name: ${sanitize(data.name)}\n`;
  result += `Type: ${sanitize(data.type)}\n`;
  result += `Origin: ${sanitize(data.origin)}\n`;

  if (data.description) {
    result += 'Description:\n';
    result += `${data.description.trim()}\n`;
  }

  if (data.images && data.images.length > 0) {
    result += 'Images:\n';
    for (const img of data.images) {
      result += `- ${sanitize(img.name)}: ${sanitize(img.path)}\n`;
    }
  }

  if (Object.keys(data.customProperties).length > 0) {
    result += 'CustomProperties:\n';
    for (const [key, val] of Object.entries(data.customProperties)) {
      result += `- ${sanitize(key)}: ${sanitize(val)}\n`;
    }
  }

  if (data.sections && data.sections.length > 0) {
    result += 'Sections:\n';
    for (const section of data.sections) {
      result += `${sanitize(section.title)}\n`;
      result += `${section.content.trim()}\n`;
      result += '---\n';
    }
  }

  return result;
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
