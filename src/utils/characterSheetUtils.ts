import type {
  CharacterSheetData,
  CharacterChapterOverride,
  CharacterImage,
  CharacterRelationship,
} from '../types';
import { extractFrontmatterAndBody, serializeFrontmatterAndBody } from '../services/FrontmatterUtils';
import { RELATIONSHIP_ROLE_MAP } from '../types/novalist-extensions';
import type { CharacterRelationCategory } from '@storyline/models/Character';

// ── Physical-attribute keys stored inside `custom` in YAML format ───
const PHYSICAL_CUSTOM_KEYS = new Set([
  'gender', 'group', 'eyeColor', 'hairColor', 'hairLength',
  'height', 'build', 'skinTone',
]);

/** Safely coerce an unknown frontmatter value to string. */
function str(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** Helper: detect YAML‑frontmatter content vs legacy ## Sheet blocks. */
function isYamlContent(content: string): boolean {
  return content.trimStart().startsWith('---\n') || content.trimStart().startsWith('---\r\n');
}

// ── YAML → CharacterSheetData ───────────────────────────────────────

function parseCharacterFromYaml(content: string): CharacterSheetData {
  const { frontmatter: fm, body } = extractFrontmatterAndBody(content);

  const fullName = str(fm.name);
  const nameParts = fullName.split(' ');
  const firstName = nameParts[0] || '';
  const surname = nameParts.slice(1).join(' ') || '';

  // Custom fields — physical attrs are pulled out, rest stays in customProperties
  const rawCustom = (fm.custom ?? {}) as Record<string, string>;
  const customProperties: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawCustom)) {
    if (!PHYSICAL_CUSTOM_KEYS.has(k)) {
      customProperties[k] = str(v);
    }
  }

  // Relations → relationships
  const rawRelations = (fm.relations ?? []) as { category?: string; type?: string; target?: string }[];
  const relationships: CharacterRelationship[] = rawRelations.map(r => ({
    role: str(r.type),
    character: r.target ? `[[${str(r.target).replace(/\[\[|\]\]/g, '')}]]` : '',
  }));

  // Images: prefer novalist_images array, fall back to single `image` field
  const images: CharacterImage[] = [];
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

  // Chapter overrides
  const rawOverrides = (fm.novalist_chapterOverrides ?? []) as Record<string, unknown>[];
  const chapterOverrides: CharacterChapterOverride[] = rawOverrides.map(o => {
    const ov: CharacterChapterOverride = { chapter: str(o.chapter) };
    if (o.act) ov.act = str(o.act);
    if (o.scene) ov.scene = str(o.scene);
    if (o.name) ov.name = str(o.name);
    if (o.gender) ov.gender = str(o.gender);
    if (o.age) ov.age = str(o.age);
    if (o.role) ov.role = str(o.role);
    if (o.eyeColor) ov.eyeColor = str(o.eyeColor);
    if (o.hairColor) ov.hairColor = str(o.hairColor);
    if (o.hairLength) ov.hairLength = str(o.hairLength);
    if (o.height) ov.height = str(o.height);
    if (o.build) ov.build = str(o.build);
    if (o.skinTone) ov.skinTone = str(o.skinTone);
    if (o.distinguishingFeatures) ov.distinguishingFeatures = str(o.distinguishingFeatures);
    if (o.customProperties) ov.customProperties = o.customProperties as Record<string, string>;
    if (Array.isArray(o.relationships)) {
      ov.relationships = (o.relationships as { type?: string; target?: string }[]).map(r => ({
        role: str(r.type),
        character: r.target ? `[[${str(r.target).replace(/\[\[|\]\]/g, '')}]]` : '',
      }));
    }
    if (Array.isArray(o.images)) {
      ov.images = (o.images as { name?: string; path?: string }[]).map(i => ({
        name: str(i.name),
        path: str(i.path),
      }));
    }
    return ov;
  });

  // Sections from body text (split on ## headings)
  const sections: { title: string; content: string }[] = [];
  if (body.trim()) {
    const sectionBlocks = body.split(/^## /m).filter(Boolean);
    for (const block of sectionBlocks) {
      const lines = block.split('\n');
      const title = lines[0].trim();
      const sectionContent = lines.slice(1).join('\n').trim();
      if (title) sections.push({ title, content: sectionContent });
    }
    // If no ## headings, treat entire body as a single "Notes" section
    if (sections.length === 0 && body.trim()) {
      sections.push({ title: 'Notes', content: body.trim() });
    }
  }

  return {
    name: firstName,
    surname,
    gender: str(rawCustom.gender),
    age: str(fm.age),
    role: str(fm.role),
    group: str(rawCustom.group),
    faceShot: images[0]?.path || '',
    eyeColor: str(rawCustom.eyeColor),
    hairColor: str(rawCustom.hairColor),
    hairLength: str(rawCustom.hairLength),
    height: str(rawCustom.height),
    build: str(rawCustom.build),
    skinTone: str(rawCustom.skinTone),
    distinguishingFeatures: str(fm.distinguishingFeatures),
    images,
    relationships,
    customProperties,
    sections,
    chapterOverrides,
    templateId: fm.novalist_templateId ? str(fm.novalist_templateId) : undefined,
  };
}

