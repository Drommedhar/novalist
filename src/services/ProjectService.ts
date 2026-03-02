/**
 * ProjectService — Manages StoryLine-compatible project files and System/ folder.
 *
 * A Novalist project = a `.md` project file plus a subfolder tree:
 *   <root>/<ProjectName>.md           ← project frontmatter
 *   <root>/<ProjectName>/Scenes/
 *   <root>/<ProjectName>/Characters/
 *   <root>/<ProjectName>/Locations/
 *   <root>/<ProjectName>/Items/       ← Novalist extension
 *   <root>/<ProjectName>/Lore/        ← Novalist extension
 *   <root>/<ProjectName>/Images/
 *   <root>/<ProjectName>/System/      ← per-project settings
 *   <root>/<ProjectName>/Exports/
 */

import { TFile, type Vault } from 'obsidian';
import type { NovalistProject } from '../types/novalist-extensions';
import type { PlotGridData } from '@storyline/models/PlotGridData';
import {
  extractFrontmatterAndBody,
  serializeFrontmatterAndBody,
  createEntityFile,
  isoDate,
} from './FrontmatterUtils';

// ── Project File CRUD ───────────────────────────────────────────────

/**
 * Read a StoryLine-compatible project file and return a NovalistProject.
 */
export async function readProject(vault: Vault, file: TFile): Promise<NovalistProject> {
  const content = await vault.read(file);
  const { frontmatter, body } = extractFrontmatterAndBody(content);
  const filePath = file.path;

  // Derive folder paths from project file location
  const lastSlash = filePath.lastIndexOf('/');
  const parentDir = lastSlash >= 0 ? filePath.substring(0, lastSlash) : '';
  const basename = file.basename;
  const parentName = parentDir.split('/').pop() ?? '';

  // If file sits inside a folder with the same name → new layout
  const baseFolder = (parentName === basename) ? parentDir : `${parentDir}/${basename}`;

  return {
    filePath,
    title: (frontmatter.title as string) || basename,
    created: (frontmatter.created as string) || '',
    description: body,
    sceneFolder: `${baseFolder}/Scenes`,
    characterFolder: `${baseFolder}/Characters`,
    locationFolder: `${baseFolder}/Locations`,
    definedActs: (frontmatter.definedActs as number[]) || [],
    definedChapters: (frontmatter.definedChapters as number[]) || [],
    actLabels: (frontmatter.actLabels as Record<number, string>) || {},
    chapterLabels: (frontmatter.chapterLabels as Record<number, string>) || {},
    filterPresets: (frontmatter.filterPresets as []) || [],
    corkboardPositions: (frontmatter.corkboardPositions as Record<string, { x: number; y: number; z?: number }>) || {},
    novalist_projectId: (frontmatter.novalist_projectId as string) || undefined,
    novalist_wordCountGoals: (frontmatter.novalist_wordCountGoals as NovalistProject['novalist_wordCountGoals']) || undefined,
    novalist_itemFolder: (frontmatter.novalist_itemFolder as string) || undefined,
    novalist_loreFolder: (frontmatter.novalist_loreFolder as string) || undefined,
    novalist_imageFolder: (frontmatter.novalist_imageFolder as string) || undefined,
  };
}

/**
 * Write a NovalistProject back to its markdown file.
 */
export async function writeProject(vault: Vault, project: NovalistProject): Promise<void> {
  const file = vault.getAbstractFileByPath(project.filePath);
  if (!(file instanceof TFile)) return;

  const frontmatter: Record<string, unknown> = {
    type: 'storyline',
    title: project.title,
    created: project.created,
    definedActs: project.definedActs,
    definedChapters: project.definedChapters,
    actLabels: project.actLabels,
    chapterLabels: project.chapterLabels,
    filterPresets: project.filterPresets,
    corkboardPositions: project.corkboardPositions,
  };

  // Novalist extensions
  if (project.novalist_projectId) frontmatter.novalist_projectId = project.novalist_projectId;
  if (project.novalist_wordCountGoals) frontmatter.novalist_wordCountGoals = project.novalist_wordCountGoals;
  if (project.novalist_itemFolder) frontmatter.novalist_itemFolder = project.novalist_itemFolder;
  if (project.novalist_loreFolder) frontmatter.novalist_loreFolder = project.novalist_loreFolder;
  if (project.novalist_imageFolder) frontmatter.novalist_imageFolder = project.novalist_imageFolder;

  const content = serializeFrontmatterAndBody(frontmatter, project.description);
  await vault.modify(file, content);
}

/**
 * Create a new StoryLine-compatible project file + folder structure.
 */
