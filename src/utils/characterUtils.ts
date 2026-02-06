export const CHARACTER_ROLE_LABELS = {
  main: 'Main characters',
  side: 'Side characters',
  background: 'Background characters'
} as const;

export type CharacterRole = keyof typeof CHARACTER_ROLE_LABELS;

export const normalizeCharacterRole = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return CHARACTER_ROLE_LABELS.side;
  if (normalized.includes('main')) return CHARACTER_ROLE_LABELS.main;
  if (normalized.includes('background')) return CHARACTER_ROLE_LABELS.background;
  if (normalized.includes('side')) return CHARACTER_ROLE_LABELS.side;
  return value.trim();
};
