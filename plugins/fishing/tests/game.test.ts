import { describe, expect, test } from 'claude-code/testing'

import { BITE_MS, CAST_MS, Fishing, REEL_MS, seededRandom } from '../hooks/fishing'
import { addCatch, moveCursor, NEW_GAME, parseGame } from '../hooks/game'
import type { Fish } from '../hooks/theme'

const FISH: Fish[] = [
  { id: 'minnow', sprite: 'fish', value: 10, weight: 9, size: [5, 9] },
  { id: 'whale', sprite: 'fish', value: 900, weight: 1, size: [90, 99] },
]

describe('the cursor', () => {
  test('walks the 2x3 window and wraps at its edges', () => {
    expect(moveCursor(0, 'right')).toBe(1)
    expect(moveCursor(1, 'right')).toBe(0)
    expect(moveCursor(0, 'left')).toBe(1)
    expect(moveCursor(0, 'down')).toBe(2)
    expect(moveCursor(4, 'down')).toBe(0)
    expect(moveCursor(1, 'up')).toBe(5)
  })
})

describe('the angler', () => {
  test('casts, waits, bites; a reel in the bite lands the fish', () => {
    const fishing = new Fishing(FISH, [1, 1], seededRandom(7), 0)
    expect(fishing.update(CAST_MS + 999)).toEqual([])
    expect(fishing.update(CAST_MS + 1000)).toEqual([{ type: 'bite' }])
    expect(fishing.reel(CAST_MS + 1200).at(-1)).toEqual({ type: 'hook', byPlayer: true })
    const [landed] = fishing.update(CAST_MS + 1200 + REEL_MS)
    expect(landed).toMatchObject({ type: 'catch', byPlayer: true, isWork: false })
    expect(fishing.view(CAST_MS + 1200 + REEL_MS).kind).toBe('showing')
  })

  test('a bite left alone is landed or lost by the dice', () => {
    const outcomes = new Set<string>()
    for (let seed = 1; seed < 30; seed++) {
      const fishing = new Fishing(FISH, [1, 1], seededRandom(seed), 0)
      const events = fishing.update(CAST_MS + 1000 + BITE_MS + REEL_MS)
      outcomes.add(events.map(e => e.type).join(','))
    }
    expect([...outcomes].sort()).toEqual(['bite,escape', 'bite,hook,catch'])
  })

  test('a recast starts a fresh cast; a finished turn lands any fish', () => {
    const fishing = new Fishing(FISH, [60, 60], seededRandom(1), 0)
    fishing.update(CAST_MS + 100)
    expect(fishing.recast(5000).at(-1)).toEqual({ type: 'cast' })
    expect(fishing.view(5000)).toMatchObject({ kind: 'casting', progress: 0 })
    expect(['minnow', 'whale']).toContain(fishing.landFor().id)
  })

  test('bait shortens the wait', () => {
    const plain = new Fishing(FISH, [10, 10], seededRandom(1), 0)
    const baited = new Fishing(FISH, [10, 10], seededRandom(1), 0)
    baited.setBait(2)
    plain.update(CAST_MS)
    baited.update(CAST_MS)
    expect(plain.update(CAST_MS + 8000)).toEqual([])
    expect(baited.update(CAST_MS + 8000)).toEqual([{ type: 'bite' }])
  })
})

describe('the record', () => {
  test('a catch counts and keeps the best', () => {
    const one = addCatch(NEW_GAME, { id: 'minnow', sprite: 'fish', size: 7, value: 10 })
    const two = addCatch(one, { id: 'minnow', sprite: 'fish', size: 6, value: 9 })
    expect(two).toMatchObject({ total: 2, bySpecies: { minnow: 2 }, best: { size: 7 } })
  })

  test('a stored record is read back field by field, older fields dropped', () => {
    expect(parseGame({ total: 3, money: 500, stamina: 9, bySpecies: { a: 2, b: 'x' } })).toEqual({
      total: 3, bySpecies: { a: 2, b: 0 }, best: null, bait: 0, rod: 0,
    })
    expect(parseGame('junk')).toEqual(NEW_GAME)
  })
})
