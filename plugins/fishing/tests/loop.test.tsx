import { describe, expect, test } from 'claude-code/testing'

import { FrameLoop, modeFor } from '../hooks/ticker'
import { PANE, PROFILE_PATH, world } from './fixtures'

const MINUTE = 60_000

describe('frame loop, on its own', () => {
  /** A hand-cranked clock: `every` keeps the interval, `run` fires it. */
  function fakeClock() {
    let now = 0
    const timers = new Set<{ ms: number; fn: () => void; next: number }>()
    return {
      clock: {
        now: async () => now,
        every: (ms: number, fn: () => void) => {
          const timer = { ms, fn, next: now + ms }
          timers.add(timer)
          return { cancel: () => timers.delete(timer) }
        },
      },
      timers,
      /** moves time on in 10 ms steps, firing what falls due */
      async run(ms: number) {
        for (const end = now + ms; now < end;) {
          now += 10
          for (const timer of [...timers]) {
            if (now >= timer.next) {
              timer.next += timer.ms
              timer.fn()
              for (let hop = 0; hop < 20; hop++) await Promise.resolve() // let the tick finish
            }
          }
        }
      },
    }
  }

  test('the modes follow idle time', () => {
    const config = { fps: 6, slowAfterMs: 5 * MINUTE, freezeAfterMs: 15 * MINUTE }
    expect(modeFor(config, 0)).toBe('active')
    expect(modeFor(config, 5 * MINUTE)).toBe('slow')
    expect(modeFor(config, 15 * MINUTE)).toBe('frozen')
  })

  test('6 fps active, 1 fps after 5 idle minutes, frozen after 15, awake on a poke', async () => {
    const fake = fakeClock()
    let frames = 0
    const loop = new FrameLoop(fake.clock, { fps: 6, slowAfterMs: 5 * MINUTE, freezeAfterMs: 15 * MINUTE }, {
      frame: async () => (frames++, true),
      isVisible: async () => true,
    })
    await loop.ensure()

    await fake.run(1000)
    expect(frames).toBeGreaterThanOrEqual(5)
    expect(frames).toBeLessThanOrEqual(6)

    await fake.run(5 * MINUTE)
    frames = 0
    await fake.run(10_000)
    expect(frames).toBe(10) // one a second
    expect(fake.timers.size).toBe(1) // one timer, never two

    await fake.run(10 * MINUTE)
    expect(loop.isRunning).toBe(false)
    expect(loop.stopReason).toBe('frozen')
    frames = 0
    await fake.run(5000)
    expect(frames).toBe(0)

    await loop.poke()
    await fake.run(1000)
    expect(frames).toBeGreaterThanOrEqual(5)
  })

  test('a hidden pane stops the timer until it is drawn again', async () => {
    const fake = fakeClock()
    let isShown = true
    let frames = 0
    const loop = new FrameLoop(fake.clock, { fps: 6, slowAfterMs: MINUTE, freezeAfterMs: 2 * MINUTE }, {
      frame: async () => (frames++, true),
      isVisible: async () => isShown,
    })
    await loop.ensure()
    await fake.run(1000)
    isShown = false
    await fake.run(3000)
    expect(loop.stopReason).toBe('hidden')
    expect(fake.timers.size).toBe(0)
    frames = 0
    await fake.run(3000)
    expect(frames).toBe(0)
    isShown = true
    await loop.ensure() // what the next render does
    await fake.run(1000)
    expect(frames).toBeGreaterThan(0)
  })
})

describe('frame loop, in the mod', () => {
  test('the pane repaints by blit, slows and freezes at the profile\'s idle times', async ($, on) => {
    const w = world(on)
    // Seconds instead of minutes, so the mocked clock has less to run through;
    // the defaults (5 and 15 minutes) are covered above.
    w.fs.files.set(PROFILE_PATH, JSON.stringify({ idleSlowMinutes: 0.1, idleFreezeMinutes: 0.3 }))
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Raster', key: 'scene' })).toBeDefined()

    await w.clock.advance(1000)
    const active = w.blits.length
    expect(active).toBeGreaterThanOrEqual(5)
    expect(active).toBeLessThanOrEqual(7)
    expect(w.blits[0]).toMatchObject({ columns: 40, rows: 18 })

    await w.clock.advance(6000) // 7 s idle: past 6 s, one frame a second
    const before = w.blits.length
    await w.clock.advance(5000)
    expect(w.blits.length - before).toBeGreaterThanOrEqual(4)
    expect(w.blits.length - before).toBeLessThanOrEqual(6)

    await w.clock.advance(8000) // 20 s idle: past 18 s, frozen
    const frozen = w.blits.length
    await w.clock.advance(60_000)
    expect(w.blits.length).toBe(frozen)

    // Any press is activity: full speed again.
    await ui.press({ key: 'right' })
    const woken = w.blits.length
    await w.clock.advance(1000)
    expect(w.blits.length - woken).toBeGreaterThanOrEqual(5)
    await ui.unmount()
  })

  test('no frames while the pane is not shown', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await w.clock.advance(1000)
    w.pane.isShown = false
    await w.clock.advance(3000)
    const stopped = w.blits.length
    await w.clock.advance(10_000)
    expect(w.blits.length).toBe(stopped)
    await ui.unmount()
  })
})
