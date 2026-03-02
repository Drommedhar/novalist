/**
 * MigrationService — one-time migration from legacy Novalist format
 * (## Sheet blocks, per-chapter files) to StoryLine-compatible YAML
 * frontmatter format (per-scene files, YAML entities).
 *
 * Migration flow:
 *  1. detectLegacyFormat()  — checks if project uses old format
 *  2. analyseProject()      — reports what will be changed
 *  3. migrateProject()      — performs full migration with backup
 *
 * The migration is destructive (it rewrites files), but a backup is
 * created first.  Legacy parser code is retained for one major version.
 */

import { TFile, TFolder } from 'obsidian';
import type { App, Vault } from 'obsidian';
import type {
  NovalistSettings,
  ProjectData,
  ChapterStatus,
  PlotBoardData,
  CharacterSheetData,
} from '../types';
import type {
  NovalistScene,
  NovalistCharacter,
  NovalistLocation,
  NovalistItem,
  NovalistLore,
  NovalistChapterOverride,
} from '../types/novalist-extensions';
import { STATUS_MIGRATION_MAP, RELATIONSHIP_ROLE_MAP } from '../types/novalist-extensions';
import type { SceneStatus } from '@storyline/models/Scene';
import type { CharacterRelation, CharacterRelationCategory } from '@storyline/models/Character';

// Legacy parsers (read-only — kept for migration, removed in next major)
import { parseCharacterSheet } from '../utils/characterSheetUtils';
import { parseLocationSheet } from '../utils/locationSheetUtils';
import { parseItemSheet } from '../utils/itemSheetUtils';
import { parseLoreSheet } from '../utils/loreSheetUtils';

// New services
import { createScene } from './SceneService';
import { createCharacter } from './CharacterService';
import { createLocation, createWorld } from './LocationService';
import { createItem } from './ItemService';
import { createLore } from './LoreService';
import { createProject } from './ProjectService';

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Safely create a folder (and all ancestor folders) if it doesn't exist.
 * Swallows "Folder already exists" errors that Obsidian throws when
 * the metadata cache is stale.
 */
async function ensureFolder(vault: Vault, folderPath: string): Promise<void> {
  if (!folderPath || vault.getAbstractFileByPath(folderPath)) return;
  try {
    await vault.createFolder(folderPath);
  } catch {
    // Folder may already exist despite getAbstractFileByPath returning null
    // (stale cache, race condition).  Verify and re-throw if truly missing.
    if (!vault.getAbstractFileByPath(folderPath)) {
      // One more attempt after a short delay for cache to settle
      await new Promise(r => setTimeout(r, 50));
      if (!vault.getAbstractFileByPath(folderPath)) {
        await vault.createFolder(folderPath);
      }
    }
  }
}

/**
 * Create a file, or overwrite it if it already exists.
 */
async function safeCreate(vault: Vault, filePath: string, content: string): Promise<void> {
  const existing = vault.getAbstractFileByPath(filePath);
  if (existing instanceof TFile) {
    await vault.modify(existing, content);
  } else {
    try {
      await vault.create(filePath, content);
    } catch {
      // File may have appeared between check and create — try modify
      const retry = vault.getAbstractFileByPath(filePath);
      if (retry instanceof TFile) {
        await vault.modify(retry, content);
      }
    }
  }
}

// ── Types ───────────────────────────────────────────────────────────

/** Summary of what migration will do — shown to user before confirmation. */
export interface MigrationAnalysis {
  /** Number of chapter files detected. */
  chapterCount: number;
  /** Total scene count after splitting chapters. */
  sceneCount: number;
  /** Characters to convert. */
  characterCount: number;
  /** Locations to convert. */
  locationCount: number;
  /** Worlds to auto-create (top-level locations with children). */
  worldCount: number;
  /** Items to convert. */
  itemCount: number;
  /** Lore entries to convert. */
  loreCount: number;
  /** Warnings (e.g. unrecognised relationship types). */
  warnings: string[];
  /** Whether the project has a plot board to migrate. */
  hasPlotBoard: boolean;
  /** Whether the project has timeline data to migrate. */
  hasTimeline: boolean;
}

/** Progress callback emitted during migration. */
export type MigrationProgress = (step: string, current: number, total: number) => void;

