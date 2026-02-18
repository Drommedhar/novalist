import { TFile } from 'obsidian';
import type NovalistPlugin from '../main';
import { ProjectStatistics, ChapterWordCount, WordCountGoals, DailyWritingGoal } from '../types';
import { calculateReadability } from './readabilityUtils';
import { t } from '../i18n';

/** Strip Obsidian `%%…%%` and HTML `<!-- … -->` comments, including when wrapped in code fences */
export function stripComments(text: string): string {
  return text
    // Code-fenced comments: ```\n<!-- … -->\n``` or ```\n%% … %%\n```
    .replace(/```\s*\n\s*%%[\s\S]*?%%\s*\n\s*```/g, '')
    .replace(/```\s*\n\s*<!--[\s\S]*?-->\s*\n\s*```/g, '')
    // Standalone comments
    .replace(/%%[\s\S]*?%%/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

export function countWords(text: string): number {
  // Remove frontmatter
  const withoutFrontmatter = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
  // Remove comments
  const withoutComments = stripComments(withoutFrontmatter);
  // Remove markdown syntax
  const cleanText = withoutComments
    .replace(/[#*_[\]()|`-]/g, '')
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
  const withoutComments = stripComments(withoutFrontmatter);
  const cleanText = withoutComments
    .replace(/[#*_[\]()|`]/g, '')
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
    return (count / 1000000).toFixed(1) + t('format.millions');
  }
  if (count >= 1000) {
    return (count / 1000).toFixed(1) + t('format.thousands');
  }
  return count.toLocaleString();
}

export function formatReadingTime(minutes: number): string {
  if (minutes < 60) {
    return t('stats.minutes', { n: minutes });
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return t('stats.hours', { n: hours });
  }
  return t('stats.hoursMinutes', { h: hours, m: remainingMinutes });
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
  // Keep last 365 days for trend charts
  if (goals.dailyHistory.length > 365) {
    goals.dailyHistory.sort((a, b) => a.date.localeCompare(b.date));
    goals.dailyHistory = goals.dailyHistory.slice(-365);
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

/**
 * Calculate the current writing streak (consecutive days with actualWords > 0).
 * Counts backwards from today.
 */
export function calculateWritingStreak(goals: WordCountGoals): number {
  if (!goals.dailyHistory || goals.dailyHistory.length === 0) {
    return 0;
  }

  // Sort history by date descending
  const sorted = [...goals.dailyHistory].sort((a, b) => b.date.localeCompare(a.date));
  
  const today = getTodayDate();
  let streak = 0;
  let currentDate = new Date(today);
  
  for (const entry of sorted) {
    // If we're past the expected date, streak is broken
    const expectedDateStr = currentDate.toISOString().split('T')[0];
    if (entry.date !== expectedDateStr) {
      // Check if this entry is for today (might not have written yet today)
      if (streak === 0 && entry.date === today && entry.actualWords > 0) {
        streak = 1;
      }
      break;
    }
    
    if (entry.actualWords > 0) {
      streak++;
      currentDate.setDate(currentDate.getDate() - 1);
    } else {
      break;
    }
  }
  
  return streak;
}

/**
 * Format a timestamp as relative time (e.g., "2m ago", "3h ago", "2d ago")
 */
export function formatTimeAgo(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) {
    return t('dashboard.timeAgo.minutes', { n: 1 });
  } else if (diffMins < 60) {
    return t('dashboard.timeAgo.minutes', { n: diffMins });
  } else if (diffHours < 24) {
    return t('dashboard.timeAgo.hours', { n: diffHours });
  } else {
    return t('dashboard.timeAgo.days', { n: diffDays });
  }
}
