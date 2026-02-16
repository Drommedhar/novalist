import { type App, TFile, TFolder, type Vault } from 'obsidian';

// ─── Snapshot metadata ──────────────────────────────────────────────

export interface SnapshotInfo {
  file: TFile;
  chapterGuid: string;
  chapterName: string;
  snapshotName: string;
  createdAt: string;
}

// ─── Frontmatter helpers ────────────────────────────────────────────

/**
 * Parse snapshot-specific frontmatter fields.
 */
function parseSnapshotFrontmatter(content: string): {
  chapterGuid: string;
  chapterName: string;
  snapshotName: string;
  createdAt: string;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { chapterGuid: '', chapterName: '', snapshotName: '', createdAt: '', body: content };

  const fm = match[1];
  const body = match[2];

  const chapterGuid = fm.match(/^chapterGuid:\s*(.+)$/m)?.[1]?.trim() ?? '';
  const chapterName = fm.match(/^chapter:\s*(.+)$/m)?.[1]?.trim() ?? '';
  const snapshotName = fm.match(/^snapshot:\s*(.+)$/m)?.[1]?.trim() ?? '';
  const createdAt = fm.match(/^created:\s*(.+)$/m)?.[1]?.trim() ?? '';

  return { chapterGuid, chapterName, snapshotName, createdAt, body };
}

/**
 * Build a snapshot file with embedded frontmatter.
 */
function buildSnapshotContent(
  chapterGuid: string,
  chapterName: string,
  snapshotName: string,
  createdAt: string,
  chapterBody: string,
): string {
  return `---\nchapterGuid: ${chapterGuid}\nchapter: ${chapterName}\nsnapshot: ${snapshotName}\ncreated: ${createdAt}\n---\n${chapterBody}`;
}

/**
 * Strip YAML frontmatter from a chapter's raw content.
 */
export function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return match ? match[1] : content;
}

// ─── Path helpers ───────────────────────────────────────────────────

