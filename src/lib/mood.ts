/** The only persisted/displayed mood values. Keeping this tiny makes status UI readable. */
export const MOOD_EMOJIS = ['😀', '😊', '🥰', '😌', '😶', '😴', '🤔', '😳', '🥺', '😟', '😠', '😤', '😞', '😭', '😈'] as const

export type MoodEmoji = (typeof MOOD_EMOJIS)[number]

export function normalizeMood(value: unknown, fallback: MoodEmoji = '😌'): MoodEmoji {
  const text = typeof value === 'string' ? value : ''
  return (MOOD_EMOJIS.find((emoji) => text.includes(emoji)) ?? fallback) as MoodEmoji
}
