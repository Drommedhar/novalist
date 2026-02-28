/**
 * sceneAnalysisUtils.ts
 *
 * Automatic scene metadata detection engine.
 * Analyses raw scene text and extracts structured metadata without AI.
 * All detection is heuristic-based; results carry a MetadataSource of 'auto'.
 */

import type {
  SceneMetadata,
  SceneEmotion,
  TrackedValue,
  ChapterAggregateMetadata,
  SceneMetadataOverrides,
  MentionResult,
  ChapterNoteData,
  PlotBoardData,
} from '../types';

// ─── Emotion Lexicons ────────────────────────────────────────────────

/**
 * Keyword dictionaries for emotion detection, keyed by emotion name.
 * Each entry is [keyword, weight] where weight is 1–3.
 */
type EmotionLexicon = Partial<Record<SceneEmotion, Array<[string, number]>>>;

const EN_LEXICON: EmotionLexicon = {
  tense: [
    ['fight', 2], ['clash', 2], ['threat', 2], ['danger', 2], ['grip', 1], ['chase', 2],
    ['escape', 2], ['weapon', 2], ['enemy', 2], ['battle', 2], ['war', 2], ['alarm', 1],
    ['urgent', 2], ['panic', 2], ['heart pounded', 3], ['ran', 1], ['sprint', 2],
    ['rush', 1], ['desperate', 1], ['trap', 2], ['ambush', 3], ['attack', 2],
    ['cornered', 3], ['struggle', 2], ['frantic', 2], ['race', 1], ['pursuit', 2],
  ],
  joyful: [
    ['laugh', 2], ['smile', 2], ['happy', 2], ['joy', 2], ['celebrate', 2],
    ['dance', 2], ['cheer', 2], ['grin', 2], ['delight', 2], ['elated', 3],
    ['gleeful', 3], ['ecstatic', 3], ['wonderful', 1], ['bliss', 2], ['radiant', 1],
    ['bright', 1], ['warm', 1], ['giggle', 2], ['fun', 1], ['merry', 2], ['cheerful', 2],
  ],
  melancholic: [
    ['tears', 2], ['loss', 2], ['grief', 3], ['alone', 2], ['empty', 2],
    ['fading', 2], ['memory', 1], ['regret', 2], ['sigh', 2], ['longing', 2],
    ['sad', 2], ['sorrow', 2], ['weep', 2], ['nostalgia', 2], ['hollow', 2],
    ['remnant', 1], ['faded', 1], ['past', 1], ['miss', 1], ['wistful', 3],
    ['heartbroken', 3], ['mourn', 3], ['lament', 3], ['ache', 2],
  ],
  angry: [
    ['rage', 3], ['fury', 3], ['anger', 2], ['wrath', 3], ['yell', 2], ['shout', 2],
    ['scream', 2], ['growl', 2], ['slam', 2], ['hit', 1], ['punch', 2], ['threw', 1],
    ['furious', 3], ['livid', 3], ['seething', 3], ['outrage', 2], ['glare', 2],
    ['hostile', 2], ['bitter', 2], ['snapped', 2], ['cursed', 2], ['stormed', 2],
  ],
  fearful: [
    ['fear', 2], ['terror', 3], ['dread', 3], ['horror', 3], ['tremble', 2],
    ['shiver', 2], ['dark', 1], ['shadow', 1], ['hide', 2], ['nightmare', 3],
    ['scream', 2], ['panic', 2], ['cower', 3], ['frozen', 2], ['paralyzed', 3],
    ['threat', 1], ['menace', 2], ['lurk', 2], ['eerie', 2], ['ominous', 2],
    ['creep', 1], ['stalked', 2], ['hunted', 3], ['sinister', 2],
  ],
  romantic: [
    ['kiss', 3], ['embrace', 2], ['love', 2], ['heart', 1], ['touch', 1],
    ['caress', 3], ['longing', 2], ['tender', 2], ['warm', 1], ['close', 1],
    ['whisper', 2], ['breathless', 2], ['yearning', 3], ['adore', 3], ['devotion', 2],
    ['passion', 2], ['intimate', 2], ['cherish', 2], ['gaze', 2], ['blush', 2],
    ['swoon', 3], ['beloved', 2],
  ],
  mysterious: [
    ['secret', 2], ['hidden', 2], ['unknown', 2], ['whisper', 1], ['clue', 2],
    ['riddle', 3], ['strange', 2], ['enigma', 3], ['mystery', 3], ['puzzle', 2],
    ['unexplained', 2], ['curious', 1], ['odd', 1], ['peculiar', 2], ['concealed', 2],
    ['lurk', 2], ['shadows', 1], ['cipher', 3], ['intrigue', 2], ['conspire', 2],
    ['unravel', 2],
  ],
  humorous: [
    ['laugh', 2], ['joke', 2], ['grin', 1], ['chuckle', 2], ['absurd', 2],
    ['ridiculous', 2], ['funny', 2], ['wit', 2], ['comic', 2], ['amused', 2],
    ['silly', 2], ['playful', 2], ['teased', 2], ['banter', 2], ['quip', 2],
    ['sarcasm', 2], ['irony', 1], ['snicker', 2], ['guffaw', 3],
  ],
  hopeful: [
    ['hope', 2], ['dream', 2], ['wish', 1], ['aspire', 2], ['believe', 1],
    ['faith', 2], ['bright', 1], ['future', 1], ['possibility', 2], ['chance', 1],
    ['optimism', 2], ['encouraged', 2], ['determined', 2], ['resolve', 2],
    ['dawn', 1], ['light', 1], ['promise', 2], ['potential', 2],
  ],
  desperate: [
    ['desperate', 3], ['last chance', 3], ['no way out', 3], ['only option', 2],
    ['hopeless', 3], ['doomed', 3], ['frantic', 2], ['reckless', 2], ['gamble', 2],
    ['sacrifice', 2], ['final', 1], ['nothing left', 2], ['all or nothing', 3],
    ['plea', 2], ['begging', 2], ['pleaded', 2],
  ],
  peaceful: [
    ['peace', 2], ['calm', 2], ['quiet', 2], ['serene', 3], ['still', 1],
    ['gentle', 2], ['soft', 1], ['breathe', 1], ['rest', 1], ['ease', 2],
    ['tranquil', 3], ['undisturbed', 2], ['silence', 1], ['harmony', 2],
    ['drifted', 1], ['leisurely', 2], ['unhurried', 2],
  ],
  chaotic: [
    ['chaos', 3], ['mayhem', 3], ['chaos', 3], ['pandemonium', 3], ['frenzy', 3],
    ['explosion', 2], ['crash', 2], ['collapse', 2], ['scatter', 2], ['riot', 3],
    ['storm', 2], ['tumult', 3], ['havoc', 3], ['rampage', 3], ['wild', 1],
    ['overwhelmed', 2], ['disarray', 2],
  ],
  sorrowful: [
    ['grief', 3], ['mourn', 3], ['sob', 3], ['weep', 3], ['devastated', 3],
    ['crushed', 2], ['broken', 2], ['loss', 2], ['funeral', 3], ['death', 2],
    ['died', 2], ['gone', 1], ['never again', 2], ['inconsolable', 3],
    ['wailed', 3], ['anguish', 3],
  ],
  triumphant: [
    ['triumph', 3], ['victory', 3], ['won', 2], ['conquered', 3], ['overcome', 2],
    ['prevail', 2], ['achieve', 2], ['glory', 2], ['pride', 2], ['champion', 2],
    ['success', 2], ['breakthrough', 2], ['vindicated', 3], ['proved', 1],
    ['celebrated', 2], ['earned', 1], ['deserved', 1],
  ],
};

