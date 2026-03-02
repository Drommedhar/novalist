/**
 * DataService — unified facade that routes entity operations to the
 * appropriate service class.  All views, modals and utilities should
 * call DataService instead of reading/writing files directly.
 *
 * DataService also owns the concept of "current project" and resolves
 * entity-specific folder paths from the project configuration.
 */

import { TFile, type App, type Vault } from 'obsidian';
import type { NovalistScene, NovalistCharacter, NovalistLocation, NovalistWorld, NovalistItem, NovalistLore, NovalistProject } from '../types/novalist-extensions';

// Scene operations
import { readScene, writeScene, createScene, listScenes, getScenesByChapter, getScenesByAct, resequenceScenes, updateSceneStatus } from './SceneService';

// Character operations
import { readCharacter, writeCharacter, createCharacter, listCharacters } from './CharacterService';

// Location & world operations
import { readLocation, writeLocation, createLocation, listLocations, readWorld, writeWorld, createWorld, listWorlds, listAllLocationEntities } from './LocationService';

// Item operations
import { readItem, writeItem, createItem, listItems } from './ItemService';

// Lore operations
import { readLore, writeLore, createLore, listLore } from './LoreService';

// Project operations
import { readProject, writeProject, createProject, readSystemFile, writeSystemFile, readPlotGrid, writePlotGrid } from './ProjectService';

import type { SceneStatus } from '@storyline/models/Scene';
import type { PlotGridData } from '@storyline/models/PlotGridData';

// ── Project Folder Resolution ───────────────────────────────────────

export interface ProjectPaths {
  /** Root path of the project (e.g. "StoryLine/My Novel") */
  root: string;
  /** Path to the project .md file */
  projectFile: string;
  /** Scenes folder */
  scenes: string;
  /** Characters folder */
  characters: string;
  /** Locations folder */
  locations: string;
  /** Items folder (Novalist extension) */
  items: string;
  /** Lore folder (Novalist extension) */
  lore: string;
  /** Images folder */
  images: string;
  /** System folder */
  system: string;
  /** Exports folder */
  exports: string;
}

/**
 * Resolve project folder paths from a project root path.
 * Derives the standard SL-compatible folder structure.
 */
export function resolveProjectPaths(projectRoot: string, projectName: string): ProjectPaths {
  return {
    root: projectRoot,
    projectFile: `${projectRoot}.md`,
    scenes: `${projectRoot}/Scenes`,
    characters: `${projectRoot}/Characters`,
    locations: `${projectRoot}/Locations`,
    items: `${projectRoot}/Items`,
    lore: `${projectRoot}/Lore`,
    images: `${projectRoot}/Images`,
    system: `${projectRoot}/System`,
    exports: `${projectRoot}/Exports`,
  };
}

// ── DataService Class ───────────────────────────────────────────────

/**
 * Centralised data access object.  Instantiate with a Vault and the
 * active project's resolved paths.
 */
export class DataService {
  constructor(
    private app: App,
    private vault: Vault,
    private paths: ProjectPaths
  ) {}

  /** Swap active project (e.g. when user switches projects). */
  setProject(paths: ProjectPaths): void {
    this.paths = paths;
  }

  /** Return the current project paths. */
  getProjectPaths(): ProjectPaths {
    return this.paths;
  }

  // ── Project ─────────────────────────────────────────────────────

  async readProject(): Promise<NovalistProject | null> {
    const file = this.vault.getAbstractFileByPath(this.paths.projectFile);
    if (!(file instanceof TFile)) return null;
    return readProject(this.vault, file);
  }

  async writeProject(project: NovalistProject): Promise<void> {
    return writeProject(this.vault, project);
  }

  async createProject(name: string, novalistRoot: string): Promise<NovalistProject> {
    return createProject(this.vault, name, novalistRoot);
  }

  // ── Scenes ──────────────────────────────────────────────────────

  async readScene(file: TFile): Promise<NovalistScene> {
    return readScene(this.vault, file);
  }

  async writeScene(scene: NovalistScene): Promise<void> {
    return writeScene(this.vault, scene);
  }

  async createScene(title: string, options?: Partial<NovalistScene>): Promise<NovalistScene> {
    return createScene(this.vault, this.paths.scenes, title, options);
  }

  async listScenes(): Promise<NovalistScene[]> {
    return listScenes(this.vault, this.paths.scenes);
  }

  async getScenesByChapter(chapter: string | number): Promise<NovalistScene[]> {
    return getScenesByChapter(this.vault, this.paths.scenes, chapter);
  }

  async getScenesByAct(act: string | number): Promise<NovalistScene[]> {
    return getScenesByAct(this.vault, this.paths.scenes, act);
  }

  async resequenceScenes(): Promise<void> {
    return resequenceScenes(this.vault, this.paths.scenes);
  }

  async updateSceneStatus(filePath: string, status: SceneStatus): Promise<void> {
    return updateSceneStatus(this.vault, filePath, status);
  }

  // ── Characters ──────────────────────────────────────────────────

