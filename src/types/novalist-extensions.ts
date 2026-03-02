/**
 * Novalist extension types that augment StoryLine's canonical models.
 *
 * ⚠ CRITICAL: Do NOT re-implement any type that already exists in StoryLine.
 * Import from `@storyline/models/*` instead. These interfaces EXTEND the
 * canonical types with Novalist-specific fields prefixed `novalist_`.
 */

import type { Scene } from '@storyline/models/Scene';
import type { Character, CharacterRelation } from '@storyline/models/Character';
import type { StoryLocation, StoryWorld } from '@storyline/models/Location';
import type { StoryLineProject } from '@storyline/models/StoryLineProject';

// ── Re-exports for convenience ──────────────────────────────────────
export type { Scene, SceneStatus, SceneTemplate, BeatSheetTemplate, BeatDefinition, TimelineMode, ColorCodingMode, BoardGroupBy } from '@storyline/models/Scene';
export type { Character, CharacterRelation, CharacterRelationCategory, CharacterFieldCategory, CharacterFieldDef } from '@storyline/models/Character';
export type { StoryLocation, StoryWorld, WorldOrLocation, LocationType, LocationFieldCategory, LocationFieldDef } from '@storyline/models/Location';
export type { StoryLineProject } from '@storyline/models/StoryLineProject';
export type { PlotGridData, CellData, ColumnMeta, RowMeta } from '@storyline/models/PlotGridData';

// Re-export constants
export { TIMELINE_MODES, TIMELINE_MODE_LABELS, TIMELINE_MODE_ICONS, STATUS_CONFIG, STATUS_ORDER, BUILTIN_SCENE_TEMPLATES, BUILTIN_BEAT_SHEETS, DEFAULT_SCENE_TEMPLATE } from '@storyline/models/Scene';
export { CHARACTER_CATEGORIES, CHARACTER_FIELD_KEYS, CHARACTER_ROLES, CHARACTER_RELATION_ARRAY_FIELDS, RELATION_CATEGORIES, RELATION_TYPES_BY_CATEGORY, RELATION_BASE_TYPE_BY_CATEGORY, RELATION_FIELD_BASE_TYPE, RELATION_FIELD_LABELS, LEGACY_RELATION_FIELDS_TO_CLEAN, normalizeCharacterRelations, relationDisplayLabel, extractCharacterProps, extractCharacterLocationTags, extractAllCharacterTags } from '@storyline/models/Character';
export { WORLD_CATEGORIES, LOCATION_CATEGORIES, LOCATION_TYPES, WORLD_FIELD_KEYS, LOCATION_FIELD_KEYS } from '@storyline/models/Location';
export { deriveProjectFolders, deriveProjectFoldersFromFilePath } from '@storyline/models/StoryLineProject';

// ── Novalist Chapter Override ───────────────────────────────────────

/** Per-chapter character state overrides (Novalist-only; SL has no equivalent). */
export interface NovalistChapterOverride {
  chapter: string;
  act?: string;
  scene?: string;
  name?: string;
  gender?: string;
  age?: string;
  role?: string;
  eyeColor?: string;
  hairColor?: string;
  hairLength?: string;
  height?: string;
  build?: string;
  skinTone?: string;
  distinguishingFeatures?: string;
  images?: { name: string; path: string }[];
  relationships?: CharacterRelation[];
  customProperties?: Record<string, string>;
}

// ── Novalist Scene Extension ────────────────────────────────────────

/** Novalist scene extends SL Scene with additional analysis metadata. */
export interface NovalistScene extends Scene {
  /** Chapter identifier for migration tracking. */
  novalist_chapterId?: string;
  /** Chapter display name (for grouping in Explorer). */
  novalist_chapterName?: string;
  /** Dialogue-to-prose ratio (0–1). */
  novalist_dialogueRatio?: number;
  /** Average sentence length in words. */
  novalist_avgSentenceLength?: number;
  /** Exclamation/question density per 100 words. */
  novalist_punctuationIntensity?: number;
}

// ── Novalist Character Extension ────────────────────────────────────

/**
 * Novalist character extends SL Character.
 *
 * - Surname is merged into `name` ("FirstName LastName"); Novalist UI
 *   uses a single name field.
 * - Gender, Group, and physical attributes are stored in `custom` fields.
 * - Chapter overrides and template ID are Novalist-only extensions.
 */
export interface NovalistCharacter extends Character {
  /** Novalist entity template identifier. */
  novalist_templateId?: string;
  /** Per-chapter state overrides. */
  novalist_chapterOverrides?: NovalistChapterOverride[];
  /** Multiple named images (extends SL's single `image` field). */
  novalist_images?: { name: string; path: string }[];
}

// ── Novalist Location Extension ─────────────────────────────────────

