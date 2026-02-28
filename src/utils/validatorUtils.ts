/**
 * validatorUtils.ts
 *
 * Plot validation rule engine.
 * Analyses chapter/scene data and produces ValidatorFinding records.
 * All rules are deterministic and rely solely on project data — no AI required.
 */

import type {
  ValidatorFinding,
  ValidatorSeverity,
  ValidatorCategory,
  ValidationResult,
  SceneMetadataCache,
  MentionCacheEntry,
  ChapterStatus,
  WholeStoryAnalysisResult,
  DismissedFinding,
} from '../types';
import { t } from '../i18n';

// ─── Types used internally ───────────────────────────────────────────

interface ChapterInfo {
  id: string;
  name: string;
  order: number;
  status: ChapterStatus;
  act: string;
  date: string;
  filePath: string;
  scenes: string[];
}

export interface ValidatorInput {
  chapters: ChapterInfo[];
  sceneMetadataCache: Record<string, SceneMetadataCache>;
  mentionCache: Record<string, MentionCacheEntry>;
  dismissedFindings: DismissedFinding[];
  wholeStoryAnalysis?: WholeStoryAnalysisResult;
  characterWordCounts?: Record<string, { totalScenes: number; chapterPaths: string[] }>;
}

// ─── Fingerprint Helper ──────────────────────────────────────────────

function makeFingerprint(...parts: string[]): string {
  return parts.join('|');
}

function buildFinding(
  ruleId: string,
  category: ValidatorCategory,
  severity: ValidatorSeverity,
  title: string,
  description: string,
  filePath?: string,
  sceneName?: string,
  entities?: string[],
  fingerprintExtra?: string,
): ValidatorFinding {
  const fp = makeFingerprint(
    ruleId,
    filePath ?? '',
    sceneName ?? '',
    ...(entities ?? []),
    fingerprintExtra ?? '',
  );
  return { ruleId, category, severity, title, description, filePath, sceneName, entities, fingerprint: fp };
}

// ─── Rule Categories ─────────────────────────────────────────────────

// ── Timeline Rules ────────────────────────────────────────────────

function checkTimeline(chapters: ChapterInfo[]): ValidatorFinding[] {
  const findings: ValidatorFinding[] = [];
  const chaptersWithDates = chapters.filter(c => c.date);

  // timeline.missingDate — info for each chapter without a date
  for (const ch of chapters) {
    if (!ch.date) {
      findings.push(buildFinding(
        'timeline.missingDate',
        'timeline',
        'info',
        t('validator.timeline.missingDate.title', { chapter: ch.name }),
        t('validator.timeline.missingDate.desc', { chapter: ch.name }),
        ch.filePath,
      ));
    }
  }

  if (chaptersWithDates.length < 2) return findings;

  // Parse dates to sortable values
  type ChapterWithDate = ChapterInfo & { parsedDate: Date };
  const parsedDates = chaptersWithDates.map(c => ({
    ...c,
    parsedDate: parseDateLoose(c.date),
  })).filter((c): c is ChapterWithDate => c.parsedDate !== null);

  // timeline.dateOrder — chapters whose date is before the prior chapter's date
  for (let i = 1; i < parsedDates.length; i++) {
    const prev = parsedDates[i - 1];
    const curr = parsedDates[i];
    if (curr.parsedDate < prev.parsedDate) {
      findings.push(buildFinding(
        'timeline.dateOrder',
        'timeline',
        'warning',
        t('validator.timeline.dateOrder.title', { chapter: curr.name }),
        t('validator.timeline.dateOrder.desc', { chapter: curr.name, date: curr.date, prevChapter: prev.name, prevDate: prev.date }),
        curr.filePath,
        undefined,
        undefined,
        curr.date + prev.date,
      ));
    }
  }

  // timeline.dateGap — large gap (>90 days) between consecutive dated chapters
  for (let i = 1; i < parsedDates.length; i++) {
    const prev = parsedDates[i - 1];
    const curr = parsedDates[i];
    const diffDays = (curr.parsedDate.getTime() - prev.parsedDate.getTime()) / 86400000;
    if (diffDays > 90) {
      findings.push(buildFinding(
        'timeline.dateGap',
        'timeline',
        'warning',
        t('validator.timeline.dateGap.title', { chapter: curr.name }),
        t('validator.timeline.dateGap.desc', { chapter: curr.name, days: Math.round(diffDays).toString(), prevChapter: prev.name }),
        curr.filePath,
        undefined,
        undefined,
        `${prev.date}_${curr.date}`,
      ));
    }
  }

  // timeline.duplicateDate — multiple chapters share the same date
  const dateGroups = new Map<string, ChapterInfo[]>();
  for (const c of chaptersWithDates) {
    const key = c.date.trim();
    let dateGroup = dateGroups.get(key);
    if (!dateGroup) { dateGroup = []; dateGroups.set(key, dateGroup); }
    dateGroup.push(c);
  }
  for (const [date, group] of dateGroups.entries()) {
    if (group.length > 1) {
      findings.push(buildFinding(
        'timeline.duplicateDate',
        'timeline',
        'info',
        t('validator.timeline.duplicateDate.title', { date }),
        t('validator.timeline.duplicateDate.desc', { date, chapters: group.map(c => c.name).join(', ') }),
        group[0].filePath,
        undefined,
        group.map(c => c.name),
        date,
      ));
    }
  }

  return findings;
}