/** Result of a migration run. */
export interface MigrationResult {
  success: boolean;
  /** Human-readable summary lines. */
  summary: string[];
  /** Warnings produced during migration. */
  warnings: string[];
  /** Backup folder path (for rollback). */
  backupPath: string;
  /** Errors encountered (empty on success). */
  errors: string[];
  /** New novalistRoot setting value after migration (e.g. 'StoryLine'). */
  newNovalistRoot?: string;
  /** New projectPath setting value after migration (e.g. 'MyNovel'). */
  newProjectPath?: string;
}

// ── Detection ───────────────────────────────────────────────────────

/**
 * Detect whether a project still uses the legacy Novalist format.
 * Returns `true` if any chapter with `guid` frontmatter or entity
 * with `## CharacterSheet` / `## LocationSheet` blocks is found.
 */
export async function detectLegacyFormat(
  vault: Vault,
  projectPath: string,
  chapterFolder: string,
  characterFolder: string
): Promise<boolean> {
  // Check chapters
  const chapterDir = `${projectPath}/${chapterFolder}`;
  const chapterFiles = vault.getFiles().filter(f =>
    f.path.startsWith(chapterDir + '/') && f.extension === 'md'
  );

  for (const file of chapterFiles) {
    try {
      const content = await vault.read(file);
      // Legacy chapters have `guid:` in frontmatter and no `type: scene`
      if (/^---\n[\s\S]*?guid:/m.test(content) && !/^type:\s*scene/m.test(content)) {
        return true;
      }
    } catch {
      // Skip
    }
  }

  // Check characters
  const charDir = `${projectPath}/${characterFolder}`;
  const charFiles = vault.getFiles().filter(f =>
    f.path.startsWith(charDir + '/') && f.extension === 'md'
  );

  for (const file of charFiles) {
    try {
      const content = await vault.read(file);
      if (/^## CharacterSheet\b/m.test(content)) {
        return true;
      }
    } catch {
      // Skip
    }
  }

  return false;
}

// ── Analysis ────────────────────────────────────────────────────────

/**
 * Analyse a legacy project and return a summary of what changes will
 * be made during migration.
 */