/** Novalist location extends SL Location with relationship support. */
export interface NovalistLocation extends StoryLocation {
  /** Location-to-entity relationships (SL has no location relationships). */
  novalist_relationships?: { role: string; target: string }[];
  /** Novalist entity template identifier. */
  novalist_templateId?: string;
  /** Multiple named images (extends SL's single `image` field). */
  novalist_images?: { name: string; path: string }[];
}

/** Novalist world extends SL World. */
export interface NovalistWorld extends StoryWorld {
  /** Novalist entity template identifier. */
  novalist_templateId?: string;
}

// ── Item Entity (Novalist-only) ─────────────────────────────────────

/** Item / artifact entity — Novalist extension; no SL equivalent. */
export interface NovalistItem {
  type: 'item';
  filePath: string;
  name: string;
  itemType?: string;
  origin?: string;
  description?: string;
  image?: string;
  custom?: Record<string, string>;
  notes?: string;
  novalist_templateId?: string;
  /** Multiple named images (extends single `image` field). */
  novalist_images?: { name: string; path: string }[];
  created?: string;
  modified?: string;
}

// ── Lore Entity (Novalist-only) ─────────────────────────────────────

/** Lore / encyclopedia entity — Novalist extension; no SL equivalent. */
export interface NovalistLore {
  type: 'lore';
  filePath: string;
  name: string;
  loreCategory?: string;
  description?: string;
  image?: string;
  custom?: Record<string, string>;
  notes?: string;
  novalist_templateId?: string;
  /** Multiple named images (extends single `image` field). */
  novalist_images?: { name: string; path: string }[];
  created?: string;
  modified?: string;
}

// ── Novalist Project Extension ──────────────────────────────────────

/** Novalist project extends SL Project with Novalist-specific metadata. */
export interface NovalistProject extends StoryLineProject {
  /** Novalist internal project ID. */
  novalist_projectId?: string;
  /** Word count goals. */
  novalist_wordCountGoals?: {
    dailyGoal: number;
    projectGoal: number;
    deadline?: string;
  };
  /** Item entity folder name. */
  novalist_itemFolder?: string;
  /** Lore entity folder name. */
  novalist_loreFolder?: string;
  /** Image assets folder name. */
  novalist_imageFolder?: string;
}

// ── Status Migration Mapping ────────────────────────────────────────

import type { SceneStatus } from '@storyline/models/Scene';
import type { ChapterStatus } from '../types';

/**
 * Map old Novalist chapter statuses to SL scene statuses.
 * Applied once during migration, then old statuses are discarded.
 */
export const STATUS_MIGRATION_MAP: Record<ChapterStatus, SceneStatus> = {
  'outline': 'idea',
  'first-draft': 'draft',
  'revised': 'revised',
  'edited': 'written',
  'final': 'final',
};

// ── Relationship Migration ──────────────────────────────────────────

import type { CharacterRelationCategory } from '@storyline/models/Character';

/**
 * Map common Novalist relationship role strings to SL relation categories and types.
 * Used during character migration to convert `- Role: [[Target]]` format.
 */