// ── Character Rules ───────────────────────────────────────────────

function checkCharacters(
  chapters: ChapterInfo[],
  mentionCache: Record<string, MentionCacheEntry>,
  sceneMetadataCache: Record<string, SceneMetadataCache>,
): ValidatorFinding[] {
  const findings: ValidatorFinding[] = [];
  if (chapters.length === 0) return findings;

  // Build per-character scene appearance list (sorted by chapter order)
  const charAppearances = new Map<string, Array<{ chapterOrder: number; filePath: string; chapterName: string; sceneName: string }>>();

  for (const ch of chapters) {
    const entry = mentionCache[ch.filePath];
    if (!entry) continue;

    // Per-scene appearances
    for (const [sceneName, scene] of Object.entries(entry.scenes)) {
      for (const charName of scene.characters) {
        let sceneArr = charAppearances.get(charName);
        if (!sceneArr) { sceneArr = []; charAppearances.set(charName, sceneArr); }
        sceneArr.push({ chapterOrder: ch.order, filePath: ch.filePath, chapterName: ch.name, sceneName });
      }
    }
    // Chapter-level fallback for chapters without scenes
    if (Object.keys(entry.scenes).length === 0) {
      for (const charName of entry.chapter.characters) {
        let chapArr = charAppearances.get(charName);
        if (!chapArr) { chapArr = []; charAppearances.set(charName, chapArr); }
        chapArr.push({ chapterOrder: ch.order, filePath: ch.filePath, chapterName: ch.name, sceneName: '' });
      }
    }
  }

  const totalChapters = chapters.length;

  for (const [charName, appearances] of charAppearances.entries()) {
    // character.orphan — only in a single scene
    const uniqueScenes = new Set(appearances.map(a => `${a.filePath}:${a.sceneName}`));
    if (uniqueScenes.size === 1) {
      const first = appearances[0];
      findings.push(buildFinding(
        'character.orphan',
        'characters',
        'warning',
        t('validator.character.orphan.title', { name: charName }),
        t('validator.character.orphan.desc', { name: charName, chapter: first.chapterName, scene: first.sceneName }),
        first.filePath,
        first.sceneName || undefined,
        [charName],
      ));
    }

    // character.abruptIntro — first appearance past 30% of the story
    const sortedAppearances = [...appearances].sort((a, b) => a.chapterOrder - b.chapterOrder);
    const firstAppearanceOrder = sortedAppearances[0].chapterOrder;
    const thirtyPctOrder = chapters[Math.floor(totalChapters * 0.3)]?.order ?? Infinity;
    if (firstAppearanceOrder > thirtyPctOrder && totalChapters >= 5) {
      findings.push(buildFinding(
        'character.abruptIntro',
        'characters',
        'warning',
        t('validator.character.abruptIntro.title', { name: charName }),
        t('validator.character.abruptIntro.desc', { name: charName, chapter: sortedAppearances[0].chapterName }),
        sortedAppearances[0].filePath,
        undefined,
        [charName],
      ));
    }

    // character.longAbsence — disappears for >40% then reappears
    if (appearances.length >= 2 && totalChapters >= 5) {
      const chapterOrders = [...new Set(appearances.map(a => a.chapterOrder))].sort((a, b) => a - b);
      const maxOrder = chapters[chapters.length - 1]?.order ?? 1;
      for (let i = 0; i < chapterOrders.length - 1; i++) {
        const gapStart = chapterOrders[i];
        const gapEnd = chapterOrders[i + 1];
        const gapFraction = (gapEnd - gapStart) / maxOrder;
        if (gapFraction > 0.40) {
          const startChapter = chapters.find(c => c.order === gapStart);
          const endChapter = chapters.find(c => c.order === gapEnd);
          findings.push(buildFinding(
            'character.longAbsence',
            'characters',
            'warning',
            t('validator.character.longAbsence.title', { name: charName }),
            t('validator.character.longAbsence.desc', {
              name: charName,
              pct: Math.round(gapFraction * 100).toString(),
              chapterFrom: startChapter?.name ?? '',
              chapterTo: endChapter?.name ?? '',
            }),
            startChapter?.filePath,
            undefined,
            [charName],
            `${gapStart}_${gapEnd}`,
          ));
        }
      }
    }

    // character.noPov — character mentioned prominently but never set as POV
    const povScenes = Object.values(sceneMetadataCache).flatMap(cache =>
      Object.values(cache.scenes).filter(s => s.pov.value === charName),
    );
    const sceneCount = uniqueScenes.size;
    if (sceneCount >= 5 && povScenes.length === 0) {
      findings.push(buildFinding(
        'character.noPov',
        'characters',
        'info',
        t('validator.character.noPov.title', { name: charName }),
        t('validator.character.noPov.desc', { name: charName, count: sceneCount.toString() }),
        undefined,
        undefined,
        [charName],
      ));
    }
  }

  return findings;
}

