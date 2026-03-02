/**
 * LocationService — CRUD for location and world files with StoryLine-compatible YAML frontmatter.
 *
 * Two entity types live in the Locations/ folder:
 *   - `type: world`    — worldbuilding container (top-level)
 *   - `type: location`  — a specific place linked to a world and/or parent location
 *
 * Folders mirror the hierarchy:
 *   Locations/Eryndor.md                    ← world
 *   Locations/Eryndor/Dark Forest.md        ← location (world: Eryndor)
 */

import { TFile, type Vault } from 'obsidian';
import type { NovalistLocation, NovalistWorld } from '../types/novalist-extensions';
import {
  extractFrontmatterAndBody,
  serializeFrontmatterAndBody,
  createEntityFile,
  isoDate,
} from './FrontmatterUtils';

// ── Location CRUD ───────────────────────────────────────────────────

/**
 * Read a location file and return a NovalistLocation.
 */
export async function readLocation(vault: Vault, file: TFile): Promise<NovalistLocation> {
  const content = await vault.read(file);
  return parseLocationContent(content, file.path);
}

/**
 * Parse a location from its raw markdown content.
 */
export function parseLocationContent(content: string, filePath: string): NovalistLocation {
  const { frontmatter: fm, body } = extractFrontmatterAndBody(content);

  return {
    filePath,
    type: 'location',
    name: (fm.name as string) || filePath.split('/').pop()?.replace(/\.md$/, '') || '',
    locationType: fm.locationType as string | undefined,
    world: fm.world as string | undefined,
    parent: fm.parent as string | undefined,
    description: fm.description as string | undefined,
    atmosphere: fm.atmosphere as string | undefined,
    significance: fm.significance as string | undefined,
    inhabitants: fm.inhabitants as string | undefined,
    connectedLocations: fm.connectedLocations as string | undefined,
    mapNotes: fm.mapNotes as string | undefined,
    image: fm.image as string | undefined,
    custom: (fm.custom as Record<string, string>) || {},
    created: fm.created as string | undefined,
    modified: fm.modified as string | undefined,
    notes: body || undefined,
    // Novalist extensions
    novalist_relationships: (fm.novalist_relationships as NovalistLocation['novalist_relationships']) || undefined,
    novalist_templateId: fm.novalist_templateId as string | undefined,
  };
}

/**
 * Write a NovalistLocation back to its file.
 */
export async function writeLocation(vault: Vault, location: NovalistLocation): Promise<void> {
  const file = vault.getAbstractFileByPath(location.filePath);
  if (!(file instanceof TFile)) return;

  const { frontmatter, body } = locationToFrontmatterAndBody(location);
  const content = serializeFrontmatterAndBody(frontmatter, body);
  await vault.modify(file, content);
}

/**
 * Create a new location file.
 */