// ── CharacterSheetData → YAML ───────────────────────────────────────

function serializeCharacterToYaml(data: CharacterSheetData): string {
  const fullName = `${data.name} ${data.surname}`.trim();

  // Build custom field map (physical attrs + user custom props)
  const custom: Record<string, string> = {};
  if (data.gender) custom.gender = data.gender;
  if (data.group) custom.group = data.group;
  if (data.eyeColor) custom.eyeColor = data.eyeColor;
  if (data.hairColor) custom.hairColor = data.hairColor;
  if (data.hairLength) custom.hairLength = data.hairLength;
  if (data.height) custom.height = data.height;
  if (data.build) custom.build = data.build;
  if (data.skinTone) custom.skinTone = data.skinTone;
  for (const [k, v] of Object.entries(data.customProperties)) {
    if (v) custom[k] = v;
  }

  // Convert relationships → SL relations format
  const relations: { category: string; type: string; target: string }[] = data.relationships.map(r => {
    const roleLower = r.role.toLowerCase().trim();
    const mapping = RELATIONSHIP_ROLE_MAP[roleLower];
    const target = r.character.replace(/\[\[|\]\]/g, '').trim();
    return {
      category: mapping?.category ?? 'other',
      type: mapping?.type ?? r.role,
      target,
    };
  });

  // Images: write SL-compat `image` (first) + full `novalist_images` array
  const allImages = data.images
    .map(i => ({ name: i.name, path: i.path.replace(/\[\[|\]\]/g, '').replace(/^!/, '').trim() }))
    .filter(i => i.path);
  const primaryImage = allImages[0]?.path
    || data.faceShot?.replace(/\[\[|\]\]/g, '').replace(/^!/, '').trim()
    || undefined;

  // Build frontmatter
  const fm: Record<string, unknown> = {
    type: 'character',
    name: fullName,
  };
  if (data.age) fm.age = data.age;
  if (data.role) fm.role = data.role;
  if (primaryImage) fm.image = primaryImage;
  if (allImages.length > 0) fm.novalist_images = allImages;
  if (data.distinguishingFeatures) fm.distinguishingFeatures = data.distinguishingFeatures;
  if (relations.length > 0) fm.relations = relations;
  if (Object.keys(custom).length > 0) fm.custom = custom;
  if (data.templateId) fm.novalist_templateId = data.templateId;

  // Chapter overrides
  if (data.chapterOverrides.length > 0) {
    fm.novalist_chapterOverrides = data.chapterOverrides.map(o => {
      const obj: Record<string, unknown> = { chapter: o.chapter };
      if (o.act) obj.act = o.act;
      if (o.scene) obj.scene = o.scene;
      if (o.name) obj.name = o.surname ? `${o.name} ${o.surname}`.trim() : o.name;
      if (o.gender) obj.gender = o.gender;
      if (o.age) obj.age = o.age;
      if (o.role) obj.role = o.role;
      if (o.eyeColor) obj.eyeColor = o.eyeColor;
      if (o.hairColor) obj.hairColor = o.hairColor;
      if (o.hairLength) obj.hairLength = o.hairLength;
      if (o.height) obj.height = o.height;
      if (o.build) obj.build = o.build;
      if (o.skinTone) obj.skinTone = o.skinTone;
      if (o.distinguishingFeatures) obj.distinguishingFeatures = o.distinguishingFeatures;
      if (o.customProperties && Object.keys(o.customProperties).length > 0) obj.customProperties = o.customProperties;
      if (o.relationships && o.relationships.length > 0) {
        obj.relationships = o.relationships.map(r => ({
          category: (RELATIONSHIP_ROLE_MAP[r.role.toLowerCase()]?.category || 'other') as CharacterRelationCategory,
          type: RELATIONSHIP_ROLE_MAP[r.role.toLowerCase()]?.type || r.role,
          target: r.character.replace(/\[\[|\]\]/g, '').trim(),
        }));
      }
      if (o.images && o.images.length > 0) obj.images = o.images;
      return obj;
    });
  }

  // Body text from sections
  const bodyParts: string[] = [];
  for (const section of data.sections) {
    bodyParts.push(`## ${section.title}\n\n${section.content}`);
  }
  const body = bodyParts.join('\n\n');

  return serializeFrontmatterAndBody(fm, body);
}

/**
 * Parse a character markdown file into structured CharacterSheetData.
 * Supports both YAML frontmatter format (new) and legacy ## CharacterSheet blocks.
 */