// ── Plotline Rules ────────────────────────────────────────────────

function checkPlotlines(
  chapters: ChapterInfo[],
  sceneMetadataCache: Record<string, SceneMetadataCache>,
): ValidatorFinding[] {
  const findings: ValidatorFinding[] = [];
  if (chapters.length < 4) return findings;

  // Build tag → chapter orders map
  const tagOrders = new Map<string, number[]>();
  for (const ch of chapters) {
    const cache = sceneMetadataCache[ch.filePath];
    if (!cache) continue;
    for (const scene of Object.values(cache.scenes)) {
      for (const tag of scene.tags.value) {
        let tagArr = tagOrders.get(tag);
        if (!tagArr) { tagArr = []; tagOrders.set(tag, tagArr); }
        tagArr.push(ch.order);
      }
    }
  }

  if (tagOrders.size === 0) return findings;

  const maxOrder = chapters[chapters.length - 1]?.order ?? 1;
  const totalSceneCount = Object.values(sceneMetadataCache).reduce(
    (n, c) => n + Object.keys(c.scenes).length, 0,
  );

  for (const [tag, orders] of tagOrders.entries()) {
    if (orders.length < 2) continue;
    const sortedOrders = [...new Set(orders)].sort((a, b) => a - b);
    const firstOrder = sortedOrders[0];
    const lastOrder = sortedOrders[sortedOrders.length - 1];

    // plotline.abandoned — used in first half but not last 30%
    const cutoffOrder = chapters[Math.floor(chapters.length * 0.70)]?.order ?? maxOrder;
    if (firstOrder <= cutoffOrder && lastOrder < cutoffOrder) {
      findings.push(buildFinding(
        'plotline.abandoned',
        'plotlines',
        'warning',
        t('validator.plotline.abandoned.title', { tag }),
        t('validator.plotline.abandoned.desc', { tag }),
        undefined,
        undefined,
        [tag],
      ));
    }

    // plotline.lateIntro — first appears in last 20%
    const lateThreshold = chapters[Math.floor(chapters.length * 0.80)]?.order ?? maxOrder;
    if (firstOrder >= lateThreshold) {
      findings.push(buildFinding(
        'plotline.lateIntro',
        'plotlines',
        'info',
        t('validator.plotline.lateIntro.title', { tag }),
        t('validator.plotline.lateIntro.desc', { tag }),
        undefined,
        undefined,
        [tag],
      ));
    }
  }

  // plotline.unbalanced — one tag >60% of tagged scenes
  if (tagOrders.size > 1 && totalSceneCount > 0) {
    for (const [tag, orders] of tagOrders.entries()) {
      const pct = orders.length / totalSceneCount;
      if (pct > 0.60) {
        findings.push(buildFinding(
          'plotline.unbalanced',
          'plotlines',
          'warning',
          t('validator.plotline.unbalanced.title', { tag }),
          t('validator.plotline.unbalanced.desc', { tag, pct: Math.round(pct * 100).toString() }),
          undefined,
          undefined,
          [tag],
        ));
      }
    }
  }

  return findings;
}

