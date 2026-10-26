// A small world for the tests: an in-memory file system holding tiny themes,
// and the engine calls the mod makes, answered beneath it.

import { mock, type MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { SESSION_KINDS, TOOL_KINDS } from '../hooks/session'
import { STAT_SOURCES } from '../hooks/stats'
import { LOCALES, MENU, MESSAGES, PHASES, type Labels, type Locale } from '../hooks/theme'

export const HOME = '/home/t'
export const USER_DIR = `${HOME}/.claude/fishing`
export const PROFILE_PATH = `${USER_DIR}/profile.json`
/** a Tuesday 03:00 UTC: 12:00, daytime, at +09:00 */
export const NOON_JST = Date.UTC(2026, 9, 27, 3, 0, 0)

const LOCATION: Record<Locale, string> = { 'zh-TW': '小溪', ja: '小川', en: 'Brook' }

export function labels(locale: Locale): Labels {
  const word = (id: string) => `${locale}:${id}`
  return {
    location: LOCATION[locale],
    phases: Object.fromEntries(PHASES.map(p => [p, p.slice(0, 3)])) as Labels['phases'],
    stats: { ...(Object.fromEntries(STAT_SOURCES.map(id => [id, id])) as Labels['stats']), contextLeft: 'Focus', cost: 'Cost', turns: 'Turns' },
    menu: Object.fromEntries(MENU.map(id => [id, id])) as Labels['menu'],
    controls: { reel: 'Reel', decide: 'OK' },
    messages: {
      ...(Object.fromEntries(MESSAGES.map(id => [id, word(id)])) as Labels['messages']),
      catch: `${locale}:catch {fish} {size}`,
      dex: `${locale}:dex {list}`,
      doneCatch: `${locale}:doneCatch {fish}`,
    },
    states: { ...(Object.fromEntries(SESSION_KINDS.map(id => [id, `${locale}:state:${id}`])) as Labels['states']), tool: `${locale}:state:tool:{tool}` },
    tools: Object.fromEntries(TOOL_KINDS.map(id => [id, `t-${id}`])) as Labels['tools'],
    fish: { minnow: 'Minnow', whale: 'Whale' },
    baits: ['worm', 'fly'],
    rods: ['stick', 'pole'],
  }
}

/** theme.json of a valid little theme; `patch` changes top-level fields. */
export function themeJson(patch: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 1,
    palette: {
      a: { hex: '#103080', c256: 25 },
      b: '#40a0ff',
      c: '#ffffff',
      d: '#20a040',
      e: '#ff3030',
      L: '#ffee88',
    },
    glow: 'L',
    tileSize: 4,
    map: 'map.txt',
    outside: 'G',
    sprites: ['sprites.txt'],
    speeds: { water: 2 },
    tiles: {
      '~': { sprite: 'water', anim: 'flow', dir: [0, 1], speed: 'water', edge: { color: 'c', group: '~' } },
      G: { sprite: 'grass' },
    },
    layers: ['ground', 'people'],
    objects: [{ sprite: 'rock', x: 4, y: 4, layer: 'ground', night: 'rock' }],
    angler: {
      sprite: 'angler', x: 2, y: 6, layer: 'people', rodTip: [5, 6], bobber: [14, 12],
      line: 'c', bobberSprite: 'bobber', poses: { sit: 1 },
    },
    states: {
      idle: { pose: 'sit' },
      tool: { pose: 'pull', kinds: { edit: { fish: 'fish', effect: 'bobber' }, other: { fish: 'fish' } } },
      waiting: { alert: 'rock' },
      error: { cloud: 'rock' },
      compacting: { phase: 'night', rain: 'c' },
    },
    sounds: { done: 'sounds/done.wav', waiting: 'sounds/waiting.wav', bite: 'sounds/bite.wav' },
    fish: [
      { id: 'minnow', sprite: 'fish', value: 10, weight: 9, size: [5, 9] },
      { id: 'whale', sprite: 'fish', value: 900, weight: 1, size: [90, 99] },
    ],
    focus: [12, 10],
    biteEverySeconds: [1, 1],
    phases: {
      morning: { tint: '#ffaa66', amount: 0.1 },
      day: { amount: 0 },
      evening: { tint: '#ff6633', amount: 0.2 },
      night: { tint: '#000822', amount: 0.5 },
    },
    window: { bg: '#101840', border: '#eeeeff', text: '#ffffff', accent: '#ffdd55', dim: '#99aacc', opacity: 0.7, tab: '#eeeeff', tabText: '#101840' },
    labels: Object.fromEntries(LOCALES.map(locale => [locale, labels(locale)])),
    ...patch,
  })
}

