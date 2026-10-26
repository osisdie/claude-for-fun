import type { Phase } from './theme'

/** The local hour (0-23) at `nowMs`, `offset` minutes east of UTC. */
export function localHour(nowMs: number, offset: number): number {
  const minutes = Math.floor(nowMs / 60000) + offset
  return Math.floor((((minutes % 1440) + 1440) % 1440) / 60)
}

/** 朝 5-9, 昼 10-15, 夕 16-18, 夜 19-4. */
export function phaseAt(hour: number): Phase {
  if (hour >= 5 && hour < 10) return 'morning'
  if (hour >= 10 && hour < 16) return 'day'
  if (hour >= 16 && hour < 19) return 'evening'
  return 'night'
}
