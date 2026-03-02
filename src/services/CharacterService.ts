/**
 * CharacterService — CRUD for character files with StoryLine-compatible YAML frontmatter.
 *
 * Characters are stored as `.md` files in the project's Characters/ folder with
 * `type: character` frontmatter.  Physical attributes are stored in `custom` fields.
 */

import { TFile, type Vault } from 'obsidian';
import type { NovalistCharacter, NovalistChapterOverride } from '../types/novalist-extensions';
import type { CharacterRelation } from '@storyline/models/Character';
import {
  extractFrontmatterAndBody,
  serializeFrontmatterAndBody,
  createEntityFile,
  isoDate,
} from './FrontmatterUtils';

// ── Character CRUD ──────────────────────────────────────────────────

/**
 * Read a character file and return a NovalistCharacter.
 */
export async function readCharacter(vault: Vault, file: TFile): Promise<NovalistCharacter> {
  const content = await vault.read(file);
  return parseCharacterContent(content, file.path);
}

/**
 * Parse a character from its raw markdown content.
 */
export function parseCharacterContent(content: string, filePath: string): NovalistCharacter {
  const { frontmatter: fm, body } = extractFrontmatterAndBody(content);

  return {
    filePath,
    type: 'character',
    name: (fm.name as string) || filePath.split('/').pop()?.replace(/\.md$/, '') || '',
    tagline: fm.tagline as string | undefined,
    image: fm.image as string | undefined,
    nickname: fm.nickname as string | undefined,
    age: fm.age as string | undefined,
    role: fm.role as string | undefined,
    occupation: fm.occupation as string | undefined,
    residency: fm.residency as string | undefined,
    locations: fm.locations as string[] | undefined,
    family: fm.family as string | undefined,
    relations: (fm.relations as CharacterRelation[]) || [],
    appearance: fm.appearance as string | undefined,
    distinguishingFeatures: fm.distinguishingFeatures as string | undefined,
    style: fm.style as string | undefined,
    quirks: fm.quirks as string | undefined,
    personality: fm.personality as string | undefined,
    internalMotivation: fm.internalMotivation as string | undefined,
    externalMotivation: fm.externalMotivation as string | undefined,
    strengths: fm.strengths as string | undefined,
    flaws: fm.flaws as string | undefined,
    fears: fm.fears as string | undefined,
    belief: fm.belief as string | undefined,
    misbelief: fm.misbelief as string | undefined,
    formativeMemories: fm.formativeMemories as string | undefined,
    accomplishments: fm.accomplishments as string | undefined,
    secrets: fm.secrets as string | undefined,
    startingPoint: fm.startingPoint as string | undefined,
    goal: fm.goal as string | undefined,
    expectedChange: fm.expectedChange as string | undefined,
    habits: fm.habits as string | undefined,
    props: fm.props as string | undefined,
    custom: (fm.custom as Record<string, string>) || {},
    created: fm.created as string | undefined,
    modified: fm.modified as string | undefined,
    notes: body || undefined,
    // Novalist extensions
    novalist_templateId: fm.novalist_templateId as string | undefined,
    novalist_chapterOverrides: (fm.novalist_chapterOverrides as NovalistChapterOverride[]) || undefined,
  };
}

/**
 * Write a NovalistCharacter back to its file.
 */
export async function writeCharacter(vault: Vault, character: NovalistCharacter): Promise<void> {
  const file = vault.getAbstractFileByPath(character.filePath);
  if (!(file instanceof TFile)) return;

  const { frontmatter, body } = characterToFrontmatterAndBody(character);
  const content = serializeFrontmatterAndBody(frontmatter, body);
  await vault.modify(file, content);
}

/**
 * Create a new character file.
 */