const DE_LEXICON: EmotionLexicon = {
  tense: [
    ['kämpf', 2], ['gefahr', 2], ['bedrohung', 2], ['flucht', 2], ['jagd', 2],
    ['waffe', 2], ['feind', 2], ['krieg', 2], ['panik', 2], ['falle', 2],
    ['hinterhalt', 3], ['angriff', 2], ['verzweifelt', 1], ['atemlos', 2],
  ],
  joyful: [
    ['lachen', 2], ['lächeln', 2], ['glücklich', 2], ['freude', 2], ['feiern', 2],
    ['tanzen', 2], ['jubel', 2], ['strahlen', 2], ['begeistert', 2], ['froh', 2],
  ],
  melancholic: [
    ['tränen', 2], ['verlust', 2], ['trauer', 3], ['allein', 2], ['leer', 2],
    ['erinnerung', 1], ['reue', 2], ['seufzen', 2], ['sehnsucht', 2], ['traurig', 2],
  ],
  angry: [
    ['wut', 3], ['zorn', 3], ['wütend', 2], ['rasen', 2], ['schreien', 2],
    ['brüllen', 2], ['schlagen', 1], ['warf', 1], ['rasend', 2],
  ],
  fearful: [
    ['angst', 2], ['terror', 3], ['grauen', 3], ['schrecken', 2], ['zittern', 2],
    ['dunkel', 1], ['schatten', 1], ['verstecken', 2], ['alptraum', 3],
  ],
  romantic: [
    ['kuss', 3], ['umarmung', 2], ['liebe', 2], ['herz', 1], ['berühren', 1],
    ['zärtlich', 2], ['sehnsucht', 2], ['leidenschaft', 2], ['flüstern', 2],
  ],
  mysterious: [
    ['geheimnis', 2], ['verborgen', 2], ['rätsel', 3], ['flüstern', 1],
    ['fremd', 2], ['unbekannt', 2], ['mysteriös', 3], ['intrige', 2],
  ],
  humorous: [
    ['lachen', 2], ['witz', 2], ['spaß', 2], ['absurd', 2], ['komisch', 2],
    ['albern', 2], ['scherz', 2],
  ],
  hopeful: [
    ['hoffnung', 2], ['traum', 2], ['wunsch', 1], ['glaube', 2],
    ['zukunft', 1], ['möglichkeit', 2], ['entschlossen', 2],
  ],
  desperate: [
    ['verzweifelt', 3], ['hoffnungslos', 3], ['letzte chance', 3],
    ['keinen ausweg', 3], ['opfer', 2], ['betteln', 2], ['anflehen', 2],
  ],
  peaceful: [
    ['frieden', 2], ['ruhe', 2], ['still', 1], ['sanft', 2], ['friedlich', 3],
    ['gelassen', 2], ['stille', 1], ['harmonie', 2],
  ],
  chaotic: [
    ['chaos', 3], ['tumult', 3], ['aufruhr', 2], ['explosion', 2], ['panik', 2],
    ['zusammenbruch', 2], ['aufstand', 2],
  ],
  sorrowful: [
    ['trauer', 3], ['weinen', 3], ['schluchzen', 3], ['tod', 2], ['verloren', 1],
    ['gebrochen', 2], ['bedauerlich', 2],
  ],
  triumphant: [
    ['triumph', 3], ['sieg', 3], ['gewonnen', 2], ['besiegt', 3], ['erfolg', 2],
    ['ruhm', 2], ['stolz', 2],
  ],
};

