/**
 * SceneService — CRUD for scene files with StoryLine-compatible YAML frontmatter.
 *
 * Each scene is a single `.md` file in the project's Scenes/ folder:
 *   Scenes/001 - Opening.md
 *   Scenes/002 - The Chase.md
 *
 * Frontmatter uses `type: scene` with all SL Scene fields plus Novalist extensions.
 */

import { TFile, type Vault } from 'obsidian';
import type { NovalistScene } from '../types/novalist-extensions';
import type { SceneStatus } from '@storyline/models/Scene';
import {
  extractFrontmatterAndBody,
  serializeFrontmatterAndBody,
  createEntityFile,
  isoDate,
  generateId,
} from './FrontmatterUtils';

// ── Scene CRUD ──────────────────────────────────────────────────────

/**
 * Read a scene file and return a NovalistScene.
 */
export async function readScene(vault: Vault, file: TFile): Promise<NovalistScene> {
  const content = await vault.read(file);
  return parseSceneContent(content, file.path);
}

/**
 * Parse a scene from its raw markdown content.
 */
export function parseSceneContent(content: string, filePath: string): NovalistScene {
  const { frontmatter: fm, body } = extractFrontmatterAndBody(content);

  return {
    filePath,
    type: 'scene',
    title: (fm.title as string) || filePath.split('/').pop()?.replace(/\.md$/, '') || '',
    act: fm.act as number | string | undefined,
    chapter: fm.chapter as number | string | undefined,
    sequence: fm.sequence as number | undefined,
    chronologicalOrder: fm.chronologicalOrder as number | undefined,
    pov: fm.pov as string | undefined,
    characters: fm.characters as string[] | undefined,
    location: fm.location as string | undefined,
    timeline: fm.timeline as string | undefined,
    storyDate: fm.storyDate as string | undefined,
    storyTime: fm.storyTime as string | undefined,
    status: (fm.status as SceneStatus) || 'idea',
    conflict: fm.conflict as string | undefined,
    emotion: fm.emotion as string | undefined,
    intensity: fm.intensity as number | undefined,
    wordcount: fm.wordcount as number | undefined,
    target_wordcount: fm.target_wordcount as number | undefined,
    tags: fm.tags as string[] | undefined,
    setup_scenes: fm.setup_scenes as string[] | undefined,
    payoff_scenes: fm.payoff_scenes as string[] | undefined,
    created: fm.created as string | undefined,
    modified: fm.modified as string | undefined,
    body,
    notes: fm.notes as string | undefined,
    corkboardNote: fm.corkboardNote as boolean | undefined,
    corkboardNoteColor: fm.corkboardNoteColor as string | undefined,
    timeline_mode: fm.timeline_mode as NovalistScene['timeline_mode'],
    timeline_strand: fm.timeline_strand as string | undefined,
    // Novalist extensions
    novalist_chapterId: fm.novalist_chapterId as string | undefined,
    novalist_chapterName: fm.novalist_chapterName as string | undefined,
    novalist_dialogueRatio: fm.novalist_dialogueRatio as number | undefined,
    novalist_avgSentenceLength: fm.novalist_avgSentenceLength as number | undefined,
    novalist_punctuationIntensity: fm.novalist_punctuationIntensity as number | undefined,
  };
}

/**
 * Write a NovalistScene back to its file.
 */
export async function writeScene(vault: Vault, scene: NovalistScene): Promise<void> {
  const file = vault.getAbstractFileByPath(scene.filePath);
  if (!(file instanceof TFile)) return;

  const { frontmatter, body } = sceneToFrontmatterAndBody(scene);
  const content = serializeFrontmatterAndBody(frontmatter, body);
  await vault.modify(file, content);
}

/**
 * Create a new scene file in the Scenes/ folder.
 */