  async readCharacter(file: TFile): Promise<NovalistCharacter> {
    return readCharacter(this.vault, file);
  }

  async writeCharacter(character: NovalistCharacter): Promise<void> {
    return writeCharacter(this.vault, character);
  }

  async createCharacter(name: string, options?: Partial<NovalistCharacter>): Promise<NovalistCharacter> {
    return createCharacter(this.vault, this.paths.characters, name, options);
  }

  async listCharacters(): Promise<NovalistCharacter[]> {
    return listCharacters(this.vault, this.paths.characters);
  }

  // ── Locations ───────────────────────────────────────────────────

  async readLocation(file: TFile): Promise<NovalistLocation> {
    return readLocation(this.vault, file);
  }

  async writeLocation(location: NovalistLocation): Promise<void> {
    return writeLocation(this.vault, location);
  }

  async createLocation(name: string, options?: Partial<NovalistLocation>): Promise<NovalistLocation> {
    return createLocation(this.vault, this.paths.locations, name, options);
  }

  async listLocations(): Promise<NovalistLocation[]> {
    return listLocations(this.vault, this.paths.locations);
  }

  // ── Worlds ──────────────────────────────────────────────────────

  async readWorld(file: TFile): Promise<NovalistWorld> {
    return readWorld(this.vault, file);
  }

  async writeWorld(world: NovalistWorld): Promise<void> {
    return writeWorld(this.vault, world);
  }

  async createWorld(name: string, options?: Partial<NovalistWorld>): Promise<NovalistWorld> {
    return createWorld(this.vault, this.paths.locations, name, options);
  }

  async listWorlds(): Promise<NovalistWorld[]> {
    return listWorlds(this.vault, this.paths.locations);
  }

  async listAllLocationEntities(): Promise<(NovalistLocation | NovalistWorld)[]> {
    return listAllLocationEntities(this.vault, this.paths.locations);
  }

  // ── Items ───────────────────────────────────────────────────────

  async readItem(file: TFile): Promise<NovalistItem> {
    return readItem(this.vault, file);
  }

  async writeItem(item: NovalistItem): Promise<void> {
    return writeItem(this.vault, item);
  }

  async createItem(name: string, options?: Partial<NovalistItem>): Promise<NovalistItem> {
    return createItem(this.vault, this.paths.items, name, options);
  }

  async listItems(): Promise<NovalistItem[]> {
    return listItems(this.vault, this.paths.items);
  }

  // ── Lore ────────────────────────────────────────────────────────

  async readLore(file: TFile): Promise<NovalistLore> {
    return readLore(this.vault, file);
  }

  async writeLore(lore: NovalistLore): Promise<void> {
    return writeLore(this.vault, lore);
  }

  async createLore(name: string, options?: Partial<NovalistLore>): Promise<NovalistLore> {
    return createLore(this.vault, this.paths.lore, name, options);
  }

  async listLore(): Promise<NovalistLore[]> {
    return listLore(this.vault, this.paths.lore);
  }

  // ── System Files (Settings, PlotGrid, etc.) ─────────────────────

  async readSystemFile<T>(filename: string): Promise<T | null> {
    return readSystemFile<T>(this.vault, this.paths.system, filename);
  }

  async writeSystemFile<T>(filename: string, data: T): Promise<void> {
    return writeSystemFile<T>(this.vault, this.paths.system, filename, data);
  }

  async readPlotGrid(): Promise<PlotGridData | null> {
    return readPlotGrid(this.vault, this.paths.system);
  }

  async writePlotGrid(grid: PlotGridData): Promise<void> {
    return writePlotGrid(this.vault, this.paths.system, grid);
  }

  // ── Entity Resolution (generic) ────────────────────────────────

  /**
   * Read any entity file and return its parsed data based on its `type` frontmatter.
   * Returns `null` if the type is unknown.
   */
  async readEntity(file: TFile): Promise<NovalistScene | NovalistCharacter | NovalistLocation | NovalistWorld | NovalistItem | NovalistLore | null> {
    const content = await this.vault.read(file);
    const typeMatch = content.match(/^type:\s*(.+)$/m);
    if (!typeMatch) return null;

    const entityType = typeMatch[1].trim();
    switch (entityType) {
      case 'scene': return readScene(this.vault, file);
      case 'character': return readCharacter(this.vault, file);
      case 'location': return readLocation(this.vault, file);
      case 'world': return readWorld(this.vault, file);
      case 'item': return readItem(this.vault, file);
      case 'lore': return readLore(this.vault, file);
      default: return null;
    }
  }

  /**
   * Delete an entity file from the vault.
   */
  async deleteEntity(filePath: string): Promise<void> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await this.app.fileManager.trashFile(file);
    }
  }

  /**
   * Rename / move an entity file.
   */
  async renameEntity(oldPath: string, newPath: string): Promise<void> {
    const file = this.vault.getAbstractFileByPath(oldPath);
    if (file) {
      await this.vault.rename(file, newPath);
    }
  }
}