export async function createLocation(
  vault: Vault,
  locationFolder: string,
  name: string,
  options?: Partial<NovalistLocation>
): Promise<NovalistLocation> {
  // If a parent or world is specified, nest the file in a subfolder
  let folder = locationFolder;
  if (options?.parent) {
    folder = `${locationFolder}/${options.parent}`;
  } else if (options?.world) {
    folder = `${locationFolder}/${options.world}`;
  }

  const safeName = name.replace(/[\\/:*?"<>|]/g, '_');
  const filePath = `${folder}/${safeName}.md`;

  const now = isoDate();
  const location: NovalistLocation = {
    filePath,
    type: 'location',
    name,
    locationType: options?.locationType,
    world: options?.world,
    parent: options?.parent,
    description: options?.description || '',
    custom: options?.custom || {},
    created: now,
    modified: now,
    notes: options?.notes || '',
    novalist_templateId: options?.novalist_templateId,
    novalist_relationships: options?.novalist_relationships,
  };

  const { frontmatter, body } = locationToFrontmatterAndBody(location);
  const file = await createEntityFile(vault, filePath, frontmatter, body);
  location.filePath = file.path;

  return location;
}

/**
 * List all locations in a folder (recursively).
 */
export async function listLocations(vault: Vault, locationFolder: string): Promise<NovalistLocation[]> {
  const mdFiles = vault.getFiles().filter(f =>
    f.path.startsWith(locationFolder + '/') && f.extension === 'md'
  );

  const locations: NovalistLocation[] = [];
  for (const file of mdFiles) {
    try {
      const content = await vault.read(file);
      const { frontmatter } = extractFrontmatterAndBody(content);
      if (frontmatter.type === 'location') {
        locations.push(parseLocationContent(content, file.path));
      }
    } catch {
      // Skip unparseable files
    }
  }

  return locations.sort((a, b) => a.name.localeCompare(b.name));
}

// ── World CRUD ──────────────────────────────────────────────────────

/**
 * Read a world file and return a NovalistWorld.
 */
export async function readWorld(vault: Vault, file: TFile): Promise<NovalistWorld> {
  const content = await vault.read(file);
  return parseWorldContent(content, file.path);
}

/**
 * Parse a world from its raw markdown content.
 */
export function parseWorldContent(content: string, filePath: string): NovalistWorld {
  const { frontmatter: fm, body } = extractFrontmatterAndBody(content);

  return {
    filePath,
    type: 'world',
    name: (fm.name as string) || filePath.split('/').pop()?.replace(/\.md$/, '') || '',
    description: fm.description as string | undefined,
    geography: fm.geography as string | undefined,
    culture: fm.culture as string | undefined,
    politics: fm.politics as string | undefined,
    magicTechnology: fm.magicTechnology as string | undefined,
    beliefs: fm.beliefs as string | undefined,
    economy: fm.economy as string | undefined,
    history: fm.history as string | undefined,
    image: fm.image as string | undefined,
    custom: (fm.custom as Record<string, string>) || {},
    created: fm.created as string | undefined,
    modified: fm.modified as string | undefined,
    notes: body || undefined,
    novalist_templateId: fm.novalist_templateId as string | undefined,
  };
}

/**
 * Write a NovalistWorld back to its file.
 */
export async function writeWorld(vault: Vault, world: NovalistWorld): Promise<void> {
  const file = vault.getAbstractFileByPath(world.filePath);
  if (!(file instanceof TFile)) return;

  const { frontmatter, body } = worldToFrontmatterAndBody(world);
  const content = serializeFrontmatterAndBody(frontmatter, body);
  await vault.modify(file, content);
}

/**
 * Create a new world file.
 */
export async function createWorld(
  vault: Vault,
  locationFolder: string,
  name: string,
  options?: Partial<NovalistWorld>
): Promise<NovalistWorld> {
  const safeName = name.replace(/[\\/:*?"<>|]/g, '_');
  const filePath = `${locationFolder}/${safeName}.md`;

  const now = isoDate();
  const world: NovalistWorld = {
    filePath,
    type: 'world',
    name,
    description: options?.description || '',
    custom: options?.custom || {},
    created: now,
    modified: now,
    notes: options?.notes || '',
    novalist_templateId: options?.novalist_templateId,
  };

  // Also create the world's subfolder for child locations
  const worldFolder = `${locationFolder}/${safeName}`;
  if (!vault.getAbstractFileByPath(worldFolder)) {
    await vault.createFolder(worldFolder);
  }

  const { frontmatter, body } = worldToFrontmatterAndBody(world);
  const file = await createEntityFile(vault, filePath, frontmatter, body);
  world.filePath = file.path;

  return world;
}

/**
 * List all worlds in a folder.
 */
export async function listWorlds(vault: Vault, locationFolder: string): Promise<NovalistWorld[]> {
  const mdFiles = vault.getFiles().filter(f =>
    f.path.startsWith(locationFolder + '/') && f.extension === 'md'
  );

  const worlds: NovalistWorld[] = [];
  for (const file of mdFiles) {
    try {
      const content = await vault.read(file);
      const { frontmatter } = extractFrontmatterAndBody(content);
      if (frontmatter.type === 'world') {
        worlds.push(parseWorldContent(content, file.path));
      }
    } catch {
      // Skip unparseable files
    }
  }

  return worlds.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * List all locations and worlds in a folder.
 */
export async function listAllLocationEntities(vault: Vault, locationFolder: string): Promise<(NovalistLocation | NovalistWorld)[]> {
  const mdFiles = vault.getFiles().filter(f =>
    f.path.startsWith(locationFolder + '/') && f.extension === 'md'
  );

  const entities: (NovalistLocation | NovalistWorld)[] = [];
  for (const file of mdFiles) {
    try {
      const content = await vault.read(file);
      const { frontmatter } = extractFrontmatterAndBody(content);
      if (frontmatter.type === 'world') {
        entities.push(parseWorldContent(content, file.path));
      } else if (frontmatter.type === 'location') {
        entities.push(parseLocationContent(content, file.path));
      }
    } catch {
      // Skip
    }
  }

  return entities;
}

// ── Internal Helpers ────────────────────────────────────────────────

function locationToFrontmatterAndBody(location: NovalistLocation): { frontmatter: Record<string, unknown>; body: string } {
  const fm: Record<string, unknown> = {
    type: 'location',
    name: location.name,
  };

  if (location.locationType) fm.locationType = location.locationType;
  if (location.world) fm.world = location.world;
  if (location.parent) fm.parent = location.parent;
  if (location.description) fm.description = location.description;
  if (location.atmosphere) fm.atmosphere = location.atmosphere;
  if (location.significance) fm.significance = location.significance;
  if (location.inhabitants) fm.inhabitants = location.inhabitants;
  if (location.connectedLocations) fm.connectedLocations = location.connectedLocations;
  if (location.mapNotes) fm.mapNotes = location.mapNotes;
  if (location.image) fm.image = location.image;
  if (location.novalist_images && location.novalist_images.length > 0) {
    fm.novalist_images = location.novalist_images;
  }
  if (location.custom && Object.keys(location.custom).length > 0) fm.custom = location.custom;
  fm.created = location.created || isoDate();
  fm.modified = location.modified || isoDate();

  // Novalist extensions
  if (location.novalist_relationships && location.novalist_relationships.length > 0) {
    fm.novalist_relationships = location.novalist_relationships;
  }
  if (location.novalist_templateId) fm.novalist_templateId = location.novalist_templateId;

  return { frontmatter: fm, body: location.notes || '' };
}

function worldToFrontmatterAndBody(world: NovalistWorld): { frontmatter: Record<string, unknown>; body: string } {
  const fm: Record<string, unknown> = {
    type: 'world',
    name: world.name,
  };

  if (world.description) fm.description = world.description;
  if (world.geography) fm.geography = world.geography;
  if (world.culture) fm.culture = world.culture;
  if (world.politics) fm.politics = world.politics;
  if (world.magicTechnology) fm.magicTechnology = world.magicTechnology;
  if (world.beliefs) fm.beliefs = world.beliefs;
  if (world.economy) fm.economy = world.economy;
  if (world.history) fm.history = world.history;
  if (world.image) fm.image = world.image;
  if (world.custom && Object.keys(world.custom).length > 0) fm.custom = world.custom;
  fm.created = world.created || isoDate();
  fm.modified = world.modified || isoDate();

  if (world.novalist_templateId) fm.novalist_templateId = world.novalist_templateId;

  return { frontmatter: fm, body: world.notes || '' };
}