export function parseCharacterSheet(content: string): CharacterSheetData {
  // Detect format
  if (isYamlContent(content)) {
    const { frontmatter } = extractFrontmatterAndBody(content);
    if (frontmatter.type === 'character') {
      return parseCharacterFromYaml(content);
    }
  }

  // ── Legacy parser ─────────────────────────────────────────────────
  const normalized = content.replace(/\r\n/g, '\n');
  const data: CharacterSheetData = {
    name: '',
    surname: '',
    gender: '',
    age: '',
    role: '',
    group: '',
    faceShot: '',
    eyeColor: '',
    hairColor: '',
    hairLength: '',
    height: '',
    build: '',
    skinTone: '',
    distinguishingFeatures: '',
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
      const pattern = new RegExp(`^[ \\t]*${fieldName}:[ \\t]*(.*?)$`, 'm');
      const match = content.match(pattern);
      if (!match) return '';
      const value = match[1].trim();
      // Check if the value contains another known field name (corrupted data)
      const knownFields = ['Name:', 'Surname:', 'Gender:', 'Age:', 'Role:', 'Group:', 'FaceShot:', 'EyeColor:', 'HairColor:', 'HairLength:', 'Height:', 'Build:', 'SkinTone:', 'DistinguishingFeatures:', 'Relationships:', 'CustomProperties:', 'Sections:', 'ChapterOverrides:', 'TemplateId:'];
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
    data.group = parseField(sheetContent, 'Group');
    data.faceShot = parseField(sheetContent, 'FaceShot');
    data.eyeColor = parseField(sheetContent, 'EyeColor');
    data.hairColor = parseField(sheetContent, 'HairColor');
    data.hairLength = parseField(sheetContent, 'HairLength');
    data.height = parseField(sheetContent, 'Height');
    data.build = parseField(sheetContent, 'Build');
    data.skinTone = parseField(sheetContent, 'SkinTone');
    data.distinguishingFeatures = parseField(sheetContent, 'DistinguishingFeatures');
    data.templateId = parseField(sheetContent, 'TemplateId') || undefined;
    
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
      const chapterBlocks = chapterText.split(/^\s*Chapter:[ \t]*/m).filter(Boolean);
      
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
              case 'act': override.act = value; break;
              case 'scene': override.scene = value; break;
              case 'name': override.name = value; break;
              case 'surname': override.surname = value; break;
              case 'gender': override.gender = value; break;
              case 'age': override.age = value; break;
              case 'role': override.role = value; break;
              case 'faceshot': override.faceShot = value; break;
              case 'eyecolor': override.eyeColor = value; break;
              case 'haircolor': override.hairColor = value; break;
              case 'hairlength': override.hairLength = value; break;
              case 'height': override.height = value; break;
              case 'build': override.build = value; break;
              case 'skintone': override.skinTone = value; break;
              case 'distinguishingfeatures': override.distinguishingFeatures = value; break;
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
 * Serialize CharacterSheetData to YAML frontmatter format.
 * Always produces the new SL-compatible YAML format.
 */
export function serializeCharacterSheet(data: CharacterSheetData): string {
  return serializeCharacterToYaml(data);
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
 * Check if content contains a CharacterSheet block or YAML character frontmatter.
 */
export function hasCharacterSheet(content: string): boolean {
  if (isYamlContent(content)) {
    const { frontmatter } = extractFrontmatterAndBody(content);
    return frontmatter.type === 'character';
  }
  return /<!--\s*CharacterSheet/.test(content) || /^##\s+CharacterSheet/m.test(content);
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
  chapterName: string,
  sceneName?: string,
  chapterId?: string,
  actName?: string
): CharacterSheetData {
  const matchesChapter = (o: CharacterChapterOverride): boolean =>
    o.chapter === chapterName || (!!chapterId && o.chapter === chapterId);

  // Try scene-specific override first, then chapter-level, then act-level
  let override: CharacterChapterOverride | undefined;
  if (sceneName) {
    override = data.chapterOverrides.find(o => matchesChapter(o) && o.scene === sceneName);
  }
  if (!override) {
    override = data.chapterOverrides.find(o => matchesChapter(o) && !o.scene && !o.act);
  }
  if (!override && actName) {
    override = data.chapterOverrides.find(o => o.act === actName && !o.chapter && !o.scene);
  }
  if (!override) return data;
  
  return {
    ...data,
    name: override.name ?? data.name,
    surname: override.surname ?? data.surname,
    gender: override.gender ?? data.gender,
    age: override.age ?? data.age,
    role: override.role ?? data.role,
    faceShot: override.faceShot ?? data.faceShot,
    eyeColor: override.eyeColor ?? data.eyeColor,
    hairColor: override.hairColor ?? data.hairColor,
    hairLength: override.hairLength ?? data.hairLength,
    height: override.height ?? data.height,
    build: override.build ?? data.build,
    skinTone: override.skinTone ?? data.skinTone,
    distinguishingFeatures: override.distinguishingFeatures ?? data.distinguishingFeatures,
    relationships: override.relationships ?? data.relationships,
    customProperties: override.customProperties 
      ? { ...data.customProperties, ...override.customProperties }
      : data.customProperties
  };
}
