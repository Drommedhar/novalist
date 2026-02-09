import { TFile } from 'obsidian';
import type NovalistPlugin from '../main';
import { ProjectStatistics, ChapterWordCount, WordCountGoals, DailyWritingGoal } from '../types';
import { calculateReadability } from './readabilityUtils';

export function countWords(text: string): number {
  // Remove frontmatter
  const withoutFrontmatter = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
  // Remove markdown syntax
  const cleanText = withoutFrontmatter
    // eslint-disable-next-line no-useless-escape -- Regex needs these escapes
    .replace(/[#*_\[\]()|`\-]/g, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  
  // Count words - works across languages
  // Match word characters including Unicode letters
  const words = cleanText.match(/[\p{L}\p{N}]+(?:[''-][\p{L}\p{N}]+)*/gu);
  return words ? words.length : 0;
}

export function countCharacters(text: string, includeSpaces = true): number {
  const withoutFrontmatter = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const cleanText = withoutFrontmatter
    // eslint-disable-next-line no-useless-escape -- Regex needs these escapes
    .replace(/[#*_\[\]()|`]/g, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1');
  
  if (includeSpaces) {
    return cleanText.length;
  }
  return cleanText.replace(/\s/g, '').length;
}

export function estimateReadingTime(wordCount: number, wordsPerMinute = 200): number {
  return Math.ceil(wordCount / wordsPerMinute);
}

export async function calculateChapterStats(
  plugin: NovalistPlugin,
  file: TFile
): Promise<ChapterWordCount> {
  const content = await plugin.app.vault.read(file);
  const wordCount = countWords(content);
  const charCount = countCharacters(content, true);
  const charCountNoSpaces = countCharacters(content, false);
  
  // Calculate readability using the plugin's configured language
  const readability = calculateReadability(content, plugin.settings.language);
  
  return {
    file,
    name: file.basename,
    wordCount,
    charCount,
    charCountNoSpaces,
    readability
  };
}

export async function calculateProjectStatistics(plugin: NovalistPlugin): Promise<ProjectStatistics> {
  const chapters = await plugin.getChapterDescriptions();
  const characters = await plugin.getCharacterList();
  const locations = plugin.getLocationList();
  
  const chapterStats: ChapterWordCount[] = [];
  let totalWords = 0;
  
  for (const chapter of chapters) {
    const stats = await calculateChapterStats(plugin, chapter.file);
    chapterStats.push(stats);
    totalWords += stats.wordCount;
  }
  
  // Sort by word count
  chapterStats.sort((a, b) => b.wordCount - a.wordCount);
  
  const longestChapter = chapterStats.length > 0 ? chapterStats[0] : null;
  const shortestChapter = chapterStats.length > 0 ? chapterStats[chapterStats.length - 1] : null;
  
  // Calculate average
  const averageChapterLength = chapters.length > 0 ? Math.round(totalWords / chapters.length) : 0;
  
  // Estimated reading time (200 words per minute is average)
  const estimatedReadingTime = estimateReadingTime(totalWords);
  
  return {
    totalWords,
    totalChapters: chapters.length,
    totalCharacters: characters.length,
    totalLocations: locations.length,
    estimatedReadingTime,
    averageChapterLength,
    longestChapter,
    shortestChapter,
    chapterStats
  };
}

export function formatWordCount(count: number): string {
  if (count >= 1000000) {
    return (count / 1000000).toFixed(1) + 'M';
  }
  if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'k';
  }
  return count.toLocaleString();
}

export function formatReadingTime(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours} hr`;
  }
  return `${hours} hr ${remainingMinutes} min`;
}

export function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

export function getOrCreateDailyGoal(goals: WordCountGoals, date: string): DailyWritingGoal {
  const existing = goals.dailyHistory.find(g => g.date === date);
  if (existing) {
    return existing;
  }
  const newGoal: DailyWritingGoal = {
    date,
    targetWords: goals.dailyGoal,
    actualWords: 0
  };
  goals.dailyHistory.push(newGoal);
  // Keep only last 30 days
  if (goals.dailyHistory.length > 30) {
    goals.dailyHistory.sort((a, b) => a.date.localeCompare(b.date));
    goals.dailyHistory = goals.dailyHistory.slice(-30);
  }
  return newGoal;
}

export function calculateDailyProgress(goals: WordCountGoals): { current: number; target: number; percentage: number } {
  const today = getTodayDate();
  const todayGoal = goals.dailyHistory.find(g => g.date === today);
  const current = todayGoal?.actualWords || 0;
  const target = goals.dailyGoal;
  const percentage = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return { current, target, percentage };
}

export function calculateProjectProgress(goals: WordCountGoals, currentWords: number): { current: number; target: number; percentage: number } {
  const target = goals.projectGoal;
  const percentage = target > 0 ? Math.min(100, Math.round((currentWords / target) * 100)) : 0;
  return { current: currentWords, target, percentage };
}
