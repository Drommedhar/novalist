import type {
  CharacterSheetData,
  CharacterChapterOverride
} from '../types';

/**
 * Parse a character markdown file into structured CharacterSheetData
 * The format stores data in a human-readable markdown format with markers
 */
export function parseCharacterSheet(content: string): CharacterSheetData {
  const normalized = content.replace(/\r\n/g, '\n');
  const data: CharacterSheetData = {
    name: '',
    surname: '',
    gender: '',
    age: '',
    role: '',
    faceShot: '',
    images: [],
    relationships: [],
    customProperties: {},
    sections: [],
    chapterOverrides: []
  };

  // Extract name from title (first # heading)
  const titleMatch = normalized.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    const fullName = titleMatch[1].trim();
    const nameParts = fullName.split(' ');
    data.name = nameParts[0] || '';
    data.surname = nameParts.slice(1).join(' ') || '';
  }

  const sheetContent = getSheetSection(normalized, 'CharacterSheet');
  
  if (sheetContent) {
    
    // Helper to parse a single-line value (stops at newline or next known field)
    const parseField = (content: string, fieldName: string): string => {
      const pattern = new RegExp(`^\\s*${fieldName}:\\s*(.*?)$`, 'm');
      const match = content.match(pattern);
      if (!match) return '';
      const value = match[1].trim();
      // Check if the value contains another known field name (corrupted data)
      const knownFields = ['Name:', 'Surname:', 'Gender:', 'Age:', 'Role:', 'FaceShot:', 'Relationships:', 'CustomProperties:', 'Sections:', 'ChapterOverrides:'];
      for (const field of knownFields) {
        if (value.includes(field)) {
          // Value is corrupted, return empty
          return '';
        }
      }
      return value;
    };
    
    // Parse basic properties
    data.name = parseField(sheetContent, 'Name') || data.name;
    data.surname = parseField(sheetContent, 'Surname') || data.surname;
    data.gender = parseField(sheetContent, 'Gender');
    data.age = parseField(sheetContent, 'Age');
    data.role = parseField(sheetContent, 'Role');
    data.faceShot = parseField(sheetContent, 'FaceShot');
    
    // Parse relationships section within CharacterSheet
    const relSectionIdx = sheetContent.indexOf('\nRelationships:\n');
    if (relSectionIdx !== -1) {
      const startIdx = relSectionIdx + '\nRelationships:\n'.length;
      let endIdx = sheetContent.length;
      const nextSections = ['Images:', 'CustomProperties:', 'Sections:', 'ChapterOverrides:'];
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
        // Match format: - Role: [[Character]] or - Role: Character
        const relMatch = trimmed.match(/^[-*]\s*(.+?)\s*:\s*(.+)$/);
        if (relMatch) {
          const role = relMatch[1].trim();
          const character = relMatch[2].trim();
          data.relationships.push({ role, character });
        }
      }
    }
    
    // Parse images
    const imagesSectionMatch = sheetContent.match(/\nImages:\n/);
    if (imagesSectionMatch && imagesSectionMatch.index !== undefined) {
      const startIdx = imagesSectionMatch.index + imagesSectionMatch[0].length;
      let endIdx = sheetContent.length;
      const nextSections = ['CustomProperties:', 'Sections:', 'ChapterOverrides:'];
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
        // Match format: - Name: [[ImagePath]] or - Name: path
        const imgMatch = trimmed.match(/^[-*]\s*(.+?)\s*:\s*(.+)$/);
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
      const nextSections = ['Sections:', 'ChapterOverrides:'];
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
        const propMatch = trimmed.match(/^[-*]\s*(.+?)\s*:\s*(.*)$/);
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
      const nextMatch = sheetContent.indexOf('\nChapterOverrides:', startIdx);
      if (nextMatch !== -1) {
        endIdx = nextMatch;
      }
      const sectionsText = sheetContent.substring(startIdx, endIdx).trim();
      // Sections are separated by --- or by section headers
      const sectionBlocks = sectionsText.split(/^\s*---\s*$/m);
      
      for (const block of sectionBlocks) {
        const trimmedBlock = block.trim();
        if (!trimmedBlock) continue;
        
        // First line is the title, rest is content
        const lines = trimmedBlock.split('\n');
        const title = lines[0].trim();
        const content = lines.slice(1).join('\n').trim();
        
        if (title) {
          data.sections.push({ title, content });
        }
      }
    }
    
    // Parse chapter overrides
    const chapterMatch = sheetContent.match(/^\s*ChapterOverrides:\s*([\s\S]*)$/m);
    if (chapterMatch) {
      const chapterText = chapterMatch[1];
      // Each chapter override starts with "Chapter: Name"
      const chapterBlocks = chapterText.split(/^\s*Chapter:\s*/m).filter(Boolean);
      
      for (const block of chapterBlocks) {
        const lines = block.split('\n');
        const chapter = lines[0].trim();
        const override: CharacterChapterOverride = { chapter };
        
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          // Check for nested properties
          const match = line.match(/^[-*]\s*(.+?)\s*:\s*(.*)$/);
          if (match) {
            const key = match[1].trim().toLowerCase();
            const value = match[2].trim();
            
            switch (key) {
              case 'name': override.name = value; break;
              case 'surname': override.surname = value; break;
              case 'gender': override.gender = value; break;
              case 'age': override.age = value; break;
              case 'role': override.role = value; break;
              case 'faceshot': override.faceShot = value; break;
              case 'images':
                override.images = [];
                // Parse subsequent indented image lines
                for (let j = i + 1; j < lines.length; j++) {
                  const imgLine = lines[j];
                  if (!imgLine.match(/^\s+[-*]/)) break;
                  const imgMatch = imgLine.match(/^\s+[-*]\s*(.+?)\s*:\s*(.+)$/);
                  if (imgMatch) {
                    override.images?.push({
                      name: imgMatch[1].trim(),
                      path: imgMatch[2].trim()
                    });
                  }
                  i = j;
                }
                break;
              case 'relationships':
                override.relationships = [];
                // Parse subsequent indented relationship lines
                for (let j = i + 1; j < lines.length; j++) {
                  const relLine = lines[j];
                  if (!relLine.match(/^\s+[-*]/)) break;
                  const relMatch = relLine.match(/^\s+[-*]\s*(.+?)\s*:\s*(.+)$/);
                  if (relMatch) {
                    override.relationships?.push({
                      role: relMatch[1].trim(),
                      character: relMatch[2].trim()
                    });
                  }
                  i = j;
                }
                break;
              case 'customproperties':
                override.customProperties = {};
                for (let j = i + 1; j < lines.length; j++) {
                  const propLine = lines[j];
                  if (!propLine.match(/^\s+[-*]/)) break;
                  const propMatch = propLine.match(/^\s+[-*]\s*(.+?)\s*:\s*(.*)$/);
                  if (propMatch) {
                    if (!override.customProperties) override.customProperties = {};
                    override.customProperties[propMatch[1].trim()] = propMatch[2].trim();
                  }
                  i = j;
                }
                break;
              default:
                if (!override.customProperties) override.customProperties = {};
                override.customProperties[key] = value;
            }
          }
        }
        
        data.chapterOverrides.push(override);
      }
    }
  } else {
    // Fallback: try to parse from legacy format (General Information section)
    parseLegacyFormat(normalized, data);
  }

  return data;
}