export async function createScene(
  vault: Vault,
  sceneFolder: string,
  title: string,
  options?: Partial<NovalistScene>
): Promise<NovalistScene> {
  // Determine sequence number from existing files
  const existingScenes = await listScenes(vault, sceneFolder);
  const maxSeq = existingScenes.reduce((max, s) => Math.max(max, s.sequence || 0), 0);
  const sequence = (options?.sequence !== undefined) ? options.sequence : maxSeq + 1;

  // Generate filename
  const seqStr = String(sequence).padStart(3, '0');
  const safeName = title.replace(/[\\/:*?"<>|]/g, '_');
  const fileName = `${seqStr} - ${safeName}.md`;
  const filePath = `${sceneFolder}/${fileName}`;

  const now = isoDate();
  const scene: NovalistScene = {
    filePath,
    type: 'scene',
    title,
    act: options?.act,
    chapter: options?.chapter,
    sequence,
    chronologicalOrder: options?.chronologicalOrder ?? sequence,
    pov: options?.pov || '',
    characters: options?.characters || [],
    location: options?.location || '',
    status: options?.status || 'idea',
    conflict: options?.conflict || '',
    emotion: options?.emotion || '',
    intensity: options?.intensity,
    tags: options?.tags || [],
    storyDate: options?.storyDate,
    storyTime: options?.storyTime,
    created: now,
    modified: now,
    body: options?.body || '',
    notes: options?.notes || '',
    timeline_mode: options?.timeline_mode,
    timeline_strand: options?.timeline_strand,
    novalist_chapterId: options?.novalist_chapterId,
    novalist_chapterName: options?.novalist_chapterName,
  };

  const { frontmatter, body } = sceneToFrontmatterAndBody(scene);
  const file = await createEntityFile(vault, filePath, frontmatter, body);
  scene.filePath = file.path;

  return scene;
}

/**
 * List all scenes in a Scenes/ folder, sorted by sequence.
 */
export async function listScenes(vault: Vault, sceneFolder: string): Promise<NovalistScene[]> {
  const mdFiles = vault.getFiles().filter(f =>
    f.path.startsWith(sceneFolder + '/') && f.extension === 'md' &&
    !f.path.substring(sceneFolder.length + 1).includes('/')
  );

  const scenes: NovalistScene[] = [];
  for (const file of mdFiles) {
    try {
      const scene = await readScene(vault, file);
      scenes.push(scene);
    } catch {
      // Skip files that can't be parsed
    }
  }

  return scenes.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
}

/**
 * List all scenes synchronously using metadata cache (placeholder for future optimization).
 * Currently falls back to vault file listing with minimal parsing.
 */
export function listSceneFilesSync(vault: Vault, sceneFolder: string): TFile[] {
  return vault.getFiles().filter(f =>
    f.path.startsWith(sceneFolder + '/') && f.extension === 'md' &&
    !f.path.substring(sceneFolder.length + 1).includes('/')
  );
}

/**
 * Get scenes grouped by their `chapter` frontmatter field.
 */
export async function getScenesByChapter(vault: Vault, sceneFolder: string, chapter: string | number): Promise<NovalistScene[]> {
  const scenes = await listScenes(vault, sceneFolder);
  return scenes.filter(s => s.chapter === chapter);
}

/**
 * Get scenes grouped by their `act` frontmatter field.
 */
export async function getScenesByAct(vault: Vault, sceneFolder: string, act: string | number): Promise<NovalistScene[]> {
  const scenes = await listScenes(vault, sceneFolder);
  return scenes.filter(s => s.act === act);
}

/**
 * Resequence all scenes in order, updating their sequence numbers and filenames.
 */
export async function resequenceScenes(vault: Vault, sceneFolder: string, orderedPaths?: string[]): Promise<void> {
  const paths = orderedPaths || (await listScenes(vault, sceneFolder)).map(s => s.filePath);
  for (let i = 0; i < paths.length; i++) {
    const file = vault.getAbstractFileByPath(paths[i]);
    if (!(file instanceof TFile)) continue;

    const scene = await readScene(vault, file);
    scene.sequence = i + 1;
    scene.modified = isoDate();
    await writeScene(vault, scene);
  }
}

/**
 * Update a scene's status.
 */
export async function updateSceneStatus(vault: Vault, filePath: string, status: SceneStatus): Promise<void> {
  const file = vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return;

  const scene = await readScene(vault, file);
  scene.status = status;
  scene.modified = isoDate();
  await writeScene(vault, scene);
}

// ── Internal Helpers ────────────────────────────────────────────────

function sceneToFrontmatterAndBody(scene: NovalistScene): { frontmatter: Record<string, unknown>; body: string } {
  const fm: Record<string, unknown> = {
    type: 'scene',
    title: scene.title,
  };

  // Core SL fields — only include if set
  if (scene.act !== undefined) fm.act = scene.act;
  if (scene.chapter !== undefined) fm.chapter = scene.chapter;
  if (scene.sequence !== undefined) fm.sequence = scene.sequence;
  if (scene.chronologicalOrder !== undefined) fm.chronologicalOrder = scene.chronologicalOrder;
  if (scene.pov) fm.pov = scene.pov;
  if (scene.characters && scene.characters.length > 0) fm.characters = scene.characters;
  if (scene.location) fm.location = scene.location;
  if (scene.storyDate) fm.storyDate = scene.storyDate;
  if (scene.storyTime) fm.storyTime = scene.storyTime;
  if (scene.status) fm.status = scene.status;
  if (scene.conflict) fm.conflict = scene.conflict;
  if (scene.emotion) fm.emotion = scene.emotion;
  if (scene.intensity !== undefined) fm.intensity = scene.intensity;
  if (scene.wordcount !== undefined) fm.wordcount = scene.wordcount;
  if (scene.target_wordcount !== undefined) fm.target_wordcount = scene.target_wordcount;
  if (scene.tags && scene.tags.length > 0) fm.tags = scene.tags;
  if (scene.setup_scenes && scene.setup_scenes.length > 0) fm.setup_scenes = scene.setup_scenes;
  if (scene.payoff_scenes && scene.payoff_scenes.length > 0) fm.payoff_scenes = scene.payoff_scenes;
  if (scene.notes) fm.notes = scene.notes;
  if (scene.corkboardNote) fm.corkboardNote = scene.corkboardNote;
  if (scene.corkboardNoteColor) fm.corkboardNoteColor = scene.corkboardNoteColor;
  if (scene.timeline_mode) fm.timeline_mode = scene.timeline_mode;
  if (scene.timeline_strand) fm.timeline_strand = scene.timeline_strand;
  fm.created = scene.created || isoDate();
  fm.modified = scene.modified || isoDate();

  // Novalist extensions
  if (scene.novalist_chapterId) fm.novalist_chapterId = scene.novalist_chapterId;
  if (scene.novalist_chapterName) fm.novalist_chapterName = scene.novalist_chapterName;
  if (scene.novalist_dialogueRatio !== undefined) fm.novalist_dialogueRatio = scene.novalist_dialogueRatio;
  if (scene.novalist_avgSentenceLength !== undefined) fm.novalist_avgSentenceLength = scene.novalist_avgSentenceLength;
  if (scene.novalist_punctuationIntensity !== undefined) fm.novalist_punctuationIntensity = scene.novalist_punctuationIntensity;

  return { frontmatter: fm, body: scene.body || '' };
}

// Re-export generateId for use in other services
export { generateId, isoDate };
