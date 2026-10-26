/** The angler's record: the creel, and the tackle chosen. */
export type FishingGame = {
  /** fish caught, all time */
  total: number
  bySpecies: Record<string, number>
  best: { id: string; size: number } | null
  /** index into the theme's bait and rod lists */
  bait: number
  rod: number
}

/** What the HUD shows besides the stats. */
export type FishingHud = {
  /** the command window's cursor, 0-5 in reading order */
  cursor: number
  message: string
  isBite: boolean
}

/** What Claude is doing (hooks/session.ts moves it). */
export type FishingSession = {
  kind: 'idle' | 'thinking' | 'tool' | 'waiting' | 'done' | 'error' | 'compacting'
  tool?: 'read' | 'edit' | 'bash' | 'web' | 'agent' | 'other'
  since: number
  isTurn: boolean
  inFlight: number
  turns: number
  toolCalls: number
  errors: number
}

/** The session's usage figures, for the status window. */
export type FishingUsage = {
  contextPercent?: number
  costUsd?: number
  limits: Record<string, number>
}

declare module 'claude-code' {
  interface PluginState {
    fishing: {
      game: Shaped<FishingGame>
      hud: Shaped<FishingHud>
      session: Shaped<FishingSession>
      usage: Shaped<FishingUsage>
    }
  }
}
