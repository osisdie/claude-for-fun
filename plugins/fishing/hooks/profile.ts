// The user profile: which theme, which language, how fast, and per-field
// overrides of the theme. It lives in ~/.claude/fishing/profile.json, which
// the /fishing commands also write.

import { DEFAULT_SOUND, PLAYERS, SOUND_EVENTS, parseQuietHours, type SoundSettings } from './audio'
import { DEFAULT_STATS, STAT_SOURCES, type StatSource } from './stats'
import { LOCALES, type Locale, type ThemeOverrides } from './theme'

export const DEFAULT_THEME = 'river-rpg'

export type PixelMode = 'half' | 'full'
export type ColorMode = 'auto' | 'truecolor' | '256'

export type Profile = {
  theme: string
  locale: Locale
  /** frames a second while active, 2-8 */
  fps: number
  /** `half`: two pixels a cell with ▀; `full`: one pixel a cell, no glyph */
  pixelMode: PixelMode
  colorMode: ColorMode
  /** the status window's three numbers, by source */
  stats: StatSource[]
  sound: SoundSettings
  /** open the pane at the session's start (the engine places it from 144 columns) */
  autoOpen: boolean
  /** slow to 1 fps after this many idle minutes */
  idleSlowMinutes: number
  /** stop drawing after this many idle minutes */
  idleFreezeMinutes: number
  /** "+08:00"-style offset for the time of day; empty uses the system's */
  utcOffset: string
  overrides: ThemeOverrides
}

export const DEFAULT_PROFILE: Profile = {
  theme: DEFAULT_THEME,
  locale: 'zh-TW',
  fps: 6,
  pixelMode: 'half',
  colorMode: 'auto',
  stats: [...DEFAULT_STATS],
  sound: DEFAULT_SOUND,
  autoOpen: true,
  idleSlowMinutes: 5,
  idleFreezeMinutes: 15,
  utcOffset: '',
  overrides: {},
}

type Field = { [K in keyof Profile]: (value: unknown) => Profile[K] | undefined }

const oneOf = <T extends string>(choices: readonly T[]) => (value: unknown) =>
  choices.includes(value as T) ? (value as T) : undefined
const range = (min: number, max: number) => (value: unknown) =>
  typeof value === 'number' && value >= min && value <= max ? value : undefined

const FIELDS: Field = {
  theme: value => (typeof value === 'string' && /^[\w-]{1,64}$/.test(value) ? value : undefined),
  locale: oneOf(LOCALES),
  fps: range(1, 12),
  pixelMode: oneOf(['half', 'full'] as const),
  colorMode: oneOf(['auto', 'truecolor', '256'] as const),
  stats: value =>
    Array.isArray(value) && value.length >= 1 && value.length <= 4 && value.every(v => (STAT_SOURCES as readonly unknown[]).includes(v))
      ? (value as StatSource[])
      : undefined,
  sound: parseSound,
  autoOpen: value => (typeof value === 'boolean' ? value : undefined),
  idleSlowMinutes: range(0.1, 600),
  idleFreezeMinutes: range(0.1, 1440),
  utcOffset: value => (typeof value === 'string' && /^$|^[+-]\d{2}:\d{2}$/.test(value) ? value : undefined),
  overrides: value => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as ThemeOverrides) : undefined),
}

/**
 * Reads a profile on top of the defaults. Unknown or invalid fields are left
 * at their default and reported, so one typo never loses the whole profile.
 */
export function parseProfile(raw: unknown): { profile: Profile; warnings: string[] } {
  const profile: Profile = { ...DEFAULT_PROFILE }
  const warnings: string[] = []
  if (raw === undefined) {
    return { profile, warnings }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { profile, warnings: ['profile.json: not an object; using the defaults'] }
  }
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('$') || key.startsWith('_')) {
      continue // "$schema", "_comment" and the like
    }
    const check = FIELDS[key as keyof Profile] as ((v: unknown) => unknown) | undefined
    const parsed = check?.(value)
    if (check === undefined) {
      warnings.push(`profile.json: unknown field "${key}" ignored`)
    } else if (parsed === undefined) {
      warnings.push(`profile.json: "${key}" has an invalid value; using ${JSON.stringify(DEFAULT_PROFILE[key as keyof Profile])}`)
    } else {
      (profile as Record<string, unknown>)[key] = parsed
    }
  }
  if (profile.idleFreezeMinutes < profile.idleSlowMinutes) {
    profile.idleFreezeMinutes = profile.idleSlowMinutes
  }

  return { profile, warnings }
}

/** The sound block: each field checked; a bad one makes the whole block invalid, named. */
function parseSound(value: unknown): SoundSettings | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  const s: SoundSettings = { ...DEFAULT_SOUND }
  if (v.enabled !== undefined) { if (typeof v.enabled !== 'boolean') return undefined; s.enabled = v.enabled }
  if (v.player !== undefined) { if (!(PLAYERS as readonly unknown[]).includes(v.player)) return undefined; s.player = v.player as SoundSettings['player'] }
  if (v.volume !== undefined) { if (typeof v.volume !== 'number' || v.volume < 0 || v.volume > 1) return undefined; s.volume = v.volume }
  if (v.quietHours !== undefined) {
    if (typeof v.quietHours !== 'string' || (v.quietHours !== '' && !parseQuietHours(v.quietHours))) return undefined
    s.quietHours = v.quietHours
  }
  if (v.mute !== undefined) {
    if (!Array.isArray(v.mute) || !v.mute.every(e => (SOUND_EVENTS as readonly unknown[]).includes(e))) return undefined
    s.mute = v.mute as SoundSettings['mute']
  }
  if (v.alertsOnly !== undefined) { if (typeof v.alertsOnly !== 'boolean') return undefined; s.alertsOnly = v.alertsOnly }
  if (v.minGapMs !== undefined) { if (typeof v.minGapMs !== 'number' || v.minGapMs < 0 || v.minGapMs > 60000) return undefined; s.minGapMs = v.minGapMs }
  return s
}

/** Parses a "+08:00" offset to minutes east of UTC. */
export function offsetMinutes(offset: string): number | undefined {
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(offset)
  if (!match) {
    return undefined
  }
  const minutes = Number(match[2]) * 60 + Number(match[3])

  return match[1] === '-' ? -minutes : minutes
}
