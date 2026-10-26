// The angler's timeline: cast, wait, bite, reel or lose it, show the catch,
// cast again. Pure: it moves only when handed the time, and takes its dice
// from `random`, so tests can drive it.

import type { Fish } from './theme'

export const CAST_MS = 1000
export const BITE_MS = 2500
export const REEL_MS = 1400
export const SHOW_MS = 2600
export const REST_MS = 1500
/** a bite nobody answers is landed this often by the angler alone */
export const AUTO_CATCH_CHANCE = 0.5

export type Catch = { id: string; sprite: string; size: number; value: number }

export type FishingState =
  | { kind: 'casting'; since: number }
  | { kind: 'waiting'; since: number; biteAt: number }
  | { kind: 'bite'; since: number }
  | { kind: 'reeling'; since: number; fish: Catch; byPlayer: boolean; isWork: boolean }
  | { kind: 'showing'; since: number; fish: Catch }
  | { kind: 'resting'; since: number }

export type FishingEvent =
  | { type: 'cast' }
  | { type: 'bite' }
  | { type: 'catch'; fish: Catch; byPlayer: boolean; isWork: boolean }
  | { type: 'hook'; byPlayer: boolean }
  | { type: 'escape' }
  | { type: 'reel' }

/**
 * What the scene draws: the state, how far into it (0-1), the fish shown.
 * The session adds its own: `drift` (the line out while Claude thinks),
 * `struggle` (a fish on while a tool runs) and `snap` (an error).
 */
export type FishingView = {
  kind: FishingState['kind'] | 'drift' | 'struggle' | 'snap'
  progress: number
  fish?: Catch
  /** struggle: the fish sprite on the line and the effect around the float */
  struggle?: { fish: string; effect?: string }
}

export class Fishing {
  private state: FishingState
  private baitBoost = 1
  private rodBonus = 0

  constructor(
    private readonly fish: readonly Fish[],
    private readonly biteSeconds: readonly [number, number],
    private readonly random: () => number,
    now: number,
  ) {
    this.state = { kind: 'casting', since: now }
  }

  /** Bait shortens the wait (0, 1, 2...: each step about 15% sooner). */
  setBait(index: number): void {
    this.baitBoost = 1 / (1 + 0.18 * index)
  }

  /** A better rod lands bigger fish. */
  setRod(index: number): void {
    this.rodBonus = 0.15 * index
  }

  get kind(): FishingState['kind'] {
    return this.state.kind
  }

  view(now: number): FishingView {
    const s = this.state
    const span = { casting: CAST_MS, bite: BITE_MS, reeling: REEL_MS, showing: SHOW_MS, resting: REST_MS }
    const progress = s.kind === 'waiting' ? 0 : Math.min(1, (now - s.since) / span[s.kind])

    return { kind: s.kind, progress, fish: 'fish' in s ? s.fish : undefined }
  }

  /** Moves the timeline to `now`; returns what happened on the way. */
  update(now: number): FishingEvent[] {
    const events: FishingEvent[] = []
    // A long gap (a frozen pane waking) settles step by step, bounded.
    for (let step = 0; step < 12; step++) {
      const moved = this.step(now)
      if (moved === undefined) {
        break
      }
      if (moved !== 'moved') {
        events.push(moved)
      }
    }

    return events
  }

  /** One change of state due by `now`: its event, 'moved' when it has none, or undefined. */
  private step(now: number): FishingEvent | 'moved' | undefined {
    const s = this.state
    const elapsed = now - s.since
    switch (s.kind) {
      case 'casting':
        if (elapsed < CAST_MS) return undefined
        this.state = { kind: 'waiting', since: s.since + CAST_MS, biteAt: s.since + CAST_MS + this.nextWait() }
        return 'moved'
      case 'waiting':
        if (now < s.biteAt) return undefined
        this.state = { kind: 'bite', since: s.biteAt }
        return { type: 'bite' }
      case 'bite':
        if (elapsed < BITE_MS) return undefined
        if (this.random() < AUTO_CATCH_CHANCE) {
          return this.hook(s.since + BITE_MS, false)
        }
        this.state = { kind: 'resting', since: s.since + BITE_MS }
        return { type: 'escape' }
      case 'reeling':
        if (elapsed < REEL_MS) return undefined
        this.state = { kind: 'showing', since: s.since + REEL_MS, fish: s.fish }
        return { type: 'catch', fish: s.fish, byPlayer: s.byPlayer, isWork: s.isWork }
      case 'showing':
      case 'resting':
        if (elapsed < (s.kind === 'showing' ? SHOW_MS : REST_MS)) return undefined
        this.state = { kind: 'casting', since: s.since + (s.kind === 'showing' ? SHOW_MS : REST_MS) }
        return { type: 'cast' }
    }
  }

  /**
   * The person reels in (`r`, or 釣り): during a bite it lands the fish, and
   * a bigger one; otherwise it pulls the line in to cast again.
   */
  reel(now: number): FishingEvent[] {
    const events = this.update(now)
    if (this.state.kind === 'bite') {
      const event = this.hook(now, true)
      return [...events, event]
    }
    if (this.state.kind === 'waiting' || this.state.kind === 'casting') {
      this.state = { kind: 'resting', since: now - REST_MS / 2 }
      return [...events, { type: 'reel' }]
    }

    return events
  }

  /** Starts over with a fresh cast, as when the session goes quiet again. */
  restart(now: number): void {
    this.state = { kind: 'casting', since: now }
  }

  /** The person casts again (or pulls a waiting line in to cast anew). */
  recast(now: number): FishingEvent[] {
    const events = this.update(now)
    if (this.state.kind === 'reeling' || this.state.kind === 'showing') {
      return events
    }
    this.state = { kind: 'casting', since: now }
    return [...events, { type: 'cast' }]
  }

  /** The fish a finished turn lands: any fish, by the usual odds. */
  landFor(): Catch {
    return this.makeCatch(this.pick(), 0)
  }

  private hook(now: number, byPlayer: boolean): FishingEvent {
    // The catch is reported when the fish lands, REEL_MS later.
    const fish = this.makeCatch(this.pick(), byPlayer ? 0.1 : 0)
    this.state = { kind: 'reeling', since: now, fish, byPlayer, isWork: false }

    return { type: 'hook', byPlayer }
  }

  private nextWait(): number {
    const [min, max] = this.biteSeconds

    return Math.round((min + (max - min) * this.random()) * 1000 * this.baitBoost)
  }

  private pick(): Fish {
    const total = this.fish.reduce((sum, f) => sum + f.weight, 0)
    let roll = this.random() * total
    for (const f of this.fish) {
      roll -= f.weight
      if (roll < 0) {
        return f
      }
    }

    return this.fish[this.fish.length - 1]!
  }

  private makeCatch(fish: Fish, bonus: number): Catch {
    const [min, max] = fish.size
    const size = Math.round((min + (max - min) * this.random()) * (1 + this.rodBonus + bonus))
    const mid = (min + max) / 2 || 1

    return { id: fish.id, sprite: fish.sprite, size, value: Math.max(1, Math.round((fish.value * size) / mid)) }
  }
}

/** A small seeded generator (mulberry32), so a test can fix the dice. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
