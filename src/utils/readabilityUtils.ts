/**
 * Readability scoring utilities that work across multiple languages.
 * 
 * Since Flesch-Kincaid and similar formulas are language-specific,
 * we use a combination of:
 * 1. Language-specific formulas where available
 * 2. Universal character-based metrics that work for any language
 * 
 * Supported languages: English, German, French, Spanish, Italian, Portuguese,
 * Russian, Polish, Czech, Slovak, and generic fallback for others.
 */

import { LanguageKey } from '../types';
import { t } from '../i18n';
import { stripComments } from './statisticsUtils';

export interface ReadabilityScore {
  /** Score value (typically 0-100, higher = easier to read) */
  score: number;
  /** Interpretation level */
  level: 'very_easy' | 'easy' | 'moderate' | 'difficult' | 'very_difficult';
  /** Human-readable description */
  description: string;
  /** Average words per sentence */
  wordsPerSentence: number;
  /** Average characters per word */
  charsPerWord: number;
  /** Total sentences counted */
  sentenceCount: number;
  /** Method used for calculation */
  method: string;
}

export interface ReadabilityMetrics {
  wordCount: number;
  sentenceCount: number;
  charCount: number;
  syllableCount?: number;
}

/**
 * Universal sentence tokenizer that works across languages.
 * Handles: . ! ? and language-specific sentence endings.
 */