export const RELATIONSHIP_ROLE_MAP: Record<string, { category: CharacterRelationCategory; type: string }> = {
  // Family
  'sister': { category: 'family', type: 'sibling' },
  'brother': { category: 'family', type: 'sibling' },
  'sibling': { category: 'family', type: 'sibling' },
  'mother': { category: 'family', type: 'parent' },
  'father': { category: 'family', type: 'parent' },
  'parent': { category: 'family', type: 'parent' },
  'son': { category: 'family', type: 'child' },
  'daughter': { category: 'family', type: 'child' },
  'child': { category: 'family', type: 'child' },
  'grandmother': { category: 'family', type: 'grandparent' },
  'grandfather': { category: 'family', type: 'grandparent' },
  'grandparent': { category: 'family', type: 'grandparent' },
  'grandson': { category: 'family', type: 'grandchild' },
  'granddaughter': { category: 'family', type: 'grandchild' },
  'grandchild': { category: 'family', type: 'grandchild' },
  'uncle': { category: 'family', type: 'aunt/uncle' },
  'aunt': { category: 'family', type: 'aunt/uncle' },
  'nephew': { category: 'family', type: 'niece/nephew' },
  'niece': { category: 'family', type: 'niece/nephew' },
  'cousin': { category: 'family', type: 'cousin' },
  'half-brother': { category: 'family', type: 'half-sibling' },
  'half-sister': { category: 'family', type: 'half-sibling' },
  'step-mother': { category: 'family', type: 'step-parent' },
  'step-father': { category: 'family', type: 'step-parent' },
  'step-son': { category: 'family', type: 'step-child' },
  'step-daughter': { category: 'family', type: 'step-child' },
  'twin': { category: 'family', type: 'twin' },
  'guardian': { category: 'family', type: 'guardian' },
  'ward': { category: 'family', type: 'ward' },
  'in-law': { category: 'family', type: 'in-law' },

  // Romantic
  'spouse': { category: 'romantic', type: 'spouse' },
  'husband': { category: 'romantic', type: 'spouse' },
  'wife': { category: 'romantic', type: 'spouse' },
  'partner': { category: 'romantic', type: 'partner' },
  'lover': { category: 'romantic', type: 'partner' },
  'fiancé': { category: 'romantic', type: 'partner' },
  'fiancée': { category: 'romantic', type: 'partner' },
  'ex': { category: 'romantic', type: 'ex-partner' },
  'ex-partner': { category: 'romantic', type: 'ex-partner' },
  'ex-husband': { category: 'romantic', type: 'ex-partner' },
  'ex-wife': { category: 'romantic', type: 'ex-partner' },

  // Social
  'friend': { category: 'social', type: 'friend' },
  'best friend': { category: 'social', type: 'best-friend' },
  'ally': { category: 'social', type: 'ally' },
  'confidant': { category: 'social', type: 'confidant' },
  'acquaintance': { category: 'social', type: 'acquaintance' },

  // Conflict
  'enemy': { category: 'conflict', type: 'enemy' },
  'rival': { category: 'conflict', type: 'rival' },
  'nemesis': { category: 'conflict', type: 'enemy' },
  'betrayer': { category: 'conflict', type: 'betrayer' },
  'avenger': { category: 'conflict', type: 'avenger' },

  // Guidance / hierarchy
  'mentor': { category: 'guidance', type: 'mentor' },
  'mentee': { category: 'guidance', type: 'mentee' },
  'student': { category: 'guidance', type: 'mentee' },
  'teacher': { category: 'guidance', type: 'mentor' },
  'leader': { category: 'guidance', type: 'leader' },
  'follower': { category: 'guidance', type: 'follower' },
  'boss': { category: 'guidance', type: 'boss' },
  'subordinate': { category: 'guidance', type: 'subordinate' },
  'commander': { category: 'guidance', type: 'commander' },
  'master': { category: 'guidance', type: 'master' },
  'apprentice': { category: 'guidance', type: 'apprentice' },

  // Professional
  'colleague': { category: 'professional', type: 'colleague' },
  'business partner': { category: 'professional', type: 'business-partner' },
  'client': { category: 'professional', type: 'client' },

  // Story dynamics
  'protector': { category: 'story', type: 'protector' },
  'dependent': { category: 'story', type: 'dependent' },

  // ── German equivalents ────────────────────────────────────────────

  // Family (German)
  'schwester': { category: 'family', type: 'sibling' },
  'bruder': { category: 'family', type: 'sibling' },
  'geschwister': { category: 'family', type: 'sibling' },
  'mutter': { category: 'family', type: 'parent' },
  'mutti': { category: 'family', type: 'parent' },
  'mama': { category: 'family', type: 'parent' },
  'vater': { category: 'family', type: 'parent' },
  'vati': { category: 'family', type: 'parent' },
  'papa': { category: 'family', type: 'parent' },
  'elternteil': { category: 'family', type: 'parent' },
  'sohn': { category: 'family', type: 'child' },
  'tochter': { category: 'family', type: 'child' },
  'kind': { category: 'family', type: 'child' },
  'großmutter': { category: 'family', type: 'grandparent' },
  'grossmutter': { category: 'family', type: 'grandparent' },
  'oma': { category: 'family', type: 'grandparent' },
  'großvater': { category: 'family', type: 'grandparent' },
  'grossvater': { category: 'family', type: 'grandparent' },
  'opa': { category: 'family', type: 'grandparent' },
  'enkel': { category: 'family', type: 'grandchild' },
  'enkelin': { category: 'family', type: 'grandchild' },
  'onkel': { category: 'family', type: 'aunt/uncle' },
  'tante': { category: 'family', type: 'aunt/uncle' },
  'neffe': { category: 'family', type: 'niece/nephew' },
  'nichte': { category: 'family', type: 'niece/nephew' },
  'cousine': { category: 'family', type: 'cousin' },
  'kusine': { category: 'family', type: 'cousin' },
  'vetter': { category: 'family', type: 'cousin' },
  'halbbruder': { category: 'family', type: 'half-sibling' },
  'halbschwester': { category: 'family', type: 'half-sibling' },
  'stiefmutter': { category: 'family', type: 'step-parent' },
  'stiefvater': { category: 'family', type: 'step-parent' },
  'stiefsohn': { category: 'family', type: 'step-child' },
  'stieftochter': { category: 'family', type: 'step-child' },
  'stiefbruder': { category: 'family', type: 'sibling' },
  'stiefschwester': { category: 'family', type: 'sibling' },
  'zwilling': { category: 'family', type: 'twin' },
  'vormund': { category: 'family', type: 'guardian' },
  'mündel': { category: 'family', type: 'ward' },
  'schwiegermutter': { category: 'family', type: 'in-law' },
  'schwiegervater': { category: 'family', type: 'in-law' },
  'schwager': { category: 'family', type: 'in-law' },
  'schwägerin': { category: 'family', type: 'in-law' },
  'schwaegerin': { category: 'family', type: 'in-law' },
  'schwiegersohn': { category: 'family', type: 'in-law' },
  'schwiegertochter': { category: 'family', type: 'in-law' },

  // Romantic (German)
  'ehemann': { category: 'romantic', type: 'spouse' },
  'ehefrau': { category: 'romantic', type: 'spouse' },
  'mann': { category: 'romantic', type: 'spouse' },
  'frau': { category: 'romantic', type: 'spouse' },
  'gatte': { category: 'romantic', type: 'spouse' },
  'gattin': { category: 'romantic', type: 'spouse' },
  'verlobter': { category: 'romantic', type: 'partner' },
  'verlobte': { category: 'romantic', type: 'partner' },
  'lebensgefährte': { category: 'romantic', type: 'partner' },
  'lebensgefährtin': { category: 'romantic', type: 'partner' },
  'geliebter': { category: 'romantic', type: 'partner' },
  'geliebte': { category: 'romantic', type: 'partner' },
  'ex-mann': { category: 'romantic', type: 'ex-partner' },
  'ex-frau': { category: 'romantic', type: 'ex-partner' },
  'ring': { category: 'romantic', type: 'spouse' },

  // Social (German)
  'freund': { category: 'social', type: 'friend' },
  'freundin': { category: 'social', type: 'friend' },
  'bester freund': { category: 'social', type: 'best-friend' },
  'beste freundin': { category: 'social', type: 'best-friend' },
  'verbündeter': { category: 'social', type: 'ally' },
  'verbündete': { category: 'social', type: 'ally' },
  'vertrauter': { category: 'social', type: 'confidant' },
  'vertraute': { category: 'social', type: 'confidant' },
  'bekannter': { category: 'social', type: 'acquaintance' },
  'bekannte': { category: 'social', type: 'acquaintance' },

  // Conflict (German)
  'feind': { category: 'conflict', type: 'enemy' },
  'feindin': { category: 'conflict', type: 'enemy' },
  'rivale': { category: 'conflict', type: 'rival' },
  'rivalin': { category: 'conflict', type: 'rival' },
  'verräter': { category: 'conflict', type: 'betrayer' },
  'verräterin': { category: 'conflict', type: 'betrayer' },
  'rächer': { category: 'conflict', type: 'avenger' },
  'rächerin': { category: 'conflict', type: 'avenger' },

  // Guidance (German)
  'mentorin': { category: 'guidance', type: 'mentor' },
  'schüler': { category: 'guidance', type: 'mentee' },
  'schülerin': { category: 'guidance', type: 'mentee' },
  'lehrer': { category: 'guidance', type: 'mentor' },
  'lehrerin': { category: 'guidance', type: 'mentor' },
  'anführer': { category: 'guidance', type: 'leader' },
  'anführerin': { category: 'guidance', type: 'leader' },
  'gefolgsmann': { category: 'guidance', type: 'follower' },
  'chef': { category: 'guidance', type: 'boss' },
  'chefin': { category: 'guidance', type: 'boss' },
  'untergebener': { category: 'guidance', type: 'subordinate' },
  'untergebene': { category: 'guidance', type: 'subordinate' },
  'kommandant': { category: 'guidance', type: 'commander' },
  'kommandantin': { category: 'guidance', type: 'commander' },
  'meister': { category: 'guidance', type: 'master' },
  'meisterin': { category: 'guidance', type: 'master' },
  'lehrling': { category: 'guidance', type: 'apprentice' },

  // Professional (German)
  'kollege': { category: 'professional', type: 'colleague' },
  'kollegin': { category: 'professional', type: 'colleague' },
  'geschäftspartner': { category: 'professional', type: 'business-partner' },
  'geschäftspartnerin': { category: 'professional', type: 'business-partner' },
  'kunde': { category: 'professional', type: 'client' },
  'kundin': { category: 'professional', type: 'client' },

  // Story dynamics (German)
  'beschützer': { category: 'story', type: 'protector' },
  'beschützerin': { category: 'story', type: 'protector' },
  'schützling': { category: 'story', type: 'dependent' },
};
