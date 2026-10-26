import { describe, expect, test, type Engine } from 'claude-code/testing'

import { CAST_MS, REEL_MS } from '../hooks/fishing'
import { NEW_GAME } from '../hooks/game'
import { decode, MemoryFs, PANE, PROFILE_PATH, themeFiles, themeJson, world } from './fixtures'

const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

/** `/fishing <args>` as the person types it. */
const fishing = ($: Engine, args: string) =>
  $.command.run({
    command: 'fishing', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 },
  })

const WIDE = { ...PANE, props: { ...PANE.props, bodyColumns: 60 } }

describe('the pane', () => {
  test('draws the map, both HUD windows and the controls on every surface', async ($, on) => {
    world(on)
    await start($)
    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ ...WIDE, surface })
      // zh-TW by default: the place, then the time of day (12:00 at +09:00), on the tab.
      expect((await ui.find({ type: 'Text', text: /小溪/ }))?.text).toBe('小溪  day')
      expect(await ui.find({ type: 'Text', text: /Focus\s+72%/ })).toBeDefined()
      expect(await ui.find({ key: 'menu:cast' })).toBeDefined()
      expect(await ui.find({ key: 'reel' })).toBeDefined()
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Raster', key: 'scene' })).toBeDefined()
      }
      await ui.unmount()
    }
  })

  test('the cells are half blocks with two pixel colours each', async ($, on) => {
    const w = world(on)
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await w.clock.advance(400)
    const cells = decode(w.blits.at(-1)!.cells)
    expect(cells.length).toBe(40 * 18 * 3)
    expect(cells[0]).toBe(0x2580)
    await ui.unmount()
  })

  test('pixel mode "full" paints spaces instead of ▀ and uses ASCII arrows', async ($, on) => {
    const w = world(on)
    w.fs.files.set(PROFILE_PATH, JSON.stringify({ pixelMode: 'full' }))
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await w.clock.advance(400)
    expect(decode(w.blits.at(-1)!.cells)[0]).toBe(0x20)
    expect(await ui.find({ type: 'Text', text: />cast/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('the profile', () => {
  test('picks the language, the stats and overrides labels', async ($, on) => {
    const w = world(on)
    w.fs.files.set(PROFILE_PATH, JSON.stringify({
      locale: 'en',
      stats: ['turns', 'catches'],
      overrides: { labels: { en: { location: 'Willow Creek', stats: { catches: 'Fish' } } } },
    }))
    await start($)
    const ui = await $.ui.mount({ ...WIDE, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /Willow Creek/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Fish\s+0/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Focus/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /en:welcome/ })).toBeDefined()
    await ui.unmount()
  })

  test('a broken theme falls back to the default, with a clear message', async ($, on) => {
    const fs = new MemoryFs()
      .builtin('river-rpg', themeFiles())
      .user('mine', { ...themeFiles(themeJson({ tileSize: 0 })), 'map.txt': 'GG\nG\n' })
    const w = world(on, fs)
    w.fs.files.set(PROFILE_PATH, JSON.stringify({ theme: 'mine' }))
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Raster', key: 'scene' })).toBeDefined()
    const log = w.logs.join('\n')
    expect(log).toContain('Theme "mine" could not be used; showing "river-rpg" instead.')
    expect(log).toContain('tileSize must be a number from 1 to 32')
    expect(log).toContain('map.txt: row 2 is 1 tiles wide, not 2')
    await ui.unmount()
  })

  test('/fishing theme switches only to a theme that loads, and saves it in profile.json', async ($, on) => {
    const fs = new MemoryFs()
      .builtin('river-rpg', themeFiles())
      .builtin('pond', themeFiles())
      .user('broken', { 'theme.json': '{}' })
    const w = world(on, fs)
    await start($)

    const refused = await fishing($, 'theme broken')
    expect(refused.text).toContain('Theme "broken" was not switched to:')
    expect(w.fs.files.has(PROFILE_PATH)).toBe(false)

    const switched = await fishing($, 'theme pond')
    expect(switched.text).toContain('Theme is now "pond"')
    expect(JSON.parse(w.fs.files.get(PROFILE_PATH)!)).toEqual({ theme: 'pond' })

    await fishing($, 'locale en')
    await fishing($, 'stats cost,tools')
    expect(JSON.parse(w.fs.files.get(PROFILE_PATH)!)).toEqual({ theme: 'pond', locale: 'en', stats: ['cost', 'tools'] })

    const listed = await fishing($, 'themes')
    expect(listed.text).toContain('➤ pond')
    expect(listed.text).toContain('  broken')
  })
})

describe('the command window', () => {
  test('hjkl move the ➤, z runs what it points at', async ($, on) => {
    world(on)
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await ui.find({ key: 'menu:cast' }))?.text).toContain('➤cast')

    await ui.press({ key: 'right' })
    expect((await ui.find({ key: 'menu:reel' }))?.text).toContain('➤reel')
    expect((await ui.find({ key: 'menu:cast' }))?.text).not.toContain('➤')

    await ui.press({ key: 'down' })
    expect((await ui.find({ key: 'menu:bag' }))?.text).toContain('➤bag')
    await ui.press({ key: 'up' })
    await ui.press({ key: 'left' })
    expect((await ui.find({ key: 'menu:cast' }))?.text).toContain('➤cast')

    // down to bait, then decide: the bait changes and says so.
    await ui.press({ key: 'down' })
    await ui.press({ key: 'decide' })
    expect(await ui.find({ type: 'Text', text: /zh-TW:bait/ })).toBeDefined()
    await ui.unmount()
  })

  test('pressing a menu item moves the ➤ there and runs it', async ($, on) => {
    world(on)
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'menu:dex' })
    expect((await ui.find({ key: 'menu:dex' }))?.text).toContain('➤dex')
    expect(await ui.find({ type: 'Text', text: /zh-TW:dexEmpty/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('the creel', () => {
  test('r during a bite lands the fish, and the catch is counted in $.store', async ($, on) => {
    const w = world(on)
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    // The fixture theme bites exactly a second after the cast lands.
    await w.clock.advance(CAST_MS + 1100)
    expect(await ui.find({ type: 'Text', text: /zh-TW:bite/ })).toBeDefined()

    await ui.press({ key: 'reel' })
    await w.clock.advance(REEL_MS + 200)
    expect(await ui.find({ type: 'Text', text: /zh-TW:catch (Minnow|Whale)/ })).toBeDefined()

    const stored = w.store.get('game-v1') as typeof NEW_GAME
    expect(stored.total).toBe(1)
    expect(Object.values(stored.bySpecies)).toEqual([1])

    await ui.press({ key: 'menu:dex' })
    expect(await ui.find({ type: 'Text', text: /zh-TW:dex (Minnow|Whale)×1/ })).toBeDefined()
    await ui.unmount()
  })

  test('the count carries over from an earlier session (older fields dropped)', async ($, on) => {
    const w = world(on)
    w.store.set('game-v1', { total: 41, stamina: 90, money: 1234 })
    w.fs.files.set(PROFILE_PATH, JSON.stringify({ stats: ['catches'] }))
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /catches\s+41/ })).toBeDefined()
    await ui.unmount()
  })
})