// ── Structure Rules ───────────────────────────────────────────────

function checkStructure(
  chapters: ChapterInfo[],
  sceneMetadataCache: Record<string, SceneMetadataCache>,
): ValidatorFinding[] {
  const findings: ValidatorFinding[] = [];
  if (chapters.length === 0) return findings;

  // Collect chapter word counts from scene metadata
  const chapterWordCounts: number[] = [];
  for (const ch of chapters) {
    const cache = sceneMetadataCache[ch.filePath];
    const total = cache?.chapterAggregate.totalWordCount ?? 0;
    chapterWordCounts.push(total);
  }
  const nonZeroCounts = chapterWordCounts.filter(c => c > 0);
  const avgChapterWords = nonZeroCounts.length > 0
    ? nonZeroCounts.reduce((a, b) => a + b, 0) / nonZeroCounts.length
    : 0;

  const actWordCounts = new Map<string, number>();

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const cache = sceneMetadataCache[ch.filePath];

    // structure.noAct
    if (!ch.act) {
      findings.push(buildFinding(
        'structure.noAct',
        'structure',
        'info',
        t('validator.structure.noAct.title', { chapter: ch.name }),
        t('validator.structure.noAct.desc', { chapter: ch.name }),
        ch.filePath,
      ));
    } else {
      const wc = cache?.chapterAggregate.totalWordCount ?? 0;
      actWordCounts.set(ch.act, (actWordCounts.get(ch.act) ?? 0) + wc);
    }

    // structure.singleScene
    if (ch.scenes.length === 0) {
      findings.push(buildFinding(
        'structure.singleScene',
        'structure',
        'info',
        t('validator.structure.singleScene.title', { chapter: ch.name }),
        t('validator.structure.singleScene.desc', { chapter: ch.name }),
        ch.filePath,
      ));
    }

    // structure.tooManyScenes
    if (ch.scenes.length > 15) {
      findings.push(buildFinding(
        'structure.tooManyScenes',
        'structure',
        'info',
        t('validator.structure.tooManyScenes.title', { chapter: ch.name }),
        t('validator.structure.tooManyScenes.desc', { chapter: ch.name, count: ch.scenes.length.toString() }),
        ch.filePath,
      ));
    }

    // Per-scene checks
    if (cache) {
      for (const [sceneName, scene] of Object.entries(cache.scenes)) {
        // structure.emptyScene
        if (scene.wordCount < 20) {
          findings.push(buildFinding(
            'structure.emptyScene',
            'structure',
            'warning',
            t('validator.structure.emptyScene.title', { scene: sceneName, chapter: ch.name }),
            t('validator.structure.emptyScene.desc', { scene: sceneName, chapter: ch.name, words: scene.wordCount.toString() }),
            ch.filePath,
            sceneName,
          ));
        }

        // structure.untitledScene
        if (/^(scene\s*\d*|untitled|unnamed|new scene)$/i.test(sceneName.trim())) {
          findings.push(buildFinding(
            'structure.untitledScene',
            'structure',
            'info',
            t('validator.structure.untitledScene.title', { scene: sceneName, chapter: ch.name }),
            t('validator.structure.untitledScene.desc', { scene: sceneName, chapter: ch.name }),
            ch.filePath,
            sceneName,
          ));
        }
      }
    }

    // structure.chapterImbalance — more than 3× average word count
    const chapterWc = chapterWordCounts[i];
    if (avgChapterWords > 0 && chapterWc > avgChapterWords * 3 && chapterWc > 500) {
      findings.push(buildFinding(
        'structure.chapterImbalance',
        'structure',
        'warning',
        t('validator.structure.chapterImbalance.title', { chapter: ch.name }),
        t('validator.structure.chapterImbalance.desc', { chapter: ch.name, words: chapterWc.toLocaleString(), avg: Math.round(avgChapterWords).toLocaleString() }),
        ch.filePath,
        undefined,
        undefined,
        chapterWc.toString(),
      ));
    }
  }

  // structure.actImbalance — one act has 3× words of another
  if (actWordCounts.size > 1) {
    const actValues = [...actWordCounts.entries()].filter(([, v]) => v > 0);
    const maxAct = actValues.reduce((a, b) => b[1] > a[1] ? b : a);
    const minAct = actValues.reduce((a, b) => b[1] < a[1] ? b : a);
    if (maxAct[1] > minAct[1] * 3) {
      findings.push(buildFinding(
        'structure.actImbalance',
        'structure',
        'warning',
        t('validator.structure.actImbalance.title', { act: maxAct[0] }),
        t('validator.structure.actImbalance.desc', { act: maxAct[0], words: maxAct[1].toLocaleString(), minAct: minAct[0], minWords: minAct[1].toLocaleString() }),
        undefined,
        undefined,
        undefined,
        `${maxAct[0]}_${minAct[0]}`,
      ));
    }
  }

  // structure.statusRegression — outline chapters after final chapters
  const finalChapters = chapters.filter(c => c.status === 'final');
  if (finalChapters.length > 0) {
    const lastFinalOrder = Math.max(...finalChapters.map(c => c.order));
    for (const ch of chapters) {
      if (ch.order < lastFinalOrder && ch.status === 'outline') {
        findings.push(buildFinding(
          'structure.statusRegression',
          'structure',
          'warning',
          t('validator.structure.statusRegression.title', { chapter: ch.name }),
          t('validator.structure.statusRegression.desc', { chapter: ch.name }),
          ch.filePath,
          undefined,
          undefined,
          `${ch.id}_${lastFinalOrder}`,
        ));
      }
    }
  }

  return findings;
}

