// The status window's three numbers, bound to the session: what each source
// reads and how it is written. Which three show is the profile's choice.

import type { FishingGame, FishingUsage } from '../types'
import type { SessionState } from './session'

export const STAT_SOURCES = ['contextLeft', 'cost', 'turns', 'tools', 'weeklyLeft', 'fiveHourLeft', 'catches'] as const
export type StatSource = (typeof STAT_SOURCES)[number]

export const DEFAULT_STATS: readonly StatSource[] = ['contextLeft', 'cost', 'turns']

/**
 * The session's usage figures, as `$.session.usage()` and `session.measure`
 * give them: context used and rate-limit windows used (by kind, `five_hour`,
 * `seven_day`) as 0-100, the cost in US dollars.
 */
export type Usage = FishingUsage

export const NO_USAGE: Usage = { limits: {} }

type UsageLike = {
  context?: { percent?: number }
  rateLimits?: readonly { kind: string; percentUsed: number }[]
  cost?: { usd: number }
}

export function toUsage(raw: UsageLike): Usage {
  const limits: Record<string, number> = {}
  for (const limit of raw.rateLimits ?? []) limits[limit.kind] = limit.percentUsed
  return { contextPercent: raw.context?.percent, costUsd: raw.cost?.usd, limits }
}

const left = (used: number | undefined) =>
  used === undefined ? '--' : `${Math.max(0, Math.round(100 - used))}%`

export function formatCost(usd: number | undefined): string {
  if (usd === undefined) return '--'
  return usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`
}

/** The value a source shows, as text. */
export function statValue(source: StatSource, usage: Usage, session: SessionState, game: FishingGame): string {
  switch (source) {
    case 'contextLeft':
      return left(usage.contextPercent)
    case 'cost':
      return formatCost(usage.costUsd)
    case 'turns':
      return String(session.turns)
    case 'tools':
      return String(session.toolCalls)
    case 'weeklyLeft':
      return left(usage.limits.seven_day)
    case 'fiveHourLeft':
      return left(usage.limits.five_hour)
    case 'catches':
      return String(game.total)
  }
}
