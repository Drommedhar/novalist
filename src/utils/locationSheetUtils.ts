import type {
  LocationSheetData
} from '../types';

/**
 * Parse a location markdown file into structured LocationSheetData
 */
export function parseLocationSheet(content: string): LocationSheetData {
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

export function serializeLocationSheet(data: LocationSheetData): string {
  // Helper to sanitize a single-line value
  const sanitize = (val: string): string => {
    return val.replace(/[\r\n]+/g, ' ').trim();
  };
  
  let result = `# ${data.name}\n\n`;
  
  // LocationSheet block
  result += '## LocationSheet\n';
  if (data.templateId) {
    result += `TemplateId: ${sanitize(data.templateId)}\n`;
  }
  result += `Name: ${sanitize(data.name)}\n`;
  result += `Type: ${sanitize(data.type)}\n`;
  if (data.parent) {
    result += `Parent: ${sanitize(data.parent)}\n`;
  }

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

  if (data.relationships && data.relationships.length > 0) {
    result += 'Relationships:\n';
    for (const rel of data.relationships) {
      result += `- ${sanitize(rel.role)}: ${sanitize(rel.target)}\n`;
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