// ── Continuity Rules ───────────────────────────────────────────────

function checkContinuity(
  chapters: ChapterInfo[],
  mentionCache: Record<string, MentionCacheEntry>,
): ValidatorFinding[] {
  const findings: ValidatorFinding[] = [];

  // continuity.deadCharacterAppears — detect "Status: Deceased" custom property
  // then check if character appears in later chapters (best-effort, no structured data)
  // This requires AI and is more of a placeholder for when AI findings are integrated.
  // We do add AI inconsistency findings below in the integration helper.

  void chapters;
  void mentionCache;

  return findings;
}

// ── Pacing Rules ──────────────────────────────────────────────────

function checkPacing(
  chapters: ChapterInfo[],
  sceneMetadataCache: Record<string, SceneMetadataCache>,
): ValidatorFinding[] {
  const findings: ValidatorFinding[] = [];

  // Collect all scenes in reading order
  interface OrderedScene {
    chapterOrder: number;
    chapterName: string;
    filePath: string;
    sceneName: string;
    intensity: number;
    emotion: string;
    dialogueRatio: number;
  }
  const allScenes: OrderedScene[] = [];

  for (const ch of chapters) {
    const cache = sceneMetadataCache[ch.filePath];
    if (!cache) continue;
    for (const [sceneName, scene] of Object.entries(cache.scenes)) {
      allScenes.push({
        chapterOrder: ch.order,
        chapterName: ch.name,
        filePath: ch.filePath,
        sceneName,
        intensity: scene.intensity.value,
        emotion: scene.emotion.value,
        dialogueRatio: scene.dialogueRatio,
      });
    }
  }

  if (allScenes.length < 3) return findings;

  // pacing.intensityDrop — drop ≥6 between consecutive scenes
  for (let i = 1; i < allScenes.length; i++) {
    const prev = allScenes[i - 1];
    const curr = allScenes[i];
    const drop = prev.intensity - curr.intensity;
    if (drop >= 6) {
      findings.push(buildFinding(
        'pacing.intensityDrop',
        'pacing',
        'warning',
        t('validator.pacing.intensityDrop.title', { scene: curr.sceneName }),
        t('validator.pacing.intensityDrop.desc', {
          prevScene: prev.sceneName,
          prevChapter: prev.chapterName,
          prevInt: prev.intensity.toString(),
          scene: curr.sceneName,
          chapter: curr.chapterName,
          currInt: curr.intensity.toString(),
        }),
        curr.filePath,
        curr.sceneName,
        undefined,
        `${prev.filePath}:${prev.sceneName}_${curr.filePath}:${curr.sceneName}`,
      ));
    }
  }

  // pacing.emotionStreak — 5+ consecutive same emotion
  if (allScenes.length >= 5) {
    let streakEmotion = allScenes[0].emotion;
    let streakStart = 0;
    let streakLen = 1;
    for (let i = 1; i < allScenes.length; i++) {
      if (allScenes[i].emotion === streakEmotion) {
        streakLen++;
      } else {
        if (streakLen >= 5) {
          findings.push(buildFinding(
            'pacing.emotionStreak',
            'pacing',
            'info',
            t('validator.pacing.emotionStreak.title', { emotion: streakEmotion }),
            t('validator.pacing.emotionStreak.desc', {
              emotion: streakEmotion,
              count: streakLen.toString(),
              from: `${allScenes[streakStart].chapterName} / ${allScenes[streakStart].sceneName}`,
              to: `${allScenes[i - 1].chapterName} / ${allScenes[i - 1].sceneName}`,
            }),
            allScenes[streakStart].filePath,
            allScenes[streakStart].sceneName,
            undefined,
            `${streakEmotion}_${streakStart}_${i}`,
          ));
        }
        streakEmotion = allScenes[i].emotion;
        streakStart = i;
        streakLen = 1;
      }
    }
    // Check final streak
    if (streakLen >= 5) {
      const si = streakStart;
      const ei = allScenes.length - 1;
      findings.push(buildFinding(
        'pacing.emotionStreak',
        'pacing',
        'info',
        t('validator.pacing.emotionStreak.title', { emotion: streakEmotion }),
        t('validator.pacing.emotionStreak.desc', {
          emotion: streakEmotion,
          count: streakLen.toString(),
          from: `${allScenes[si].chapterName} / ${allScenes[si].sceneName}`,
          to: `${allScenes[ei].chapterName} / ${allScenes[ei].sceneName}`,
        }),
        allScenes[si].filePath,
        allScenes[si].sceneName,
        undefined,
        `${streakEmotion}_${si}_${ei}`,
      ));
    }
  }

  // pacing.flatArc — intensity within ±2 for >50% of scenes
  const allIntensities = allScenes.map(s => s.intensity);
  const minI = Math.min(...allIntensities);
  const maxI = Math.max(...allIntensities);
  if (maxI - minI <= 4 && allScenes.length >= 6) {
    findings.push(buildFinding(
      'pacing.flatArc',
      'pacing',
      'warning',
      t('validator.pacing.flatArc.title'),
      t('validator.pacing.flatArc.desc', { min: minI.toString(), max: maxI.toString() }),
    ));
  }

  // pacing.noClimax — no scene in last 20% with intensity ≥7
  const climaxThresholdIdx = Math.floor(allScenes.length * 0.80);
  const lastScenes = allScenes.slice(climaxThresholdIdx);
  if (lastScenes.length > 0 && lastScenes.every(s => s.intensity < 7) && allScenes.length >= 5) {
    findings.push(buildFinding(
      'pacing.noClimax',
      'pacing',
      'warning',
      t('validator.pacing.noClimax.title'),
      t('validator.pacing.noClimax.desc'),
    ));
  }

  // pacing.longDrySpell — >5 consecutive scenes with intensity <2
  let dryStreak = 0;
  let dryStart = 0;
  for (let i = 0; i < allScenes.length; i++) {
    if (allScenes[i].intensity < 2) {
      if (dryStreak === 0) dryStart = i;
      dryStreak++;
      if (dryStreak > 5) {
        // Only fire once per dry spell (first time it exceeds threshold)
        if (dryStreak === 6) {
          findings.push(buildFinding(
            'pacing.longDrySpell',
            'pacing',
            'info',
            t('validator.pacing.longDrySpell.title'),
            t('validator.pacing.longDrySpell.desc', {
              from: `${allScenes[dryStart].chapterName} / ${allScenes[dryStart].sceneName}`,
            }),
            allScenes[dryStart].filePath,
            allScenes[dryStart].sceneName,
            undefined,
            `${dryStart}`,
          ));
        }
      }
    } else {
      dryStreak = 0;
    }
  }

  // pacing.dialogueHeavy — >60% of scenes are dialogue-dominant
  const dialogueHeavyScenes = allScenes.filter(s => s.dialogueRatio > 0.70);
  if (allScenes.length >= 5 && dialogueHeavyScenes.length / allScenes.length > 0.60) {
    findings.push(buildFinding(
      'pacing.dialogueHeavy',
      'pacing',
      'info',
      t('validator.pacing.dialogueHeavy.title'),
      t('validator.pacing.dialogueHeavy.desc', {
        pct: Math.round(dialogueHeavyScenes.length / allScenes.length * 100).toString(),
      }),
    ));
  }

  return findings;
}