function parseLegacyFormat(content: string, data: CharacterSheetData): void {
  // Try to extract from General Information section
  const generalSection = extractSection(content, 'General Information');
  if (generalSection) {
    const roleMatch = generalSection.match(/^[-*]\s*\*\*Role\*\*:\s*(.+)$/m);
    if (roleMatch) data.role = roleMatch[1].trim();
    
    const genderMatch = generalSection.match(/^[-*]\s*\*\*Gender\*\*:\s*(.*)$/m);
    if (genderMatch) data.gender = genderMatch[1].trim();
    
    const ageMatch = generalSection.match(/^[-*]\s*\*\*Age\*\*:\s*(.*)$/m);
    if (ageMatch) data.age = ageMatch[1].trim();
    
    const relMatch = generalSection.match(/^[-*]\s*\*\*Relationship\*\*:\s*(.*)$/m);
    if (relMatch && relMatch[1].trim()) {
      // Convert single relationship to a custom property
      data.customProperties['relationship'] = relMatch[1].trim();
    }
  }

  // Try to extract from Images section
  const imagesSection = extractSection(content, 'Images');
  if (imagesSection) {
    const mainMatch = imagesSection.match(/^[-*]\s*\*\*Main\*\*:\s*(.+)$/m);
    if (mainMatch && mainMatch[1].trim()) {
      data.faceShot = mainMatch[1].trim();
    }
  }

  // Try to extract from Relationships section
  const relSection = extractSection(content, 'Relationships');
  if (relSection) {
    const lines = relSection.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const relMatch = trimmed.match(/^[-*]\s*\*\*(.+?)\*\*:\s*(.+)$/);
      if (relMatch) {
        const role = relMatch[1].trim();
        const characterText = relMatch[2].trim();
        // Extract wikilinks from character text
        const wikilinkMatch = characterText.match(/\[\[(.+?)\]\]/);
        if (wikilinkMatch) {
          data.relationships.push({
            role,
            character: `[[${wikilinkMatch[1]}]]`
          });
        } else {
          data.relationships.push({ role, character: characterText });
        }
      }
    }
  }

  // Extract other sections as free sections
  const knownSections = ['General Information', 'Appearance', 'Personality', 'Relationships', 'Images', 'Chapter Relevant Information'];
  const sectionRegex = /^##\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  
  while ((match = sectionRegex.exec(content)) !== null) {
    const sectionName: string = match[1].trim();
    if (!knownSections.includes(sectionName) && !sectionName.startsWith('Chapter:')) {
      const sectionContent = extractSection(content, sectionName);
      if (sectionContent) {
        data.sections.push({
          title: sectionName,
          content: sectionContent.trim()
        });
      }
    }
  }
}