// ─── Action Verb List (intensity detection) ──────────────────────────

const ACTION_VERBS_EN = [
  'ran', 'sprint', 'dashed', 'bolted', 'fled', 'chased', 'fought', 'struck',
  'slashed', 'grabbed', 'shoved', 'threw', 'crashed', 'burst', 'plunged',
  'leapt', 'rushed', 'torn', 'broke', 'smashed', 'fired', 'shot', 'stabbed',
  'tackled', 'climbed', 'dodged', 'dove', 'rolled', 'spun', 'aimed', 'lunged',
  'wrestled', 'charged', 'escaped', 'stumbled', 'tumbled',
];

const ACTION_VERBS_DE = [
  'rannte', 'sprintete', 'floh', 'jagte', 'kämpfte', 'schlug', 'griff', 'warf',
  'stürzte', 'sprang', 'schoss', 'flüchtete', 'stieß', 'brach', 'riss',
  'taumelte', 'stürzte', 'entkam', 'verfolgte',
];

// ─── Emotion intensity base scores ──────────────────────────────────

const EMOTION_BASE_INTENSITY: Record<SceneEmotion, number> = {
  chaotic:     7,
  desperate:   6,
  tense:       5,
  triumphant:  5,
  angry:       4,
  fearful:     3,
  romantic:    2,
  hopeful:     1,
  mysterious:  1,
  joyful:      2,
  humorous:    0,
  neutral:     0,
  melancholic: -2,
  sorrowful:   -4,
  peaceful:    -3,
};