// ── AI Findings Integration ───────────────────────────────────────

function integrateAiFindings(
  mentionCache: Record<string, MentionCacheEntry>,
  wholeStoryAnalysis: WholeStoryAnalysisResult | undefined,
): ValidatorFinding[] {
  const findings: ValidatorFinding[] = [];

  // Per-chapter AI cache inconsistencies
  for (const [filePath, entry] of Object.entries(mentionCache)) {
    if (!entry.aiFindings) continue;
    for (const finding of entry.aiFindings) {
      if (finding.type !== 'inconsistency') continue;
      const fp = makeFingerprint('ai.inconsistency', filePath, finding.title, finding.description.slice(0, 40));
      findings.push({
        ruleId: 'ai.inconsistency',
        category: 'continuity',
        severity: 'warning',
        title: finding.title,
        description: finding.description,
        filePath,
        entities: finding.entityName ? [finding.entityName] : undefined,
        fingerprint: fp,
        source: 'ai',
      });
    }
  }

  // Whole-story AI inconsistencies
  if (wholeStoryAnalysis) {
    for (const finding of wholeStoryAnalysis.findings) {
      if (finding.type !== 'inconsistency') continue;
      const fp = makeFingerprint('ai.wholeStory.inconsistency', finding.title, finding.description.slice(0, 40));
      findings.push({
        ruleId: 'ai.wholeStory.inconsistency',
        category: 'continuity',
        severity: 'warning',
        title: finding.title,
        description: finding.description,
        entities: finding.entityName ? [finding.entityName] : undefined,
        fingerprint: fp,
        source: 'ai',
      });
    }
  }

  return findings;
}