function getSnapshotsFolderPath(projectRoot: string): string {
  return `${projectRoot}/Snapshots`;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

function generateSnapshotFilename(
  chapterName: string,
  snapshotName: string,
  date: Date,
): string {
  const dateStr = date
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ')
    .replace(':', '-');
  return `${sanitizeFilename(chapterName)} - ${sanitizeFilename(snapshotName)} (${dateStr}).md`;
}

// ─── CRUD ───────────────────────────────────────────────────────────

/**
 * Create a new snapshot of a chapter file.
 */
export async function createSnapshot(
  vault: Vault,
  projectRoot: string,
  chapterFile: TFile,
  snapshotName: string,
  chapterGuid: string,
): Promise<TFile> {
  const folderPath = getSnapshotsFolderPath(projectRoot);

  if (!vault.getAbstractFileByPath(folderPath)) {
    await vault.createFolder(folderPath);
  }

  const chapterContent = await vault.read(chapterFile);
  const chapterBody = stripFrontmatter(chapterContent);
  const chapterName = chapterFile.basename;
  const now = new Date();
  const createdAt = now.toISOString();

  const filename = generateSnapshotFilename(chapterName, snapshotName, now);
  const filePath = `${folderPath}/${filename}`;

  const content = buildSnapshotContent(chapterGuid, chapterName, snapshotName, createdAt, chapterBody);
  return vault.create(filePath, content);
}

/**
 * List all snapshots that belong to a given chapter (matched by GUID), newest first.
 * Falls back to chapter name matching for legacy snapshots without a GUID.
 */
export async function listSnapshots(
  vault: Vault,
  projectRoot: string,
  chapterGuid: string,
  chapterName: string,
): Promise<SnapshotInfo[]> {
  const folderPath = getSnapshotsFolderPath(projectRoot);
  const folder = vault.getAbstractFileByPath(folderPath);

  if (!(folder instanceof TFolder)) return [];

  const snapshots: SnapshotInfo[] = [];

  for (const child of folder.children) {
    if (!(child instanceof TFile) || child.extension !== 'md') continue;

    const content = await vault.read(child);
    const meta = parseSnapshotFrontmatter(content);

    // Match by GUID when available, fall back to name for legacy snapshots
    const guidMatch = meta.chapterGuid && meta.chapterGuid === chapterGuid;
    const nameMatch = !meta.chapterGuid && meta.chapterName === chapterName;

    if (guidMatch || nameMatch) {
      snapshots.push({
        file: child,
        chapterGuid: meta.chapterGuid,
        chapterName: meta.chapterName,
        snapshotName: meta.snapshotName,
        createdAt: meta.createdAt,
      });
    }
  }

  snapshots.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return snapshots;
}

/**
 * Delete a snapshot file from the vault, respecting the user's deletion preference.
 */
export async function deleteSnapshot(app: App, snapshot: SnapshotInfo): Promise<void> {
  await app.fileManager.trashFile(snapshot.file);
}

/**
 * Update the stored chapter name in all snapshots that match a GUID.
 * Call this when a chapter file is renamed so the display name stays current.
 */
export async function updateSnapshotChapterName(
  vault: Vault,
  projectRoot: string,
  chapterGuid: string,
  newChapterName: string,
): Promise<void> {
  const folderPath = getSnapshotsFolderPath(projectRoot);
  const folder = vault.getAbstractFileByPath(folderPath);
  if (!(folder instanceof TFolder)) return;

  for (const child of folder.children) {
    if (!(child instanceof TFile) || child.extension !== 'md') continue;

    const content = await vault.read(child);
    const meta = parseSnapshotFrontmatter(content);

    if (meta.chapterGuid === chapterGuid && meta.chapterName !== newChapterName) {
      const updated = content.replace(
        /^chapter:\s*.+$/m,
        `chapter: ${newChapterName}`,
      );
      await vault.modify(child, updated);
    }
  }
}

/**
 * Read the body content (without frontmatter) of a snapshot.
 */
export async function getSnapshotBody(vault: Vault, snapshot: SnapshotInfo): Promise<string> {
  const content = await vault.read(snapshot.file);
  return parseSnapshotFrontmatter(content).body;
}

// ─── Line-based diff ────────────────────────────────────────────────

export interface InlineSegment {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  type: 'unchanged' | 'added' | 'removed' | 'modified';
  content: string;
  leftLineNo?: number;
  rightLineNo?: number;
  /** Original line content (for `modified` type). */
  oldContent?: string;
  /** New line content (for `modified` type). */
  newContent?: string;
  /** Inline-diff segments for the old side (for `modified` type). */
  oldSegments?: InlineSegment[];
  /** Inline-diff segments for the new side (for `modified` type). */
  newSegments?: InlineSegment[];
}

/**
 * Compute a line-level diff between two texts.
 *
 * Uses the LCS (Longest Common Subsequence) approach for texts that are
 * not excessively large, and falls back to a prefix/suffix heuristic
 * for very large documents.
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const m = oldLines.length;
  const n = newLines.length;

  // Fallback for extremely large texts (> 1 M cells in the DP table)
  if (m * n > 1_000_000) {
    return simpleDiff(oldLines, newLines);
  }

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack
  const stack: DiffLine[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({
        type: 'unchanged',
        content: oldLines[i - 1],
        leftLineNo: i,
        rightLineNo: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'added', content: newLines[j - 1], rightLineNo: j });
      j--;
    } else {
      stack.push({ type: 'removed', content: oldLines[i - 1], leftLineNo: i });
      i--;
    }
  }

  stack.reverse();
  return stack;
}

/**
 * Simplified diff for very large texts.
 * Matches common prefix/suffix and treats everything in between as changed.
 */
function simpleDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const result: DiffLine[] = [];

  // Common prefix
  let prefixLen = 0;
  while (
    prefixLen < oldLines.length &&
    prefixLen < newLines.length &&
    oldLines[prefixLen] === newLines[prefixLen]
  ) {
    result.push({
      type: 'unchanged',
      content: oldLines[prefixLen],
      leftLineNo: prefixLen + 1,
      rightLineNo: prefixLen + 1,
    });
    prefixLen++;
  }

  // Common suffix
  let suffixLen = 0;
  while (
    suffixLen < oldLines.length - prefixLen &&
    suffixLen < newLines.length - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  // Middle = changed
  for (let idx = prefixLen; idx < oldLines.length - suffixLen; idx++) {
    result.push({ type: 'removed', content: oldLines[idx], leftLineNo: idx + 1 });
  }
  for (let idx = prefixLen; idx < newLines.length - suffixLen; idx++) {
    result.push({ type: 'added', content: newLines[idx], rightLineNo: idx + 1 });
  }

  // Suffix
  for (let k = 0; k < suffixLen; k++) {
    const oi = oldLines.length - suffixLen + k;
    const ni = newLines.length - suffixLen + k;
    result.push({
      type: 'unchanged',
      content: oldLines[oi],
      leftLineNo: oi + 1,
      rightLineNo: ni + 1,
    });
  }

  return result;
}
// ─── Word-level (inline) diff ───────────────────────────────────────

/**
 * Tokenize a string into alternating word / whitespace segments
 * so that the inline diff operates on meaningful units.
 */
function tokenize(line: string): string[] {
  return line.match(/\S+|\s+/g) ?? [];
}

/**
 * Merge consecutive segments that share the same `changed` flag.
 */
function mergeSegments(segs: InlineSegment[]): InlineSegment[] {
  const merged: InlineSegment[] = [];
  for (const seg of segs) {
    const last = merged.length > 0 ? merged[merged.length - 1] : undefined;
    if (last && last.changed === seg.changed) {
      last.text += seg.text;
    } else {
      merged.push({ text: seg.text, changed: seg.changed });
    }
  }
  return merged;
}

/**
 * Compute a word-level diff between two lines, returning highlight
 * segments for both the old and new side.
 */
export function computeWordDiff(
  oldLine: string,
  newLine: string,
): { oldSegments: InlineSegment[]; newSegments: InlineSegment[] } {
  const oldTokens = tokenize(oldLine);
  const newTokens = tokenize(newLine);
  const m = oldTokens.length;
  const n = newTokens.length;

  // LCS on tokens
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldTokens[i - 1] === newTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack
  const oldStack: InlineSegment[] = [];
  const newStack: InlineSegment[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
      oldStack.push({ text: oldTokens[i - 1], changed: false });
      newStack.push({ text: newTokens[j - 1], changed: false });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      newStack.push({ text: newTokens[j - 1], changed: true });
      j--;
    } else {
      oldStack.push({ text: oldTokens[i - 1], changed: true });
      i--;
    }
  }

  oldStack.reverse();
  newStack.reverse();

  return {
    oldSegments: mergeSegments(oldStack),
    newSegments: mergeSegments(newStack),
  };
}