// ─── Text Statistics ─────────────────────────────────────────────────

/** Count words in a text string (ignores Markdown markup). */
export function countSceneWords(text: string): number {
  const cleaned = text
    .replace(/^#{1,6}\s+.*/gm, '')  // headings
    .replace(/!\[.*?\]\(.*?\)/g, '') // images
    .replace(/\[.*?\]\(.*?\)/g, ' ') // links
    .replace(/[*_`~#>|]/g, ' ')     // Markdown chars
    .trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(w => w.length > 0).length;
}

/** Compute dialogue-to-prose ratio (0–1) based on quoted text proportion. */
export function computeDialogueRatio(text: string): number {
  if (!text) return 0;
  const totalWords = countSceneWords(text);
  if (totalWords === 0) return 0;

  // Match both "double" and «guillemet» and „low-high" quote styles
  const dialoguePattern = /(?:"[^"]*"|„[^"]*"|«[^»]*»)/g;
  let dialogueChars = 0;
  let match: RegExpExecArray | null;
  while ((match = dialoguePattern.exec(text)) !== null) {
    dialogueChars += match[0].length;
  }

  // Approximate dialogue words by character ratio
  const totalChars = text.replace(/\s+/g, ' ').length;
  if (totalChars === 0) return 0;
  return Math.min(1, dialogueChars / totalChars);
}

/** Compute average sentence length in words. */
export function computeAvgSentenceLength(text: string): number {
  if (!text.trim()) return 0;
  const sentences = text.split(/[.!?…]+/).filter(s => s.trim().length > 0);
  if (sentences.length === 0) return 0;
  const totalWords = sentences.reduce((sum, s) => sum + countSceneWords(s), 0);
  return totalWords / sentences.length;
}

/** Compute exclamation + question mark density (count per 100 words). */
export function computePunctuationIntensity(text: string): number {
  const words = countSceneWords(text);
  if (words === 0) return 0;
  const marks = (text.match(/[!?]/g) || []).length;
  return (marks / words) * 100;
}

// ─── Detection Algorithms ────────────────────────────────────────────

/** Select the appropriate emotion lexicon based on locale prefix. */
function getLexicon(locale: string): EmotionLexicon {
  return locale.startsWith('de') ? DE_LEXICON : EN_LEXICON;
}

/** Select action verb list based on locale. */
function getActionVerbs(locale: string): string[] {
  return locale.startsWith('de') ? ACTION_VERBS_DE : ACTION_VERBS_EN;
}

/**
 * Detect the most likely POV character from scene text and mention data.
 * Returns a TrackedValue with source 'auto'.
 */
export function detectPov(
  sceneText: string,
  mentionedCharacters: string[],
): TrackedValue<string> {
  if (mentionedCharacters.length === 0) {
    return { value: '', source: 'auto' };
  }
  if (mentionedCharacters.length === 1) {
    return { value: mentionedCharacters[0], source: 'auto' };
  }

  const lowerText = sceneText.toLowerCase();

  // Check for first-person narration — narrator POV
  const firstPersonCount = (sceneText.match(/\b(I|I'm|I've|I'll|I'd|my|mine|myself|me)\b/gi) || []).length;
  const totalWords = countSceneWords(sceneText) || 1;
  if (firstPersonCount / totalWords > 0.015) {
    // Strong first-person narration — return the first-mentioned character
    return { value: mentionedCharacters[0], source: 'auto' };
  }

  // Score each character by weighted mention frequency
  const scores = new Map<string, number>();
  const paragraphs = sceneText.split(/\n\n+/);
  const firstPara = (paragraphs[0] || '').toLowerCase();
  const firstSentences = sceneText.split(/[.!?]\s+/).slice(0, 5).join(' ').toLowerCase();

  for (const char of mentionedCharacters) {
    const variations: string[] = [char.toLowerCase()];
    const parts = char.split(' ');
    if (parts.length > 1) variations.push(parts[0].toLowerCase());

    let score = 0;
    for (const v of variations) {
      if (v.length < 2) continue;
      // Count all mentions
      const count = (lowerText.match(new RegExp(`\\b${escapeRegexLocal(v)}\\b`, 'g')) || []).length;
      score += count;
      // Bonus for first paragraph presence
      if (firstPara.includes(v)) score += count * 0.5;
      // Bonus for appearing in first 5 sentences
      if (firstSentences.includes(v)) score += 2;
    }
    scores.set(char, score);
  }

  // Sort descending by score
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const topChar = sorted[0];
  if (!topChar || topChar[1] === 0) {
    return { value: mentionedCharacters[0], source: 'auto' };
  }

  // Low confidence if top two scores are close
  const secondScore = sorted[1]?.[1] ?? 0;
  if (secondScore > 0 && topChar[1] / secondScore < 1.3) {
    // Ambiguous — return first-mentioned as fallback
    return { value: mentionedCharacters[0], source: 'auto' };
  }

  return { value: topChar[0], source: 'auto' };
}

/**
 * Detect the dominant emotion from scene text using the weighted lexicon.
 * Returns 'neutral' when no emotion dominates.
 */
export function detectEmotion(sceneText: string, locale: string): TrackedValue<SceneEmotion> {
  if (!sceneText.trim()) return { value: 'neutral', source: 'auto' };

  const lowerText = sceneText.toLowerCase();
  const lexicon = getLexicon(locale);
  const scores = new Map<SceneEmotion, number>();

  for (const [emotion, pairs] of Object.entries(lexicon) as [SceneEmotion, Array<[string, number]>][]) {
    let score = 0;
    for (const [keyword, weight] of pairs) {
      const regex = new RegExp(`\\b${escapeRegexLocal(keyword)}`, 'gi');
      const matches = lowerText.match(regex);
      if (matches) score += matches.length * weight;
    }
    scores.set(emotion, score);
  }

  // Sentence-level signals
  const sentences = sceneText.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const avgLen = sentences.length > 0
    ? sentences.reduce((s, sent) => s + sent.split(/\s+/).length, 0) / sentences.length
    : 0;
  const exclamations = (sceneText.match(/!/g) || []).length;
  const questions = (sceneText.match(/\?/g) || []).length;
  const ellipses = (sceneText.match(/\.\.\.|…/g) || []).length;

  // Short sentences → tense/chaotic boost
  if (avgLen < 8 && avgLen > 0) {
    scores.set('tense', (scores.get('tense') ?? 0) + 3);
    scores.set('chaotic', (scores.get('chaotic') ?? 0) + 2);
  }
  // Long sentences → peaceful/romantic/melancholic
  if (avgLen > 20) {
    scores.set('peaceful', (scores.get('peaceful') ?? 0) + 2);
    scores.set('melancholic', (scores.get('melancholic') ?? 0) + 1);
    scores.set('romantic', (scores.get('romantic') ?? 0) + 1);
  }
  // Exclamation clusters → angry/chaotic/joyful
  if (exclamations > 3) {
    scores.set('angry', (scores.get('angry') ?? 0) + 2);
    scores.set('chaotic', (scores.get('chaotic') ?? 0) + 1);
    scores.set('joyful', (scores.get('joyful') ?? 0) + 1);
  }
  // Question clusters → mysterious
  if (questions > 3) {
    scores.set('mysterious', (scores.get('mysterious') ?? 0) + 2);
  }
  // Ellipsis clusters → melancholic/mysterious
  if (ellipses > 2) {
    scores.set('melancholic', (scores.get('melancholic') ?? 0) + 1);
    scores.set('mysterious', (scores.get('mysterious') ?? 0) + 1);
  }

  // Find top emotion
  let topEmotion: SceneEmotion = 'neutral';
  let topScore = 0;
  let secondScore = 0;

  for (const [emotion, score] of scores.entries()) {
    if (score > topScore) {
      secondScore = topScore;
      topScore = score;
      topEmotion = emotion;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  // Require minimum score and reasonable margin
  if (topScore < 2) return { value: 'neutral', source: 'auto' };
  // If two emotions are very close, we call it neutral to avoid noise
  if (secondScore > 0 && topScore / (secondScore + 1) < 1.4) {
    // Still return top — just note ambiguity; 'neutral' would hide real signal
    return { value: topEmotion, source: 'auto' };
  }

  return { value: topEmotion, source: 'auto' };
}

/**
 * Compute narrative intensity score (−10 to +10) from multiple linguistic signals.
 */
export function detectIntensity(
  sceneText: string,
  detectedEmotion: SceneEmotion,
  locale: string,
): TrackedValue<number> {
  if (!sceneText.trim()) return { value: 0, source: 'auto' };

  const words = countSceneWords(sceneText) || 1;
  const sentences = sceneText.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const avgLen = sentences.length > 0
    ? sentences.reduce((s, sent) => s + sent.split(/\s+/).length, 0) / sentences.length
    : 15;

  // 1. Action density (30%)
  const actionVerbs = getActionVerbs(locale);
  const lowerText = sceneText.toLowerCase();
  let actionCount = 0;
  for (const verb of actionVerbs) {
    if (lowerText.includes(verb)) actionCount++;
  }
  const actionDensity = Math.min(1, actionCount / 10);
  const actionScore = actionDensity * 10 * 0.30;

  // 2. Sentence rhythm (20%)
  // Short = intense, long = calm. Scale: avgLen 5 → 8, avgLen 25 → 0
  const sentenceScore = Math.max(0, Math.min(8, 8 - (avgLen - 5) * 0.4)) * 0.20;

  // 3. Punctuation signals (15%)
  const exclamations = (sceneText.match(/!/g) || []).length;
  const questions = (sceneText.match(/\?/g) || []).length;
  const dashes = (sceneText.match(/—|–/g) || []).length;
  const punctPerWord = (exclamations + questions * 0.7 + dashes * 0.5) / words * 100;
  const punctScore = Math.min(8, punctPerWord * 2) * 0.15;

  // 4. Dialogue ratio (15%)
  const dialogueRatio = computeDialogueRatio(sceneText);
  // Back-and-forth dialogue (many short exchange lines) → higher intensity
  const dialogueLines = (sceneText.match(/"[^"]{0,60}"/g) || []).length;
  const dialogueScore = dialogueLines > 5 ? 5 * 0.15 : dialogueRatio * 3 * 0.15;

  // 5. Emotional valence (20%)
  const emotionBase = EMOTION_BASE_INTENSITY[detectedEmotion] ?? 0;
  const emotionScore = emotionBase * 0.20;

  const raw = actionScore + sentenceScore + punctScore + dialogueScore + emotionScore;

  // Map raw (0–~8) to -10..+10 range
  const normalized = Math.round((raw / 5) * 10 - 2);
  const clamped = Math.max(-10, Math.min(10, normalized));

  return { value: clamped, source: 'auto' };
}

/**
 * Extract a short one-line conflict summary from scene text.
 * Returns empty string when no clear conflict is found.
 */
export function detectConflict(
  sceneText: string,
  characters: string[],
  chapterNotes: ChapterNoteData | undefined,
  sceneName: string,
): TrackedValue<string> {
  if (!sceneText.trim()) return { value: '', source: 'auto' };

  const sentences = sceneText.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);

  // Goal/obligation patterns
  const goalPatterns = [
    /\b(must|has to|needs? to|have to)\b.{0,60}/i,
    /\b(wants? to|tries? to|attempts? to)\b.{0,60}/i,
    /\b(can't|cannot|unable to|won't|refuses? to)\b.{0,60}/i,
    /\b(against|despite|versus|vs\.?)\b.{0,60}/i,
  ];

  for (const sentence of sentences) {
    for (const pattern of goalPatterns) {
      const match = sentence.match(pattern);
      if (match) {
        // Prefer sentences that also contain a character name
        const hasChar = characters.some(c =>
          sentence.toLowerCase().includes(c.toLowerCase().split(' ')[0]),
        );
        if (hasChar || characters.length === 0) {
          const snippet = sentence.slice(0, 90).trim();
          return { value: snippet.charAt(0).toUpperCase() + snippet.slice(1), source: 'auto' };
        }
      }
    }
  }

  // Secondary: "but / however / yet" at sentence start (turning point)
  for (const sentence of sentences) {
    if (/^(but|however|yet|still|nevertheless)\b/i.test(sentence)) {
      const snippet = sentence.slice(0, 90).trim();
      return { value: snippet.charAt(0).toUpperCase() + snippet.slice(1), source: 'auto' };
    }
  }

  // Fallback: check chapter notes for this scene
  if (chapterNotes?.sceneNotes[sceneName]) {
    const note = chapterNotes.sceneNotes[sceneName].trim().split('\n')[0];
    if (note && note.length > 5) {
      const snippet = note.slice(0, 90);
      return { value: snippet, source: 'auto' };
    }
  }

  return { value: '', source: 'auto' };
}

/**
 * Detect plotline / subplot tags for a scene from plot board data and notes.
 */
export function detectTags(
  plotBoardData: PlotBoardData,
  chapterNotes: ChapterNoteData | undefined,
  chapterId: string,
  sceneName: string,
  sceneText: string,
): TrackedValue<string[]> {
  const tags: Set<string> = new Set();

  // 1. Plot board labels on this chapter's cards
  for (const colLabels of Object.values(plotBoardData.cardLabels)) {
    for (const label of colLabels) {
      if (typeof label === 'string' && label.trim()) {
        tags.add(label.trim());
      }
    }
  }

  // 2. Labels assigned in plotBoard.labels (chapter-level)
  for (const label of plotBoardData.labels) {
    if (label && typeof label === 'object' && 'text' in label) {
      const labelText = (label as { text: string }).text;
      // Only inherit if it seems like a plotline name (not a status)
      if (labelText && labelText.length < 40) tags.add(labelText);
    }
  }

  // 3. Hashtags in plot board cells for this chapter
  const chapterCellKey = `${chapterId}:chapter`;
  const sceneCellKey = `${chapterId}:${sceneName}`;
  for (const [key, cellData] of Object.entries(plotBoardData.cells)) {
    if (key.includes(chapterId) || key === chapterCellKey || key === sceneCellKey) {
      const cellText = typeof cellData === 'string' ? cellData : '';
      const hashtags = cellText.match(/#(\w+)/g) || [];
      for (const tag of hashtags) tags.add(tag.slice(1));
    }
  }

  // 4. Hashtags in chapter notes
  const noteSources = [
    chapterNotes?.chapterNote ?? '',
    chapterNotes?.sceneNotes[sceneName] ?? '',
  ];
  for (const noteText of noteSources) {
    const hashtags = noteText.match(/#(\w+)/g) || [];
    for (const tag of hashtags) tags.add(tag.slice(1));
  }

  // 5. Scene text hashtags
  const textHashtags = sceneText.match(/#(\w+)/g) || [];
  for (const tag of textHashtags) tags.add(tag.slice(1));

  return { value: Array.from(tags), source: 'auto' };
}

// ─── Main Analysis Function ──────────────────────────────────────────

/**
 * Analyse a single scene section and return its SceneMetadata.
 *
 * @param sceneText   - Raw text of the H2 scene section.
 * @param sceneName   - Scene heading (H2) text.
 * @param chapterId   - Stable chapter GUID.
 * @param chapterPath - Vault-relative file path of the chapter.
 * @param mentions    - Entity mentions from existing scanMentions (passed in to avoid re-scan).
 * @param chapterNotes - Existing chapter/scene notes for this chapter.
 * @param plotBoard   - Project plot board data.
 * @param overrides   - Any manual field overrides for this scene.
 * @param locale      - Language code (e.g. 'en', 'de-guillemet') for lexicon selection.
 */
export function analyseScene(
  sceneText: string,
  sceneName: string,
  chapterId: string,
  chapterPath: string,
  mentions: MentionResult,
  chapterNotes: ChapterNoteData | undefined,
  plotBoard: PlotBoardData,
  overrides: Partial<SceneMetadataOverrides> | undefined,
  locale: string,
): SceneMetadata {
  // Text statistics
  const wordCount = countSceneWords(sceneText);
  const dialogueRatio = computeDialogueRatio(sceneText);
  const avgSentenceLength = computeAvgSentenceLength(sceneText);
  const punctuationIntensity = computePunctuationIntensity(sceneText);

  // Detect or apply overrides
  const pov: TrackedValue<string> = overrides?.pov !== undefined
    ? { value: overrides.pov, source: 'manual' }
    : detectPov(sceneText, mentions.characters);

  const emotion: TrackedValue<SceneEmotion> = overrides?.emotion !== undefined
    ? { value: overrides.emotion, source: 'manual' }
    : detectEmotion(sceneText, locale);

  const intensity: TrackedValue<number> = overrides?.intensity !== undefined
    ? { value: overrides.intensity, source: 'manual' }
    : detectIntensity(sceneText, emotion.value, locale);

  const conflict: TrackedValue<string> = overrides?.conflict !== undefined
    ? { value: overrides.conflict, source: 'manual' }
    : detectConflict(sceneText, mentions.characters, chapterNotes, sceneName);

  const tags: TrackedValue<string[]> = overrides?.tags !== undefined
    ? { value: overrides.tags, source: 'manual' }
    : detectTags(plotBoard, chapterNotes, chapterId, sceneName, sceneText);

  return {
    name: sceneName,
    chapterPath,
    chapterId,
    pov,
    characters: { value: mentions.characters, source: 'auto' },
    locations: { value: mentions.locations, source: 'auto' },
    items: { value: mentions.items, source: 'auto' },
    lore: { value: mentions.lore, source: 'auto' },
    emotion,
    intensity,
    conflict,
    tags,
    wordCount,
    dialogueRatio,
    avgSentenceLength,
    punctuationIntensity,
  };
}

/**
 * Compute aggregate chapter metadata from all its scene metadata records.
 */
export function computeChapterAggregate(
  scenes: Record<string, SceneMetadata>,
): ChapterAggregateMetadata {
  const sceneList = Object.values(scenes);
  if (sceneList.length === 0) {
    return {
      allCharacters: [],
      allLocations: [],
      dominantPov: '',
      avgIntensity: 0,
      dominantEmotion: 'neutral',
      totalWordCount: 0,
      intensityArc: [],
    };
  }

  // Merge characters + locations
  const allCharsSet: Set<string> = new Set();
  const allLocsSet: Set<string> = new Set();
  for (const s of sceneList) {
    for (const c of s.characters.value) allCharsSet.add(c);
    for (const l of s.locations.value) allLocsSet.add(l);
  }

  // Dominant POV
  const povCounts = new Map<string, number>();
  for (const s of sceneList) {
    if (s.pov.value) {
      povCounts.set(s.pov.value, (povCounts.get(s.pov.value) ?? 0) + 1);
    }
  }
  let dominantPov = '';
  let maxPovCount = 0;
  for (const [pov, count] of povCounts.entries()) {
    if (count > maxPovCount) { maxPovCount = count; dominantPov = pov; }
  }

  // Average intensity + arc
  const intensityArc = sceneList.map(s => s.intensity.value);
  const avgIntensity = intensityArc.reduce((a, b) => a + b, 0) / intensityArc.length;

  // Dominant emotion
  const emotionCounts = new Map<SceneEmotion, number>();
  for (const s of sceneList) {
    emotionCounts.set(s.emotion.value, (emotionCounts.get(s.emotion.value) ?? 0) + 1);
  }
  let dominantEmotion: SceneEmotion = 'neutral';
  let maxEmotionCount = 0;
  for (const [emotion, count] of emotionCounts.entries()) {
    if (count > maxEmotionCount) { maxEmotionCount = count; dominantEmotion = emotion; }
  }

  const totalWordCount = sceneList.reduce((sum, s) => sum + s.wordCount, 0);

  return {
    allCharacters: Array.from(allCharsSet),
    allLocations: Array.from(allLocsSet),
    dominantPov,
    avgIntensity: Math.round(avgIntensity * 10) / 10,
    dominantEmotion,
    totalWordCount,
    intensityArc,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function escapeRegexLocal(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