// ─── filterDismissed ────────────────────────────────────────────────

/**
 * Remove findings that have been dismissed by the user.
 * A finding is dismissed if its fingerprint matches a DismissedFinding record.
 */
export function filterDismissed(
  findings: ValidatorFinding[],
  dismissed: DismissedFinding[],
): ValidatorFinding[] {
  const dismissedFps = new Set(dismissed.map(d => d.fingerprint));
  return findings.filter(f => !dismissedFps.has(f.fingerprint));
}

// ─── Main Entry Point ────────────────────────────────────────────────

/**
 * Run all validation rules and return a ValidationResult.
 * Pass only the chapters/cache for one chapter to do a single-chapter validation.
 */
export function runValidator(input: ValidatorInput): ValidationResult {
  const { chapters, sceneMetadataCache, mentionCache, dismissedFindings, wholeStoryAnalysis } = input;

  const chapters_: ChapterInfo[] = chapters.map(c => ({ ...c }));

  const rawFindings: ValidatorFinding[] = [
    ...checkTimeline(chapters_),
    ...checkCharacters(chapters_, mentionCache, sceneMetadataCache),
    ...checkPlotlines(chapters_, sceneMetadataCache),
    ...checkStructure(chapters_, sceneMetadataCache),
    ...checkContinuity(chapters_, mentionCache),
    ...checkPacing(chapters_, sceneMetadataCache),
    ...integrateAiFindings(mentionCache, wholeStoryAnalysis),
  ];

  const findings = filterDismissed(rawFindings, dismissedFindings);

  const summary = {
    errors: findings.filter(f => f.severity === 'error').length,
    warnings: findings.filter(f => f.severity === 'warning').length,
    infos: findings.filter(f => f.severity === 'info').length,
  };

  return {
    timestamp: new Date().toISOString(),
    findings,
    summary,
  };
}

// ─── Date Helpers ────────────────────────────────────────────────────

/** Attempt to parse a variety of date formats into a sortable Date object. */
function parseDateLoose(dateStr: string): Date | null {
  if (!dateStr) return null;
  // ISO format (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return new Date(dateStr);
  // Day N / Day: 5 / "Day 12" (story-internal dates)
  const dayMatch = dateStr.match(/^(?:day\s*:?\s*)(\d+)/i);
  if (dayMatch) return new Date(Date.UTC(2000, 0, parseInt(dayMatch[1], 10)));
  // Year X
  const yearMatch = dateStr.match(/^(?:year\s*:?\s*)(\d+)/i);
  if (yearMatch) return new Date(Date.UTC(parseInt(yearMatch[1], 10), 0, 1));
  // Fall back to JS Date parsing
  const fallback = new Date(dateStr);
  return isNaN(fallback.getTime()) ? null : fallback;
}