export async function createCharacter(
  vault: Vault,
  characterFolder: string,
  name: string,
  options?: Partial<NovalistCharacter>
): Promise<NovalistCharacter> {
  const safeName = name.replace(/[\\/:*?"<>|]/g, '_');
  const filePath = `${characterFolder}/${safeName}.md`;

  const now = isoDate();
  const character: NovalistCharacter = {
    filePath,
    type: 'character',
    name,
    role: options?.role || '',
    age: options?.age || '',
    custom: options?.custom || {},
    relations: options?.relations || [],
    created: now,
    modified: now,
    notes: options?.notes || '',
    ...options,
    // Ensure type and filePath are correct
  };
  character.filePath = filePath;
  character.type = 'character';

  const { frontmatter, body } = characterToFrontmatterAndBody(character);
  const file = await createEntityFile(vault, filePath, frontmatter, body);
  character.filePath = file.path;

  return character;
}

/**
 * List all characters in a folder.
 */
export async function listCharacters(vault: Vault, characterFolder: string): Promise<NovalistCharacter[]> {
  const mdFiles = vault.getFiles().filter(f =>
    f.path.startsWith(characterFolder + '/') && f.extension === 'md' &&
    !f.path.substring(characterFolder.length + 1).includes('/')
  );

  const characters: NovalistCharacter[] = [];
  for (const file of mdFiles) {
    try {
      const character = await readCharacter(vault, file);
      characters.push(character);
    } catch {
      // Skip unparseable files
    }
  }

  return characters.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * List character files synchronously (just file references, no parsing).
 */
export function listCharacterFilesSync(vault: Vault, characterFolder: string): TFile[] {
  return vault.getFiles().filter(f =>
    f.path.startsWith(characterFolder + '/') && f.extension === 'md' &&
    !f.path.substring(characterFolder.length + 1).includes('/')
  );
}

// ── Internal Helpers ────────────────────────────────────────────────

function characterToFrontmatterAndBody(character: NovalistCharacter): { frontmatter: Record<string, unknown>; body: string } {
  const fm: Record<string, unknown> = {
    type: 'character',
    name: character.name,
  };

  // Core SL fields
  if (character.tagline) fm.tagline = character.tagline;
  if (character.image) fm.image = character.image;
  if (character.novalist_images && character.novalist_images.length > 0) {
    fm.novalist_images = character.novalist_images;
  }
  if (character.nickname) fm.nickname = character.nickname;
  if (character.age) fm.age = character.age;
  if (character.role) fm.role = character.role;
  if (character.occupation) fm.occupation = character.occupation;
  if (character.residency) fm.residency = character.residency;
  if (character.locations && character.locations.length > 0) fm.locations = character.locations;
  if (character.family) fm.family = character.family;
  if (character.relations && character.relations.length > 0) fm.relations = character.relations;
  if (character.appearance) fm.appearance = character.appearance;
  if (character.distinguishingFeatures) fm.distinguishingFeatures = character.distinguishingFeatures;
  if (character.style) fm.style = character.style;
  if (character.quirks) fm.quirks = character.quirks;
  if (character.personality) fm.personality = character.personality;
  if (character.internalMotivation) fm.internalMotivation = character.internalMotivation;
  if (character.externalMotivation) fm.externalMotivation = character.externalMotivation;
  if (character.strengths) fm.strengths = character.strengths;
  if (character.flaws) fm.flaws = character.flaws;
  if (character.fears) fm.fears = character.fears;
  if (character.belief) fm.belief = character.belief;
  if (character.misbelief) fm.misbelief = character.misbelief;
  if (character.formativeMemories) fm.formativeMemories = character.formativeMemories;
  if (character.accomplishments) fm.accomplishments = character.accomplishments;
  if (character.secrets) fm.secrets = character.secrets;
  if (character.startingPoint) fm.startingPoint = character.startingPoint;
  if (character.goal) fm.goal = character.goal;
  if (character.expectedChange) fm.expectedChange = character.expectedChange;
  if (character.habits) fm.habits = character.habits;
  if (character.props) fm.props = character.props;
  if (character.custom && Object.keys(character.custom).length > 0) fm.custom = character.custom;
  fm.created = character.created || isoDate();
  fm.modified = character.modified || isoDate();

  // Novalist extensions
  if (character.novalist_templateId) fm.novalist_templateId = character.novalist_templateId;
  if (character.novalist_chapterOverrides && character.novalist_chapterOverrides.length > 0) {
    fm.novalist_chapterOverrides = character.novalist_chapterOverrides;
  }

  return { frontmatter: fm, body: character.notes || '' };
}
