import { describe, expect, test } from 'claude-code/testing'

import { loadTheme, type ThemeIO } from '../hooks/loader'
import { DEFAULT_PROFILE, parseProfile } from '../hooks/profile'
import { parseSprites } from '../hooks/sprites'
import { applyOverrides, compileTheme } from '../hooks/theme'
import { labels, MAP, SPRITES, themeFiles, themeJson } from './fixtures'

/** A ThemeIO over plain records: { "<dir>/<name>/<file>": text }. */
function io(files: Record<string, string>): ThemeIO {
  return {
    readText: async path => {
      const text = files[path]
      if (text === undefined) throw new Error(`ENOENT ${path}`)
      return text
    },
    listDirs: async dir => [...new Set(Object.keys(files).filter(p => p.startsWith(`${dir}/`)).map(p => p.slice(dir.length + 1).split('/')[0]!))],
  }
}

function folder(dir: string, name: string, files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([path, text]) => [`${dir}/${name}/${path}`, text]))
}

describe('sprite files', () => {
  test('frames, names and transparency parse', () => {
    const { sprites, errors } = parseSprites('s.txt', SPRITES)
    expect(errors).toEqual([])
    expect(sprites.get('water')?.frames.length).toBe(2)
    expect(sprites.get('rock')).toMatchObject({ width: 3, height: 2 })
  })

  test('a ragged row is reported with its file and line', () => {
    const { errors } = parseSprites('bad.txt', '[x]\naa\naaa\n')
    expect(errors[0]).toContain('bad.txt:1: [x] frame 1 row 2 is 3 wide, not 2')
  })
})

describe('theme loading', () => {
  test('a valid theme compiles', () => {
    const files = themeFiles()
    const { theme, errors } = compileTheme('river-rpg', { json: JSON.parse(files['theme.json']!), read: f => files[f] })
    expect(errors).toEqual([])
    expect(theme?.map.length).toBe(5)
    expect(theme?.labels.ja.location).toBe('小川')
  })

  test('every mistake is named, not just the first', () => {
    const json = JSON.parse(themeJson({ outside: 'Q', focus: 'middle' }))
    json.palette.z = '#12345'
    json.labels.en.menu = { fish: 'Fish' }
    const files: Record<string, string> = { ...themeFiles(), 'sprites.txt': `${SPRITES}\n[bad]\nzq\n` }
    const { theme, errors } = compileTheme('t', { json, read: f => files[f] })
    expect(theme).toBeUndefined()
    const all = errors.join('\n')
    expect(all).toContain('palette.z.hex must be a colour')
    expect(all).toContain('[bad] uses "z", "q", not in the palette')
    expect(all).toContain('outside must be a tile character')
    expect(all).toContain('focus must be [x, y]')
    expect(all).toContain('labels.en.menu.cast must be a non-empty string')
  })

  test('states and sounds are checked too', () => {
    const json = JSON.parse(themeJson({
      states: { sleepy: {}, waiting: { pose: 'dance', alert: 'nope' }, tool: { kinds: { gpu: { fish: 'fish' } } } },
      sounds: { done: '../done.wav', boom: 'sounds/boom.wav' },
    }))
    const files: Record<string, string> = themeFiles()
    const all = compileTheme('t', { json, read: f => files[f] }).errors.join('\n')
    expect(all).toContain('states.sleepy is not a state')
    expect(all).toContain('states.waiting.pose must name one of angler.poses')
    expect(all).toContain('states.waiting.alert names no sprite')
    expect(all).toContain('states.tool.kinds.gpu is not a tool kind')
    expect(all).toContain('sounds.done must be a .wav path inside the theme folder')
    expect(all).toContain('sounds.boom is not a sound event')
  })

  test('a map character with no tile is reported', () => {
    const files: Record<string, string> = { ...themeFiles(), 'map.txt': `${MAP}GG?GGG\n` }
    const { errors } = compileTheme('t', { json: JSON.parse(files['theme.json']!), read: f => files[f] })
    expect(errors).toContain('map.txt: row 6 uses "?", which tiles does not define')
  })

  test("the user's folder is read before the built-in one", async () => {
    const userJson = JSON.parse(themeJson())
    userJson.labels.en.location = 'My creek'
    const files = {
      ...folder('/u', 'river-rpg', themeFiles(JSON.stringify(userJson))),
      ...folder('/b', 'river-rpg', themeFiles()),
    }
    const loaded = await loadTheme(io(files), 'river-rpg', ['/u', '/b'])
    expect(loaded.dir).toBe('/u/river-rpg')
    expect(loaded.theme.labels.en.location).toBe('My creek')
  })

  test('a broken theme falls back to the default, saying why', async () => {
    const files = {
      ...folder('/b', 'river-rpg', themeFiles()),
      ...folder('/b', 'broken', { ...themeFiles(), 'theme.json': '{ "schema": 1, ' }),
    }
    const loaded = await loadTheme(io(files), 'broken', ['/u', '/b'])
    expect(loaded.theme.name).toBe('river-rpg')
    expect(loaded.notices[0]).toBe('Theme "broken" could not be used; showing "river-rpg" instead.')
    expect(loaded.notices[1]).toContain('theme.json: not valid JSON')
  })

  test('a missing theme falls back too', async () => {
    const loaded = await loadTheme(io(folder('/b', 'river-rpg', themeFiles())), 'nope', ['/u', '/b'])
    expect(loaded.theme.name).toBe('river-rpg')
    expect(loaded.notices[1]).toContain('no theme folder named "nope"')
  })

  test('a broken default is an error, not a silent blank', async () => {
    const files = folder('/b', 'river-rpg', { ...themeFiles(), 'map.txt': '' })
    await expect(loadTheme(io(files), 'river-rpg', ['/b'])).rejects.toThrow('The default theme "river-rpg" is broken')
  })
})

describe('profile', () => {
  test('defaults fill what the file leaves out', () => {
    const { profile, warnings } = parseProfile({ theme: 'autumn', locale: 'en' })
    expect(profile).toEqual({ ...DEFAULT_PROFILE, theme: 'autumn', locale: 'en' })
    expect(warnings).toEqual([])
  })

  test('a bad field keeps its default and is reported; the rest still apply', () => {
    const { profile, warnings } = parseProfile({ fps: 99, pixelMode: 'full', colour: 'red', $schema: 'x' })
    expect(profile.fps).toBe(DEFAULT_PROFILE.fps)
    expect(profile.pixelMode).toBe('full')
    expect(warnings).toEqual([
      'profile.json: "fps" has an invalid value; using 6',
      'profile.json: unknown field "colour" ignored',
    ])
  })

  test('overrides recolour the palette and relabel the HUD', () => {
    const files = themeFiles()
    const { theme } = compileTheme('t', { json: JSON.parse(files['theme.json']!), read: f => files[f] })
    const { theme: changed, warnings } = applyOverrides(theme!, {
      palette: { a: '#000000', nope: '#ffffff' },
      window: { opacity: 0.5, bg: 'blue' },
      labels: { en: { location: 'Creek', stats: { cost: 'Spent' } } },
    })
    expect(changed.palette.get('a')).toEqual({ hex: 0, c256: undefined, ascii: undefined })
    expect(changed.window.opacity).toBe(0.5)
    expect(changed.labels.en.location).toBe('Creek')
    expect(changed.labels.en.stats).toEqual({ ...labels('en').stats, cost: 'Spent' })
    expect(changed.labels.ja.location).toBe('小川')
    expect(warnings).toEqual([
      'profile: overrides.palette.nope skipped (unknown key or not "#rrggbb")',
      'profile: overrides.window.bg skipped',
    ])
  })
})
