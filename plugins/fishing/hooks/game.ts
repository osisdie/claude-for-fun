// The rules behind the command window: what a catch adds to the creel, how
// the cursor moves. Pure functions over the stored record.

import type { FishingGame } from '../types'
import type { Catch } from './fishing'
import { MENU, type MenuId } from './theme'

export const NEW_GAME: FishingGame = { total: 0, bySpecies: {}, best: null, bait: 0, rod: 0 }

const count = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback

/** Reads what `$.store` held, keeping every field it can (older fields are dropped). */
export function parseGame(raw: unknown): FishingGame {
  if (typeof raw !== 'object' || raw === null) {
    return { ...NEW_GAME }
  }
  const r = raw as Record<string, unknown>
  const bySpecies: Record<string, number> = {}
  if (typeof r.bySpecies === 'object' && r.bySpecies !== null) {
    for (const [id, n] of Object.entries(r.bySpecies)) {
      bySpecies[id] = count(n, 0)
    }
  }
  const best = r.best as FishingGame['best']
  const isBest = typeof best === 'object' && best !== null && typeof best.id === 'string' && typeof best.size === 'number'

  return { total: count(r.total, 0), bySpecies, best: isBest ? best : null, bait: count(r.bait, 0), rod: count(r.rod, 0) }
}

export function addCatch(game: FishingGame, fish: Catch): FishingGame {
  const isBest = game.best === null || fish.size > game.best.size

  return {
    ...game,
    total: game.total + 1,
    bySpecies: { ...game.bySpecies, [fish.id]: (game.bySpecies[fish.id] ?? 0) + 1 },
    best: isBest ? { id: fish.id, size: fish.size } : game.best,
  }
}

export type Direction = 'left' | 'right' | 'up' | 'down'

/** Moves the cursor over the 2-column, 3-row command window, wrapping round. */
export function moveCursor(cursor: number, direction: Direction): number {
  const columns = 2
  const rows = MENU.length / columns
  let column = cursor % columns
  let row = Math.floor(cursor / columns)
  if (direction === 'left') column = (column + columns - 1) % columns
  if (direction === 'right') column = (column + 1) % columns
  if (direction === 'up') row = (row + rows - 1) % rows
  if (direction === 'down') row = (row + 1) % rows

  return row * columns + column
}

export const menuAt = (cursor: number): MenuId => MENU[Math.min(Math.max(0, cursor), MENU.length - 1)]!