export async function createProject(
  vault: Vault,
  rootFolder: string,
  title: string,
  projectId: string,
  options?: {
    definedActs?: number[];
    actLabels?: Record<number, string>;
    definedChapters?: number[];
    chapterLabels?: Record<number, string>;
    dailyGoal?: number;
    projectGoal?: number;
  }
): Promise<NovalistProject> {
  const baseFolder = rootFolder ? `${rootFolder}/${title}` : title;
  const projectFilePath = `${baseFolder}/${title}.md`;

  // Create project folder structure
  const folders = [
    `${baseFolder}/Scenes`,
    `${baseFolder}/Characters`,
    `${baseFolder}/Locations`,
    `${baseFolder}/Items`,
    `${baseFolder}/Lore`,
    `${baseFolder}/Images`,
    `${baseFolder}/System`,
    `${baseFolder}/Exports`,
  ];

  for (const folder of folders) {
    if (!vault.getAbstractFileByPath(folder)) {
      try {
        await vault.createFolder(folder);
      } catch {
        // Folder may already exist (stale cache) — ignore
      }
    }
  }

  // Create project file
  const frontmatter: Record<string, unknown> = {
    type: 'storyline',
    title,
    created: isoDate(),
    definedActs: options?.definedActs || [1, 2, 3],
    definedChapters: options?.definedChapters || [],
    actLabels: options?.actLabels || {
      1: 'Act 1 — Setup',
      2: 'Act 2 — Confrontation',
      3: 'Act 3 — Resolution',
    },
    chapterLabels: options?.chapterLabels || {},
    filterPresets: [],
    corkboardPositions: {},
    novalist_projectId: projectId,
    novalist_wordCountGoals: {
      dailyGoal: options?.dailyGoal || 1000,
      projectGoal: options?.projectGoal || 50000,
    },
    novalist_itemFolder: 'Items',
    novalist_loreFolder: 'Lore',
    novalist_imageFolder: 'Images',
  };

  const file = await createEntityFile(vault, projectFilePath, frontmatter, 'Project description and notes go here.');

  return {
    filePath: file.path,
    title,
    created: frontmatter.created as string,
    description: 'Project description and notes go here.',
    sceneFolder: `${baseFolder}/Scenes`,
    characterFolder: `${baseFolder}/Characters`,
    locationFolder: `${baseFolder}/Locations`,
    definedActs: frontmatter.definedActs as number[],
    definedChapters: frontmatter.definedChapters as number[],
    actLabels: frontmatter.actLabels as Record<number, string>,
    chapterLabels: frontmatter.chapterLabels as Record<number, string>,
    filterPresets: [],
    corkboardPositions: {},
    novalist_projectId: projectId,
    novalist_wordCountGoals: frontmatter.novalist_wordCountGoals as NovalistProject['novalist_wordCountGoals'],
    novalist_itemFolder: 'Items',
    novalist_loreFolder: 'Lore',
    novalist_imageFolder: 'Images',
  };
}

// ── System Folder Management ────────────────────────────────────────

/**
 * Read a JSON file from the project's System/ folder.
 */
export async function readSystemFile<T>(vault: Vault, baseFolder: string, filename: string): Promise<T | null> {
  const filePath = `${baseFolder}/System/${filename}`;
  const file = vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return null;

  try {
    const content = await vault.read(file);
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Write a JSON file to the project's System/ folder.
 */
export async function writeSystemFile<T>(vault: Vault, baseFolder: string, filename: string, data: T): Promise<void> {
  const folderPath = `${baseFolder}/System`;
  if (!vault.getAbstractFileByPath(folderPath)) {
    try {
      await vault.createFolder(folderPath);
    } catch {
      // Folder may already exist (stale cache) — ignore
    }
  }

  const filePath = `${folderPath}/${filename}`;
  const content = JSON.stringify(data, null, 2);
  const file = vault.getAbstractFileByPath(filePath);

  if (file instanceof TFile) {
    await vault.modify(file, content);
  } else {
    await vault.create(filePath, content);
  }
}

/**
 * Read the PlotGrid data from System/plotgrid.json.
 */
export async function readPlotGrid(vault: Vault, baseFolder: string): Promise<PlotGridData | null> {
  return readSystemFile<PlotGridData>(vault, baseFolder, 'plotgrid.json');
}

/**
 * Write PlotGrid data to System/plotgrid.json.
 */
export async function writePlotGrid(vault: Vault, baseFolder: string, data: PlotGridData): Promise<void> {
  await writeSystemFile(vault, baseFolder, 'plotgrid.json', data);
}