export async function analyseProject(
  vault: Vault,
  projectPath: string,
  settings: NovalistSettings,
  projectData: ProjectData | undefined
): Promise<MigrationAnalysis> {
  const analysis: MigrationAnalysis = {
    chapterCount: 0,
    sceneCount: 0,
    characterCount: 0,
    locationCount: 0,
    worldCount: 0,
    itemCount: 0,
    loreCount: 0,
    warnings: [],
    hasPlotBoard: false,
    hasTimeline: false,
  };

  const chapterDir = `${projectPath}/${settings.chapterFolder}`;
  const charDir = `${projectPath}/${settings.characterFolder}`;
  const locDir = `${projectPath}/${settings.locationFolder}`;
  const itemDir = `${projectPath}/${settings.itemFolder}`;
  const loreDir = `${projectPath}/${settings.loreFolder}`;

  // Count chapters + scenes
  const chapterFiles = vault.getFiles().filter(f =>
    f.path.startsWith(chapterDir + '/') && f.extension === 'md'
  );
  analysis.chapterCount = chapterFiles.length;

  for (const file of chapterFiles) {
    try {
      const content = await vault.read(file);
      const h2Matches = content.match(/^##\s+.+$/gm);
      analysis.sceneCount += h2Matches ? h2Matches.length : 1; // at least 1 scene per chapter
    } catch {
      analysis.sceneCount += 1;
    }
  }

  // Count characters
  analysis.characterCount = vault.getFiles().filter(f =>
    f.path.startsWith(charDir + '/') && f.extension === 'md'
  ).length;

  // Count locations
  const locFiles = vault.getFiles().filter(f =>
    f.path.startsWith(locDir + '/') && f.extension === 'md'
  );
  analysis.locationCount = locFiles.length;

  // A default world is always created when there are locations
  analysis.worldCount = locFiles.length > 0 ? 1 : 0;

  // Count items
  analysis.itemCount = vault.getFiles().filter(f =>
    f.path.startsWith(itemDir + '/') && f.extension === 'md'
  ).length;

  // Count lore
  analysis.loreCount = vault.getFiles().filter(f =>
    f.path.startsWith(loreDir + '/') && f.extension === 'md'
  ).length;

  // Check project data
  if (projectData) {
    const board = projectData.plotBoard;
    analysis.hasPlotBoard = !!(board && board.columns && board.columns.length > 0);
    analysis.hasTimeline = !!(projectData.timeline && (
      projectData.timeline.manualEvents.length > 0 ||
      projectData.timeline.categories.length > 0
    ));
  }

  // Scan for unknown relationship types
  const charFiles = vault.getFiles().filter(f =>
    f.path.startsWith(charDir + '/') && f.extension === 'md'
  );
  const unknownRoles = new Set<string>();
  for (const file of charFiles) {
    try {
      const content = await vault.read(file);
      const sheet = parseCharacterSheet(content);
      for (const rel of sheet.relationships) {
        const roleLower = rel.role.toLowerCase().trim();
        if (!RELATIONSHIP_ROLE_MAP[roleLower]) {
          unknownRoles.add(rel.role);
        }
      }
    } catch {
      // skip
    }
  }
  if (unknownRoles.size > 0) {
    analysis.warnings.push(
      `${unknownRoles.size} unrecognised relationship types will be mapped to 'other': ${[...unknownRoles].join(', ')}`
    );
  }

  return analysis;
}

// ── Migration ───────────────────────────────────────────────────────

/**
 * Perform the full migration: backup → convert chapters → convert entities →
 * create project file → migrate system data.
 */
export async function migrateProject(
  app: App,
  projectPath: string,
  projectName: string,
  settings: NovalistSettings,
  projectData: ProjectData | undefined,
  onProgress?: MigrationProgress
): Promise<MigrationResult> {
  const vault = app.vault;
  const result: MigrationResult = {
    success: false,
    summary: [],
    warnings: [],
    backupPath: '',
    errors: [],
  };

  const totalSteps = 8;
  let step = 0;
  const progress = (label: string) => {
    step++;
    onProgress?.(label, step, totalSteps);
  };

  try {
    // ── Step 1: Rename old project folder → backup ────────────────
    progress('Renaming old project folder to backup');
    const backupPath = `${projectPath}_pre_yaml_backup`;
    result.backupPath = backupPath;

    const oldFolder = vault.getAbstractFileByPath(projectPath);
    if (!(oldFolder instanceof TFolder)) {
      throw new Error(`Project folder not found: ${projectPath}`);
    }
    // If a previous backup exists, fail early
    if (vault.getAbstractFileByPath(backupPath)) {
      throw new Error(`Backup folder already exists: ${backupPath}. Remove or rename it before migrating.`);
    }
    await vault.rename(oldFolder, backupPath);

    // ── Step 2: Create new project under StoryLine root ───────────
    //
    // StoryLine expects:
    //   StoryLine/
    //     <ProjectName>/
    //       <ProjectName>.md       ← project frontmatter
    //       Scenes/
    //       Characters/
    //       ...
    //
    // If novalistRoot is already set (e.g. "StoryLine"), use it.
    // Otherwise default to the StoryLine convention: "StoryLine".
    const storyLineRoot = settings.novalistRoot || 'StoryLine';
    const targetRoot = `${storyLineRoot}/${projectName}`;
    result.newNovalistRoot = storyLineRoot;
    result.newProjectPath = projectName;

    progress('Creating target folder structure');
    await ensureFolder(vault, storyLineRoot);
    await ensureFolder(vault, targetRoot);
    const folders = ['Scenes', 'Characters', 'Locations', 'Items', 'Lore', 'Images', 'System', 'Exports'];
    for (const folder of folders) {
      await ensureFolder(vault, `${targetRoot}/${folder}`);
    }

    // ── Copy image files from backup to new project ─────────────
    const backupImageDir = `${backupPath}/${settings.imageFolder}`;
    const imageFiles = vault.getFiles().filter(f =>
      f.path.startsWith(backupImageDir + '/') &&
      !f.path.includes('/.') // skip hidden files
    );
    for (const imgFile of imageFiles) {
      try {
        const relativePath = imgFile.path.substring(backupImageDir.length); // e.g. "/foo.png"
        const destPath = `${targetRoot}/${settings.imageFolder}${relativePath}`;
        // Ensure sub-folders inside Images exist
        const destFolder = destPath.substring(0, destPath.lastIndexOf('/'));
        if (destFolder !== `${targetRoot}/${settings.imageFolder}`) {
          await ensureFolder(vault, destFolder);
        }
        await vault.copy(imgFile, destPath);
      } catch (err) {
        result.warnings.push(`Image copy failed for ${imgFile.path}: ${err}`);
      }
    }
    if (imageFiles.length > 0) {
      result.summary.push(`Copied ${imageFiles.length} image file(s)`);
    }

    // ── Step 3: Convert chapters → scenes ──────────────────────────
    progress('Converting chapters to scenes');
    const sceneFolder = `${targetRoot}/Scenes`;

    // Clean up stale files from previous migration runs
    await purgeStaleEntityFiles(app, sceneFolder);

    const chapterDir = `${backupPath}/${settings.chapterFolder}`;
    const chapterFiles = vault.getFiles()
      .filter(f => f.path.startsWith(chapterDir + '/') && f.extension === 'md')
      .sort((a, b) => {
        const fa = app.metadataCache.getFileCache(a)?.frontmatter;
        const fb = app.metadataCache.getFileCache(b)?.frontmatter;
        return (Number(fa?.order) || 0) - (Number(fb?.order) || 0);
      });

    let globalSequence = 1;
    const chapterIdMap = new Map<string, number>(); // old guid → chapter number

    // Build act name → number map from chapter order so we always get a numeric act
    const actNameToNumber = new Map<string, number>();
    const actLabelsMap: Record<number, string> = {};
    for (const cf of chapterFiles) {
      const cfCache = app.metadataCache.getFileCache(cf)?.frontmatter;
      const actStr = typeof cfCache?.act === 'string' ? cfCache.act.trim() : '';
      if (actStr && !actNameToNumber.has(actStr)) {
        const nextNum = actNameToNumber.size + 1;
        actNameToNumber.set(actStr, nextNum);
        actLabelsMap[nextNum] = actStr;
      }
    }
    const definedActNumbers = [...actNameToNumber.values()];

    for (const file of chapterFiles) {
      try {
        const content = await vault.read(file);
        const { frontmatter, body } = extractLegacyFrontmatterAndBody(content);
        const chapterGuid = (frontmatter.guid as string) || '';
        const chapterOrder = Number(frontmatter.order) || 1;
        const chapterStatus = (frontmatter.status as ChapterStatus) || 'outline';
        const chapterAct = (frontmatter.act as string) || '';
        const chapterDate = (frontmatter.date as string) || '';
        const sceneDates = (frontmatter.sceneDates as Record<string, string>) || {};

        chapterIdMap.set(chapterGuid, chapterOrder);

        // Get chapter name from H1 heading or filename
        const h1Match = body.match(/^#\s+(.+)$/m);
        const chapterName = h1Match ? h1Match[1].trim() : file.basename;

        // Split body into scenes by H2 headings
        const scenes = splitIntoScenes(body, chapterName);

        // Get overrides for this chapter from project data
        const overrides = projectData?.sceneMetadataOverrides || {};
        const mentionCache = projectData?.mentionCache?.[file.path];

        for (const sceneInfo of scenes) {
          const sceneKey = `${chapterGuid}:${sceneInfo.name}`;
          const sceneOverride = overrides[sceneKey];
          const sceneMentions = mentionCache?.scenes?.[sceneInfo.name];

          const slStatus: SceneStatus = STATUS_MIGRATION_MAP[chapterStatus] || 'draft';
          const sceneDate = sceneDates[sceneInfo.name] || chapterDate;

          const sceneOpts: Partial<NovalistScene> = {
            act: chapterAct ? actNameToNumber.get(chapterAct) : undefined,
            chapter: chapterOrder,
            sequence: globalSequence,
            status: slStatus,
            pov: sceneOverride?.pov || undefined,
            characters: sceneMentions?.characters || undefined,
            location: sceneMentions?.locations?.[0] || undefined,
            emotion: sceneOverride?.emotion || undefined,
            intensity: sceneOverride?.intensity || undefined,
            conflict: sceneOverride?.conflict || undefined,
            tags: sceneOverride?.tags || undefined,
            storyDate: sceneDate || undefined,
            novalist_chapterId: chapterGuid || undefined,
            novalist_chapterName: chapterName,
          };

          await createScene(vault, sceneFolder, sceneInfo.name, {
            ...sceneOpts,
            body: sceneInfo.body,
          } as Partial<NovalistScene>);

          globalSequence++;
        }

        result.summary.push(`Chapter "${chapterName}" → ${scenes.length} scene(s)`);
      } catch (err) {
        result.errors.push(`Failed to convert chapter ${file.path}: ${err}`);
      }
    }

    // ── Step 4: Convert characters ─────────────────────────────────
    progress('Converting characters');
    const charDir = `${backupPath}/${settings.characterFolder}`;
    const charFolder = `${targetRoot}/Characters`;

    // Clean up stale files from previous migration runs
    await purgeStaleEntityFiles(app, charFolder);

    const charFiles = vault.getFiles().filter(f =>
      f.path.startsWith(charDir + '/') && f.extension === 'md'
    );

    for (const file of charFiles) {
      try {
        const content = await vault.read(file);
        const sheet = parseCharacterSheet(content);
        const charOpts = convertCharacterSheet(sheet, result.warnings);
        await createCharacter(vault, charFolder, charOpts.name || file.basename, charOpts);
        result.summary.push(`Character "${sheet.name} ${sheet.surname}".trimmed()`);
      } catch (err) {
        result.errors.push(`Failed to convert character ${file.path}: ${err}`);
      }
    }

    // ── Step 5: Convert locations ──────────────────────────────────
    progress('Converting locations');
    const locDir = `${backupPath}/${settings.locationFolder}`;
    const locFolder = `${targetRoot}/Locations`;
    const locFiles = vault.getFiles().filter(f =>
      f.path.startsWith(locDir + '/') && f.extension === 'md'
    );

    // Clean up stale files from previous migration runs
    await purgeStaleEntityFiles(app, locFolder);

    // Always create a default world so that all locations belong to one.
    // Storyline requires locations to reside in a world for parent
    // hierarchies to work correctly.
    const defaultWorldName = projectName;
    if (locFiles.length > 0) {
      try {
        await createWorld(vault, locFolder, defaultWorldName, {
          description: '',
        });
        result.summary.push(`World "${defaultWorldName}" created as default container`);
      } catch (err) {
        result.errors.push(`Failed to create default world: ${err}`);
      }
    }

    // Create all locations, assigning them to the default world
    for (const file of locFiles) {
      try {
        const content = await vault.read(file);
        const sheet = parseLocationSheet(content);

        const parentClean = sheet.parent.replace(/\[\[|\]\]/g, '').trim();
        const locOpts: Partial<NovalistLocation> = {
          locationType: sheet.type || undefined,
          parent: parentClean || undefined,
          world: defaultWorldName,
          description: sheet.description,
          image: sheet.images?.[0]?.path?.replace(/\[\[|\]\]/g, '').replace(/^!/, '').trim() || undefined,
          novalist_images: sheet.images
            .map(i => ({ name: i.name, path: i.path.replace(/\[\[|\]\]/g, '').replace(/^!/, '').trim() }))
            .filter(i => i.path),
          custom: sheet.customProperties || {},
          notes: buildSectionsBody(sheet.sections),
          novalist_relationships: sheet.relationships?.map(r => ({
            role: r.role,
            target: r.target.replace(/\[\[|\]\]/g, '').trim(),
          })),
          novalist_templateId: sheet.templateId,
        };

        await createLocation(vault, locFolder, sheet.name, locOpts);
        result.summary.push(`Location "${sheet.name}" converted`);
      } catch (err) {
        result.errors.push(`Failed to convert location ${file.path}: ${err}`);
      }
    }

    // ── Step 6: Convert items ──────────────────────────────────────
    progress('Converting items');
    const itemDir = `${backupPath}/${settings.itemFolder}`;
    const itemFolder = `${targetRoot}/Items`;

    // Clean up stale files from previous migration runs
    await purgeStaleEntityFiles(app, itemFolder);

    const itemFiles = vault.getFiles().filter(f =>
      f.path.startsWith(itemDir + '/') && f.extension === 'md'
    );

    for (const file of itemFiles) {
      try {
        const content = await vault.read(file);
        const sheet = parseItemSheet(content);
        const itemOpts: Partial<NovalistItem> = {
          itemType: sheet.type || undefined,
          origin: sheet.origin || undefined,
          description: sheet.description || undefined,
          image: sheet.images?.[0]?.path?.replace(/\[\[|\]\]/g, '').replace(/^!/, '').trim() || undefined,
          novalist_images: sheet.images
            .map(i => ({ name: i.name, path: i.path.replace(/\[\[|\]\]/g, '').replace(/^!/, '').trim() }))
            .filter(i => i.path),
          custom: sheet.customProperties || {},
          notes: buildSectionsBody(sheet.sections),
          novalist_templateId: sheet.templateId,
        };
        await createItem(vault, itemFolder, sheet.name || file.basename, itemOpts);
        result.summary.push(`Item "${sheet.name}" converted`);
      } catch (err) {
        result.errors.push(`Failed to convert item ${file.path}: ${err}`);
      }
    }

    // ── Step 7: Convert lore ───────────────────────────────────────
    progress('Converting lore');
    const loreDirPath = `${backupPath}/${settings.loreFolder}`;
    const loreFolderTarget = `${targetRoot}/Lore`;

    // Clean up stale files from previous migration runs
    await purgeStaleEntityFiles(app, loreFolderTarget);

    const loreFiles = vault.getFiles().filter(f =>
      f.path.startsWith(loreDirPath + '/') && f.extension === 'md'
    );

    for (const file of loreFiles) {
      try {
        const content = await vault.read(file);
        const sheet = parseLoreSheet(content);
        const loreOpts: Partial<NovalistLore> = {
          loreCategory: sheet.category || undefined,
          description: sheet.description || undefined,
          image: sheet.images?.[0]?.path?.replace(/\[\[|\]\]/g, '').replace(/^!/, '').trim() || undefined,
          novalist_images: sheet.images
            .map(i => ({ name: i.name, path: i.path.replace(/\[\[|\]\]/g, '').replace(/^!/, '').trim() }))
            .filter(i => i.path),
          custom: sheet.customProperties || {},
          notes: buildSectionsBody(sheet.sections),
          novalist_templateId: sheet.templateId,
        };
        await createLore(vault, loreFolderTarget, sheet.name || file.basename, loreOpts);
        result.summary.push(`Lore "${sheet.name}" converted`);
      } catch (err) {
        result.errors.push(`Failed to convert lore ${file.path}: ${err}`);
      }
    }

    // ── Step 8: Create project file + system data ─────────────────
    progress('Creating project file and system data');
    // The project file lives at <storyLineRoot>/<ProjectName>/<ProjectName>.md
    // createProject expects (rootFolder, title, ...) → creates <rootFolder>/<title>/<title>.md
    await createProject(vault, storyLineRoot, projectName, settings.activeProjectId, {
      definedActs: definedActNumbers.length > 0 ? definedActNumbers : undefined,
      actLabels: Object.keys(actLabelsMap).length > 0 ? actLabelsMap : undefined,
    });

    // Migrate plot board → plotgrid.json
    if (projectData?.plotBoard) {
      const plotGrid = convertPlotBoard(projectData.plotBoard, chapterIdMap);
      const systemFolder = `${targetRoot}/System`;
      const plotGridFile = `${systemFolder}/plotgrid.json`;
      await ensureFolder(vault, systemFolder);
      await safeCreate(vault, plotGridFile, JSON.stringify(plotGrid, null, 2));
      result.summary.push('Plot board migrated to plotgrid.json');
    }

    // Migrate timeline
    if (projectData?.timeline) {
      const systemFolder = `${targetRoot}/System`;
      const timelineFile = `${systemFolder}/timeline.json`;
      await safeCreate(vault, timelineFile, JSON.stringify(projectData.timeline, null, 2));
      result.summary.push('Timeline data migrated');
    }

    // Migrate comment threads
    if (projectData?.commentThreads && projectData.commentThreads.length > 0) {
      const systemFolder = `${targetRoot}/System`;
      const commentsFile = `${systemFolder}/comments.json`;
      await safeCreate(vault, commentsFile, JSON.stringify(projectData.commentThreads, null, 2));
      result.summary.push(`${projectData.commentThreads.length} comment thread(s) migrated`);
    }

    // Migrate validation data
    if (projectData?.validationResult || (projectData?.dismissedFindings && projectData.dismissedFindings.length > 0)) {
      const systemFolder = `${targetRoot}/System`;
      const validationFile = `${systemFolder}/validation.json`;
      const validationData = {
        result: projectData?.validationResult || null,
        dismissed: projectData?.dismissedFindings || [],
      };
      await safeCreate(vault, validationFile, JSON.stringify(validationData, null, 2));
      result.summary.push('Validation data migrated');
    }

    // Migrate recent edits
    if (projectData?.recentEdits && projectData.recentEdits.length > 0) {
      const systemFolder = `${targetRoot}/System`;
      const trackerFile = `${systemFolder}/tracker.json`;
      await safeCreate(vault, trackerFile, JSON.stringify(projectData.recentEdits, null, 2));
      result.summary.push('Recent edit tracker migrated');
    }

    result.success = result.errors.length === 0;
    result.summary.unshift(
      result.success
        ? `Migration completed successfully! ${globalSequence - 1} scene(s) created.`
        : `Migration completed with ${result.errors.length} error(s).`
    );

  } catch (err) {
    result.errors.push(`Migration failed: ${err}`);
  }

  return result;
}

// ── Internal Helpers ────────────────────────────────────────────────

/** Split chapter body text into scenes based on ## headings. */
function splitIntoScenes(body: string, chapterName: string): { name: string; body: string }[] {
  // Remove H1 heading (chapter title)
  const withoutH1 = body.replace(/^#\s+.+\n*/m, '');
  const lines = withoutH1.split('\n');

  const scenes: { name: string; body: string }[] = [];
  let currentName = '';
  let currentLines: string[] = [];
  let hasH2 = false;

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      hasH2 = true;
      // Save previous scene
      if (currentName || currentLines.length > 0) {
        scenes.push({
          name: currentName || chapterName,
          body: currentLines.join('\n').trim(),
        });
      }
      currentName = h2Match[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Save last scene
  if (currentName || currentLines.length > 0) {
    scenes.push({
      name: currentName || chapterName,
      body: currentLines.join('\n').trim(),
    });
  }

  // If no H2 headings, whole chapter becomes one scene
  if (!hasH2 && scenes.length === 0) {
    scenes.push({
      name: chapterName,
      body: withoutH1.trim(),
    });
  }

  return scenes;
}

/** Convert a legacy CharacterSheetData to NovalistCharacter partial options. */
function convertCharacterSheet(
  sheet: CharacterSheetData,
  warnings: string[]
): Partial<NovalistCharacter> {
  const fullName = `${sheet.name} ${sheet.surname}`.trim();

  // Convert relationships
  const relations: CharacterRelation[] = [];
  for (const rel of sheet.relationships) {
    const target = rel.character.replace(/\[\[|\]\]/g, '').trim();
    const roleLower = rel.role.toLowerCase().trim();
    const mapping = RELATIONSHIP_ROLE_MAP[roleLower];

    if (mapping) {
      relations.push({
        category: mapping.category,
        type: mapping.type,
        target,
      });
    } else {
      relations.push({
        category: 'other' as CharacterRelationCategory,
        type: rel.role,
        target,
      });
      warnings.push(`Character "${fullName}": unknown relationship type "${rel.role}" mapped to 'other'`);
    }
  }

  // Build custom fields from physical attributes + existing custom props
  const custom: Record<string, string> = { ...sheet.customProperties };
  if (sheet.gender) custom.gender = sheet.gender;
  if (sheet.group) custom.group = sheet.group;
  if (sheet.eyeColor) custom.eyeColor = sheet.eyeColor;
  if (sheet.hairColor) custom.hairColor = sheet.hairColor;
  if (sheet.hairLength) custom.hairLength = sheet.hairLength;
  if (sheet.height) custom.height = sheet.height;
  if (sheet.build) custom.build = sheet.build;
  if (sheet.skinTone) custom.skinTone = sheet.skinTone;

  // Convert chapter overrides
  const novalistOverrides: NovalistChapterOverride[] = sheet.chapterOverrides.map(o => ({
    chapter: o.chapter,
    act: o.act,
    scene: o.scene,
    name: o.name ? `${o.name} ${o.surname || ''}`.trim() : undefined,
    gender: o.gender,
    age: o.age,
    role: o.role,
    eyeColor: o.eyeColor,
    hairColor: o.hairColor,
    hairLength: o.hairLength,
    height: o.height,
    build: o.build,
    skinTone: o.skinTone,
    distinguishingFeatures: o.distinguishingFeatures,
    images: o.images,
    relationships: o.relationships?.map(r => ({
      category: (RELATIONSHIP_ROLE_MAP[r.role.toLowerCase()]?.category || 'other') as CharacterRelationCategory,
      type: RELATIONSHIP_ROLE_MAP[r.role.toLowerCase()]?.type || r.role,
      target: r.character.replace(/\[\[|\]\]/g, '').trim(),
    })),
    customProperties: o.customProperties,
  }));

  return {
    name: fullName,
    age: sheet.age || undefined,
    role: sheet.role || undefined,
    image: sheet.images?.[0]?.path?.replace(/\[\[|\]\]/g, '').replace(/^!/, '').trim() || sheet.faceShot?.replace(/\[\[|\]\]/g, '').replace(/^!/, '').trim() || undefined,
    novalist_images: sheet.images
      .map(i => ({ name: i.name, path: i.path.replace(/\[\[|\]\]/g, '').replace(/^!/, '').trim() }))
      .filter(i => i.path),
    distinguishingFeatures: sheet.distinguishingFeatures || undefined,
    relations,
    custom,
    notes: buildSectionsBody(sheet.sections),
    novalist_templateId: sheet.templateId,
    novalist_chapterOverrides: novalistOverrides.length > 0 ? novalistOverrides : undefined,
  };
}

/** Build body markdown from legacy sections. */
function buildSectionsBody(sections: { title: string; content: string }[]): string {
  if (!sections || sections.length === 0) return '';
  return sections.map(s => `## ${s.title}\n\n${s.content}`).join('\n\n');
}

/**
 * Delete all existing .md files in a target entity folder (recursively).
 * Called before each migration step to remove stale files from previous runs.
 */
async function purgeStaleEntityFiles(app: App, folder: string): Promise<void> {
  const stale = app.vault.getFiles().filter(f =>
    f.path.startsWith(folder + '/') && f.extension === 'md'
  );
  for (const file of stale) {
    try {
      await app.fileManager.trashFile(file);
    } catch {
      // Ignore — file may already be gone
    }
  }
}

/** Extract legacy frontmatter (simple YAML parser for old format). */
function extractLegacyFrontmatterAndBody(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { frontmatter: {}, body: normalized };
  }

  const endIdx = normalized.indexOf('\n---', 4);
  if (endIdx === -1) {
    return { frontmatter: {}, body: normalized };
  }

  const fmBlock = normalized.substring(4, endIdx);
  const body = normalized.substring(endIdx + 4).replace(/^\n+/, '');

  const fm: Record<string, unknown> = {};
  const lines = fmBlock.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(/^(\w[\w_-]*)\s*:\s*(.*)/);
    if (!match) { i++; continue; }

    const key = match[1];
    const rawValue = match[2].trim();

    // Check for nested object (indented sub-keys)
    if (rawValue === '' && i + 1 < lines.length && /^\s+[\w"']/.test(lines[i + 1])) {
      const obj: Record<string, string> = {};
      i++;
      while (i < lines.length && /^\s+/.test(lines[i])) {
        // Match both unquoted keys (word chars) and quoted keys ("..." or '...')
        const subMatch = lines[i].match(/^\s+(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\w[\w_-]*))\s*:\s*(.*)/);
        if (subMatch) {
          // Group 1 = double-quoted key, 2 = single-quoted, 3 = bare key
          const subKey = (subMatch[1] ?? subMatch[2] ?? subMatch[3])
            .replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          obj[subKey] = subMatch[4].trim().replace(/^["']|["']$/g, '');
        }
        i++;
      }
      fm[key] = obj;
      continue;
    }

    // Remove quotes
    fm[key] = rawValue.replace(/^["']|["']$/g, '');
    i++;
  }

  return { frontmatter: fm, body };
}


/**
 * Convert Novalist PlotBoardData to SL PlotGridData format.
 * This is a best-effort conversion — the formats differ significantly.
 */
function convertPlotBoard(
  board: PlotBoardData,
  chapterIdMap: Map<string, number>
): Record<string, unknown> {
  // PlotGridData structure:
  // { columns: ColumnMeta[], rows: RowMeta[], cells: Record<rowId, Record<colId, CellData>> }
  const columns = board.columns.map((col, idx) => ({
    id: col.id,
    label: col.name,
    width: 200,
    order: idx,
  }));

  // Rows correspond to chapters/scenes
  const rows: Record<string, unknown>[] = [];
  const cells: Record<string, Record<string, unknown>> = {};

  let rowIdx = 0;
  for (const [chapterId, colData] of Object.entries(board.cells)) {
    const chapterNum = chapterIdMap.get(chapterId) || rowIdx + 1;
    const rowId = `row-${chapterNum}`;
    rows.push({
      id: rowId,
      label: `Chapter ${chapterNum}`,
      order: rowIdx,
      color: board.cardColors?.[chapterId] || '',
    });

    cells[rowId] = {};
    for (const [colId, text] of Object.entries(colData)) {
      cells[rowId][colId] = {
        text: text || '',
        color: '',
      };
    }
    rowIdx++;
  }

  return { columns, rows, cells };
}

/**
 * Back up all project files to a backup folder.
 */