// ─── Refine diff: pair removed+added into modified ──────────────────

/**
 * Post-process a line-level diff to detect paired remove/add runs that
 * represent *modified* lines.  For each pair whose content is similar
 * enough (≥ 20 % common text by length) a `modified` entry with inline
 * word-level segments is produced instead of separate remove + add entries.
 */
export function refineLineDiff(diffLines: DiffLine[]): DiffLine[] {
  const result: DiffLine[] = [];
  let idx = 0;

  while (idx < diffLines.length) {
    if (diffLines[idx].type !== 'removed') {
      result.push(diffLines[idx]);
      idx++;
      continue;
    }

    // Collect consecutive removed lines
    const removedStart = idx;
    while (idx < diffLines.length && diffLines[idx].type === 'removed') idx++;

    // Collect consecutive added lines
    const addedStart = idx;
    while (idx < diffLines.length && diffLines[idx].type === 'added') idx++;

    const removedLines = diffLines.slice(removedStart, addedStart);
    const addedLines = diffLines.slice(addedStart, idx);

    // Pair as many removed ↔ added lines as possible
    const pairs = Math.min(removedLines.length, addedLines.length);
    for (let p = 0; p < pairs; p++) {
      const oldLine = removedLines[p].content;
      const newLine = addedLines[p].content;

      const { oldSegments, newSegments } = computeWordDiff(oldLine, newLine);

      // Similarity: fraction of old text that is unchanged
      const commonLen = oldSegments
        .filter((s) => !s.changed)
        .reduce((sum, s) => sum + s.text.length, 0);
      const totalLen = Math.max(oldLine.length, newLine.length, 1);

      if (commonLen / totalLen >= 0.2) {
        result.push({
          type: 'modified',
          content: oldLine,
          oldContent: oldLine,
          newContent: newLine,
          leftLineNo: removedLines[p].leftLineNo,
          rightLineNo: addedLines[p].rightLineNo,
          oldSegments,
          newSegments,
        });
      } else {
        result.push(removedLines[p]);
        result.push(addedLines[p]);
      }
    }

    // Remaining unpaired lines
    for (let p = pairs; p < removedLines.length; p++) result.push(removedLines[p]);
    for (let p = pairs; p < addedLines.length; p++) result.push(addedLines[p]);
  }

  return result;
}