export const SPRITES = `
[water]
abab
bbbb
---
baba
bbbb

[grass]
dd
dd

[rock]
.c.
ccc

[angler]
.e.
ece
.a.
a.a
---
.e.
ece
aa.
...

[bobber]
e
---
c

[fish]
eee
.e.
`

export const MAP = `
~~~~~~
~~~~~~
GG~~GG
GGGGGG
GGGGGG
`

/** The files of a theme folder named `name`, relative to it. */
export function themeFiles(json = themeJson()): Record<string, string> {
  return { 'theme.json': json, 'sprites.txt': SPRITES, 'map.txt': MAP }
}

/**
 * Files by path. Built-in themes are kept under `@builtin/themes/...` and
 * matched against whatever folder the mod is loaded from.
 */
export class MemoryFs {
  readonly files = new Map<string, string>()

  builtin(name: string, files: Record<string, string>): this {
    for (const [path, text] of Object.entries(files)) this.files.set(`@builtin/themes/${name}/${path}`, text)
    return this
  }

  user(name: string, files: Record<string, string>): this {
    for (const [path, text] of Object.entries(files)) this.files.set(`${USER_DIR}/themes/${name}/${path}`, text)
    return this
  }

  key(path: string): string {
    if (path.startsWith(HOME)) return path
    const slashed = `${path}/`
    const at = slashed.lastIndexOf('/themes/')
    return at < 0 ? path : `@builtin${slashed.slice(at, -1)}`
  }

  install(on: On): void {
    on('fs.read', (_, e) => {
      const text = this.files.get(this.key(e.path))
      if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
      return { value: text }
    })
    on('fs.write', (_, e) => {
      this.files.set(this.key(e.path), e.text)
      return { value: undefined }
    })
    on('fs.list', (_, e) => {
      const prefix = `${this.key(e.path)}/`
      const names = new Set<string>()
      for (const path of this.files.keys()) {
        if (path.startsWith(prefix)) names.add(path.slice(prefix.length).split('/')[0]!)
      }
      if (names.size === 0) throw new Error(`ENOENT: ${e.path}`)
      return { value: [...names].map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) }
    })
  }
}

export type World = {
  fs: MemoryFs
  /** the mod's `$.store`, readable and seedable by the test */
  store: Map<string, unknown>
  clock: MockClock
  blits: { cells: string; columns?: number; rows?: number }[]
  logs: string[]
  /** what `$.ui.panes()` answers about the pane */
  pane: { isShown: boolean; isPlaced: boolean }
  /** every command the mod ran, and what the host has for `uname` and `command -v` */
  runs: string[][]
  host: { os: string; commands: string[] }
  /** what `$.session.usage()` answers */
  usage: { context: { window: number; percent?: number }; rateLimits: { kind: string; percentUsed: number }[]; cost?: { usd: number } }
}

/** Everything beneath the mod: files, env, store, clock, and the UI calls. */
export function world(on: On, fs = new MemoryFs().builtin('river-rpg', themeFiles()), env: Record<string, string> = {}): World {
  const w: World = {
    fs,
    store: new Map(),
    clock: mock.clock(on, { now: NOON_JST }),
    blits: [],
    logs: [],
    pane: { isShown: true, isPlaced: true },
    runs: [],
    host: { os: 'Linux', commands: ['paplay'] },
    usage: { context: { window: 200000, percent: 28 }, rateLimits: [{ kind: 'seven_day', percentUsed: 19 }], cost: { usd: 0.42 } },
  }
  fs.install(on)
  mock.env(on, { HOME, COLORTERM: 'truecolor', ...env })
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => {
    w.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    w.runs.push([...e.argv])
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'date') return out('+0900\n')
    if (e.argv[0] === 'uname') return out(`${w.host.os}\n`)
    if (e.argv[0] === 'sh') return out(w.host.commands.map(c => `${c}\n`).join(''))
    if (e.argv[0] === 'wslpath') return out(`\\\\wsl.localhost\\Distro${e.argv[2]!.replace(/\//g, '\\')}\n`)
    return out('')
  })
  on('session.usage', () => ({ value: { startedAt: 0, ...w.usage } }))
  on('command.register', () => ({ value: { command: 'fishing' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.log', (_, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [{ id: 'fishing', title: 'Brook', isFocused: false, ...w.pane }],
  }))
  on('ui.blit', (_, e) => {
    if ('cells' in e) w.blits.push({ cells: e.cells, columns: e.columns, rows: e.rows })
    return { value: {} }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return w
}

export const PANE = {
  plugin: 'fishing',
  component: 'Pane',
  requestId: 'fishing',
  props: {
    title: 'Brook',
    isFocused: true,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

/** The plugin's half-block cells decoded: [codePoint, fg, bg] per cell. */
export function decode(cells: string): Uint32Array {
  const binary = atob(cells)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Uint32Array(bytes.buffer)
}