export function countSentences(text: string): number {
  // Remove frontmatter first
  const withoutFrontmatter = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
  // Remove comments
  const withoutComments = stripComments(withoutFrontmatter);
  
  // Remove markdown
  const cleanText = withoutComments
    .replace(/[#*_[\]()|`-]/g, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  
  // Split by sentence-ending punctuation
  // Matches: . ! ? followed by space or end of string
  // Also handles ellipsis (...)
  const sentences = cleanText
    .replace(/\.{3,}/g, '.') // Convert ellipsis to single period
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && /[\p{L}\p{N}]/u.test(s));
  
  return sentences.length || 1; // At least 1 to avoid division by zero
}

/**
 * Universal word tokenizer supporting Unicode characters.
 */
export function countWords(text: string): number {
  const withoutFrontmatter = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const withoutComments = stripComments(withoutFrontmatter);
  const cleanText = withoutComments
    .replace(/[#*_[\]()|`-]/g, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  
  const words = cleanText.match(/[\p{L}\p{N}]+(?:[''\-\u2019][\p{L}\p{N}]+)*/gu);
  return words ? words.length : 0;
}

/**
 * Count characters excluding spaces and punctuation.
 */
export function countChars(text: string): number {
  const withoutFrontmatter = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const withoutComments = stripComments(withoutFrontmatter);
  const cleanText = withoutComments
    .replace(/[#*_[\]()|`-]/g, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1');
  
  // Only count letters and numbers
  const chars = cleanText.match(/[\p{L}\p{N}]/gu);
  return chars ? chars.length : 0;
}

/**
 * Estimate syllable count using language-appropriate methods.
 * Falls back to vowel-group counting for unsupported languages.
 */
export function estimateSyllables(text: string, language?: LanguageKey): number {
  const withoutFrontmatter = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const withoutComments = stripComments(withoutFrontmatter);
  const cleanText = withoutComments
    .replace(/[#*_[\]()|`-]/g, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .toLowerCase();
  
  const words = cleanText.match(/[\p{L}\p{N}]+(?:[''\-\u2019][\p{L}\p{N}]+)*/gu) || [];
  
  let totalSyllables = 0;
  
  for (const word of words) {
    totalSyllables += countSyllablesInWord(word, language);
  }
  
  return totalSyllables || words.length; // At least 1 per word
}

/**
 * Count syllables in a single word based on language.
 */
function countSyllablesInWord(word: string, language?: LanguageKey): number {
  if (word.length === 0) return 0;
  
  switch (language) {
    case 'en':
      return countEnglishSyllables(word);
    case 'de-guillemet':
    case 'de-low':
      return countGermanSyllables(word);
    case 'fr':
      return countFrenchSyllables(word);
    case 'es':
    case 'it':
    case 'pt':
      return countRomanceSyllables(word);
    case 'ru':
      return countRussianSyllables(word);
    case 'pl':
    case 'cs':
    case 'sk':
      return countSlavicSyllables(word);
    default:
      return countGenericSyllables(word);
  }
}

/**
 * English syllable counting using vowel groups.
 */
function countEnglishSyllables(word: string): number {
  // Remove trailing 'e' (silent in many English words)
  word = word.replace(/e$/, '');
  
  // Count vowel groups
  const matches = word.match(/[aeiouy]+/gi);
  let count = matches ? matches.length : 0;
  
  // Minimum 1 syllable per word
  return Math.max(1, count);
}

/**
 * German syllable counting.
 */
function countGermanSyllables(word: string): number {
  // Count vowel groups (including umlauts)
  const matches = word.match(/[aeiouäöü]+/gi);
  let count = matches ? matches.length : 0;
  
  // Handle common German diphthongs that count as one syllable
  const diphthongs = word.match(/(ei|ai|au|eu|äu|ie)/gi) || [];
  count -= diphthongs.length;
  
  return Math.max(1, count);
}

/**
 * French syllable counting.
 */
function countFrenchSyllables(word: string): number {
  // Count vowel groups (including accents)
  const matches = word.match(/[aeiouyàâäéèêëïîôùûü]+/gi);
  let count = matches ? matches.length : 0;
  
  // Final 'e' is often silent but counts as a syllable in poetry
  // We keep it for prose calculation
  
  // Handle French diphthongs
  const diphthongs = word.match(/(oi|ai|ei|eu|au|ou|ie)/gi) || [];
  count -= diphthongs.length;
  
  return Math.max(1, count);
}

/**
 * Romance languages (Spanish, Italian, Portuguese) syllable counting.
 */
function countRomanceSyllables(word: string): number {
  // Count vowel groups (including accents)
  const matches = word.match(/[aeiouàáâãäèéêëìíîïòóôõöùúûü]+/gi);
  let count = matches ? matches.length : 0;
  
  // Handle diphthongs/triphthongs
  const diphthongs = word.match(/(ai|ei|oi|ui|au|eu|ou|ia|ie|io|iu|ua|ue|uo|ui)/gi) || [];
  count -= diphthongs.length;
  
  return Math.max(1, count);
}

/**
 * Russian syllable counting.
 */
function countRussianSyllables(word: string): number {
  // Count Russian vowels
  const matches = word.match(/[аеёиоуыэюя]/gi);
  return matches ? matches.length : 1;
}

/**
 * Slavic languages (Polish, Czech, Slovak) syllable counting.
 */
function countSlavicSyllables(word: string): number {
  // Count vowels including language-specific ones (Polish, Czech, Slovak)
  // Using a simplified set that avoids combined Unicode characters
  const matches = word.match(/[aeiouyáéíóúýàèìòùäëïöü]/gi);
  return matches ? matches.length : 1;
}

/**
 * Generic syllable estimation for unknown languages.
 * Uses vowel group counting which works reasonably well for most alphabetic languages.
 */
function countGenericSyllables(word: string): number {
  // Match common vowel characters across multiple scripts
  // Latin: aeiouy + accented variants, Greek: αεηιουω, Cyrillic: аеёиоуыэюя
  const vowelMatches = word.match(/[aeiouyàáâãäåæèéêëìíîïòóôõöøùúûüýÿαεηιουωаеёиоуыэюя]/giu);
  
  if (vowelMatches && vowelMatches.length > 0) {
    return Math.max(1, vowelMatches.length);
  }
  
  // Fallback: estimate based on word length
  // Average syllable is 2-3 characters in most languages
  return Math.max(1, Math.round(word.length / 2.5));
}

/**
 * Calculate Flesch Reading Ease score for English.
 */
function calculateFleschEnglish(words: number, sentences: number, syllables: number): number {
  // Flesch Reading Ease: 206.835 - (1.015 × ASL) - (84.6 × ASW)
  // ASL = average sentence length, ASW = average syllables per word
  const asl = words / sentences;
  const asw = syllables / words;
  return 206.835 - (1.015 * asl) - (84.6 * asw);
}

/**
 * Calculate Flesch Reading Ease adapted for German.
 */
function calculateFleschGerman(words: number, sentences: number, syllables: number): number {
  // Amstad's adaptation for German: 180 - ASL - (58.5 × ASW)
  const asl = words / sentences;
  const asw = syllables / words;
  return 180 - asl - (58.5 * asw);
}

/**
 * Calculate Flesch Reading Ease adapted for French.
 */
function calculateFleschFrench(words: number, sentences: number, syllables: number): number {
  // Adapted for French
  const asl = words / sentences;
  const asw = syllables / words;
  return 207 - (1.015 * asl) - (73.6 * asw);
}

/**
 * Calculate Flesch Reading Ease adapted for Spanish.
 */
function calculateFleschSpanish(words: number, sentences: number, syllables: number): number {
  // Fernández Huerta formula
  const asl = words / sentences;
  const asw = syllables / words;
  return 206.84 - (0.6 * asl) - (102 * asw);
}

/**
 * Calculate Gulpease Index for Italian.
 */
function calculateGulpeaseItalian(words: number, sentences: number, characters: number): number {
  // Gulpease Index: (300 × sentences - 10 × characters) / words
  if (words === 0) return 0;
  return (300 * sentences - 10 * characters) / words;
}

/**
 * Calculate Flesch Reading Ease adapted for Russian.
 */
function calculateFleschRussian(words: number, sentences: number, syllables: number): number {
  // Adapted for Russian
  const asl = words / sentences;
  const asw = syllables / words;
  return 206.835 - (1.3 * asl) - (60.1 * asw);
}

/**
 * Calculate Automated Readability Index (works for any language).
 */
function calculateARI(words: number, sentences: number, characters: number): number {
  if (words === 0 || sentences === 0) return 0;
  return 4.71 * (characters / words) + 0.5 * (words / sentences) - 21.43;
}

/**
 * Get readability level interpretation.
 */
function getReadabilityLevel(score: number, language?: LanguageKey): { level: ReadabilityScore['level']; description: string } {
  // Adjust thresholds based on language-specific scales
  const isGulpease = language === 'it';
  
  if (isGulpease) {
    // Gulpease scale (0-100, but inverted - higher is easier)
    if (score >= 80) return { level: 'very_easy', description: t('readability.veryEasyElementary') };
    if (score >= 60) return { level: 'easy', description: t('readability.easyMiddle') };
    if (score >= 40) return { level: 'moderate', description: t('readability.moderateHigh') };
    if (score >= 20) return { level: 'difficult', description: t('readability.difficultCollegeLevel') };
    return { level: 'very_difficult', description: t('readability.veryDifficultUni') };
  }
  
  // Standard Flesch-like scales (higher = easier)
  if (score >= 90) return { level: 'very_easy', description: t('readability.veryEasy5th') };
  if (score >= 80) return { level: 'easy', description: t('readability.easy6th') };
  if (score >= 70) return { level: 'easy', description: t('readability.fairlyEasy7th') };
  if (score >= 60) return { level: 'moderate', description: t('readability.standard8th') };
  if (score >= 50) return { level: 'moderate', description: t('readability.fairlyDifficult10th') };
  if (score >= 30) return { level: 'difficult', description: t('readability.difficultCollege') };
  return { level: 'very_difficult', description: t('readability.veryDifficultGrad') };
}

/**
 * Calculate readability score for text using appropriate formula for the language.
 */
export function calculateReadability(
  text: string, 
  language: LanguageKey = 'en'
): ReadabilityScore {
  const wordCount = countWords(text);
  const sentenceCount = countSentences(text);
  const charCount = countChars(text);
  const syllableCount = estimateSyllables(text, language);
  
  if (wordCount === 0 || sentenceCount === 0) {
    return {
      score: 0,
      level: 'very_difficult',
      description: t('readability.noContent'),
      wordsPerSentence: 0,
      charsPerWord: 0,
      sentenceCount: 0,
      method: t('readability.na')
    };
  }
  
  const wordsPerSentence = wordCount / sentenceCount;
  const charsPerWord = charCount / wordCount;
  
  let score: number;
  let method: string;
  
  switch (language) {
    case 'en':
      score = calculateFleschEnglish(wordCount, sentenceCount, syllableCount);
      method = 'Flesch-Kincaid (EN)';
      break;
    case 'de-guillemet':
    case 'de-low':
      score = calculateFleschGerman(wordCount, sentenceCount, syllableCount);
      method = 'Amstad (DE)';
      break;
    case 'fr':
      score = calculateFleschFrench(wordCount, sentenceCount, syllableCount);
      method = 'Flesch-Kincaid (FR)';
      break;
    case 'es':
      score = calculateFleschSpanish(wordCount, sentenceCount, syllableCount);
      method = 'Fernández Huerta (ES)';
      break;
    case 'it':
      score = calculateGulpeaseItalian(wordCount, sentenceCount, charCount);
      method = 'Gulpease Index (IT)';
      // Gulpease is 0-100 where higher is easier, similar to Flesch
      break;
    case 'pt':
      // Portuguese uses similar to Spanish
      score = calculateFleschSpanish(wordCount, sentenceCount, syllableCount);
      method = 'Flesch Adapted (PT)';
      break;
    case 'ru':
      score = calculateFleschRussian(wordCount, sentenceCount, syllableCount);
      method = 'Flesch Adapted (RU)';
      break;
    case 'pl':
    case 'cs':
    case 'sk':
      // Slavic languages - use ARI which is character-based
      score = 100 - calculateARI(wordCount, sentenceCount, charCount) * 3;
      method = `ARI Adapted (${language.toUpperCase()})`;
      break;
    default: {
      // For custom or unknown languages, use ARI which is character-based
      const ari = calculateARI(wordCount, sentenceCount, charCount);
      score = 100 - ari * 3;
      method = 'Universal (ARI-based)';
      break;
    }
  }
  
  // Clamp score to reasonable range
  score = Math.max(0, Math.min(100, score));
  
  const { level, description } = getReadabilityLevel(score, language);
  
  return {
    score: Math.round(score),
    level,
    description,
    wordsPerSentence: Math.round(wordsPerSentence * 10) / 10,
    charsPerWord: Math.round(charsPerWord * 10) / 10,
    sentenceCount,
    method
  };
}

/**
 * Get a color for the readability level (for UI display).
 */
export function getReadabilityColor(level: ReadabilityScore['level']): string {
  switch (level) {
    case 'very_easy':
      return '#16a34a'; // Green (dimmed)
    case 'easy':
      return '#22863a'; // Muted green
    case 'moderate':
      return '#b08800'; // Dark amber
    case 'difficult':
      return '#c05621'; // Dark orange
    case 'very_difficult':
      return '#b91c1c'; // Dark red
    default:
      return '#6b7280'; // Gray
  }
}

/**
 * Format readability score for display.
 */
export function formatReadabilityScore(score: ReadabilityScore): string {
  return `${score.score}/100`;
}