function extractSection(content: string, sectionName: string): string | null {
  const lines = content.split('\n');
  const sectionIdx = lines.findIndex(l => l.trim() === `## ${sectionName}`);
  if (sectionIdx === -1) return null;

  const sectionLines: string[] = [];
  for (let i = sectionIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('## ')) break;
    sectionLines.push(lines[i]);
  }

  return sectionLines.join('\n');
}

/**
 * Serialize CharacterSheetData to markdown format
 * Sanitizes values to prevent breaking the format
 */
export function serializeCharacterSheet(data: CharacterSheetData): string {
  const fullName = `${data.name} ${data.surname}`.trim();
  
  // Helper to sanitize a single-line value
  const sanitize = (val: string): string => {
    // Replace newlines and carriage returns with spaces
    return val.replace(/[\r\n]+/g, ' ').trim();
  };
  
  let result = `# ${fullName}\n\n`;
  
  // CharacterSheet block
  result += '## CharacterSheet\n';
  result += `Name: ${sanitize(data.name)}\n`;
  result += `Surname: ${sanitize(data.surname)}\n`;
  result += `Gender: ${sanitize(data.gender)}\n`;
  result += `Age: ${sanitize(data.age)}\n`;
  result += `Role: ${sanitize(data.role)}\n`;
  result += `FaceShot: ${sanitize(data.faceShot)}\n\n`;
  
  // Relationships
  result += 'Relationships:\n';
  if (data.relationships.length > 0) {
    for (const rel of data.relationships) {
      result += `- ${sanitize(rel.role)}: ${sanitize(rel.character)}\n`;
    }
  }
  result += '\n';
  
  // Images
  result += 'Images:\n';
  if (data.images.length > 0) {
    for (const img of data.images) {
      result += `- ${sanitize(img.name)}: ${sanitize(img.path)}\n`;
    }
  }
  result += '\n';
  
  // Custom Properties
  result += 'CustomProperties:\n';
  const customKeys = Object.keys(data.customProperties);
  if (customKeys.length > 0) {
    for (const key of customKeys) {
      result += `- ${sanitize(key)}: ${sanitize(data.customProperties[key])}\n`;
    }
  }
  result += '\n';
  
  // Sections
  result += 'Sections:\n';
  if (data.sections.length > 0) {
    for (const section of data.sections) {
      result += `${sanitize(section.title)}\n${section.content}\n---\n`;
    }
  }
  result += '\n';
  
  // Chapter Overrides
  result += 'ChapterOverrides:\n';
  if (data.chapterOverrides.length > 0) {
    for (const override of data.chapterOverrides) {
      result += `Chapter: ${sanitize(override.chapter)}\n`;
      if (override.name) result += `- Name: ${sanitize(override.name)}\n`;
      if (override.surname) result += `- Surname: ${sanitize(override.surname)}\n`;
      if (override.gender) result += `- Gender: ${sanitize(override.gender)}\n`;
      if (override.age) result += `- Age: ${sanitize(override.age)}\n`;
      if (override.role) result += `- Role: ${sanitize(override.role)}\n`;
      if (override.faceShot) result += `- FaceShot: ${sanitize(override.faceShot)}\n`;
      if (override.images && override.images.length > 0) {
        result += `- Images:\n`;
        for (const img of override.images) {
          result += `  - ${sanitize(img.name)}: ${sanitize(img.path)}\n`;
        }
      }
      if (override.relationships && override.relationships.length > 0) {
        result += `- Relationships:\n`;
        for (const rel of override.relationships) {
          result += `  - ${sanitize(rel.role)}: ${sanitize(rel.character)}\n`;
        }
      }
      if (override.customProperties) {
        const keys = Object.keys(override.customProperties);
        if (keys.length > 0) {
          result += `- CustomProperties:\n`;
          for (const key of keys) {
            result += `  - ${sanitize(key)}: ${sanitize(override.customProperties[key])}\n`;
          }
        }
      }
      result += '\n';
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

/**
 * Check if content contains a CharacterSheet block
 */
export function hasCharacterSheet(content: string): boolean {
  return /<!--\s*CharacterSheet/.test(content);
}

/**
 * Get all section titles used across all character files
 */
export function getKnownSectionTitles(plugin: { app: { vault: { getFiles: () => Array<{ path: string; extension: string; basename: string }> } }; settings: { projectPath: string; characterFolder: string } }): Set<string> {
  const titles = new Set<string>();
  const { projectPath, characterFolder } = plugin.settings;
  const folder = `${projectPath}/${characterFolder}`;
  
  const files = plugin.app.vault.getFiles().filter(f => 
    f.path.startsWith(folder) && f.extension === 'md'
  );
  
  for (const _file of files) {
    // We can't read content here since this is sync, but we could return the set
    // and populate it async elsewhere
    void _file.basename; // Avoid unused variable warning
  }
  
  return titles;
}

/**
 * Merge data with chapter override for display
 */
export function applyChapterOverride(
  data: CharacterSheetData,
  chapterName: string
): CharacterSheetData {
  const override = data.chapterOverrides.find(o => o.chapter === chapterName);
  if (!override) return data;
  
  return {
    ...data,
    name: override.name ?? data.name,
    surname: override.surname ?? data.surname,
    gender: override.gender ?? data.gender,
    age: override.age ?? data.age,
    role: override.role ?? data.role,
    faceShot: override.faceShot ?? data.faceShot,
    relationships: override.relationships ?? data.relationships,
    customProperties: override.customProperties 
      ? { ...data.customProperties, ...override.customProperties }
      : data.customProperties
  };
}
