// A theme is data: theme.json, sprite files and a tile map. This module
// checks the parsed files and compiles them into a Theme the scene draws.
// It reads nothing itself (loader.ts does), so it runs anywhere.

import { SOUND_EVENTS, type SoundEvent } from './audio'
import { parseHex } from './color'
import { SESSION_KINDS, TOOL_KINDS, type SessionKind, type ToolKind } from './session'
import { parseSprites, type Sprite, unknownKeys } from './sprites'
import { STAT_SOURCES, type StatSource } from './stats'

export const LOCALES = ['zh-TW', 'ja', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const PHASES = ['morning', 'day', 'evening', 'night'] as const
export type Phase = (typeof PHASES)[number]

/** The command window, in reading order: two columns, three rows. */
export const MENU = ['cast', 'reel', 'bait', 'bag', 'dex', 'setup'] as const
export type MenuId = (typeof MENU)[number]

export const MESSAGES = [
  'welcome', 'cast', 'reel', 'bite', 'catch', 'escape', 'bait', 'bag', 'dex', 'dexEmpty', 'setup', 'doneCatch',
] as const
export type MessageId = (typeof MESSAGES)[number]

export type Labels = {
  location: string
  phases: Record<Phase, string>
  /** the status window's names for each stat source */
  stats: Record<StatSource, string>
  menu: Record<MenuId, string>
  controls: { reel: string; decide: string }
  messages: Record<MessageId, string>
  /** the message line while Claude works ({tool} names the tool kind) */
  states: Record<SessionKind, string>
  tools: Record<ToolKind, string>
  /** species id -> name */
  fish: Record<string, string>
  baits: string[]
  rods: string[]
}

export type WindowStyle = {
  bg: string
  border: string
  text: string
  accent: string
  dim: string
  /** how much of the window colour covers the map, 0-1 */
  opacity: number
  /** the status window's title tab */
  tab: string
  tabText: string
  corners: 'round' | 'square'
}

export type TileAnim = 'static' | 'flow' | 'loop' | 'sparkle'

/** A map character's material: a texture sampled in world coordinates. */
export type Tile = {
  sprite: string
  anim: TileAnim
  /** `flow`: the direction the texture moves, one pixel per step */
  dir: [number, number]
  speed: number
  /** a 1-px line drawn where a neighbour is not in `group` */
  edge?: { color: string; group: string }
}

export type ObjectAnim =
  | { kind: 'static' }
  | { kind: 'loop'; speed: number }
  | { kind: 'patrol'; dx: number; dy: number; speed: number }
  | { kind: 'swim'; dx: number; speed: number }
  | { kind: 'rise'; dy: number; speed: number }

export type SceneObject = {
  sprite: string
  x: number
  y: number
  layer: string
  anim: ObjectAnim
  /** ticks added to the animation clock, so neighbours don't move in step */
  offset: number
  flip: boolean
  /** shown only in these phases (all when absent) */
  when?: Phase[]
  /** drawn instead at night */
  night?: string
}

export type Angler = {
  /** null: no angler on screen (the line comes from off the map) */
  sprite: string | null
  /** pose name -> frame of `sprite` (the states pick poses by name) */
  poses: Record<string, number>
  x: number
  y: number
  layer: string
  rodTip: [number, number]
  bobber: [number, number]
  line: string
  bobberSprite: string
  rippleSprite?: string
  splashSprite?: string
}

export type Fish = {
  id: string
  sprite: string
  value: number
  weight: number
  size: [number, number]
}

/** `c256`: the xterm-256 index used without truecolor; `ascii`: a glyph for text previews */
/** How the scene looks while the session is in one state. */
export type StateLook = {
  /** the angler's pose, a name in angler.poses */
  pose?: string
  /** a sprite blinking over the angler (waiting) */
  alert?: string
  /** a sprite drifting over the angler (error) */
  cloud?: string
  /** a palette key: rain falls in it */
  rain?: string
  /** the time of day to show instead of the clock's */
  phase?: Phase
  /** tool: the fish and effect on the line for each kind of tool */
  kinds?: Partial<Record<ToolKind, { fish: string; effect?: string }>>
}

export type PaletteEntry = { hex: number; c256?: number; ascii?: string }

export type Theme = {
  name: string
  title: Record<Locale, string>
  palette: Map<string, PaletteEntry>
  tileSize: number
  map: string[]
  outside: string
  tiles: Map<string, Tile>
  sprites: Map<string, Sprite>
  layers: string[]
  objects: SceneObject[]
  angler: Angler
  fish: Fish[]
  states: Record<SessionKind, StateLook>
  /** sound files by event, relative to the theme folder */
  sounds: Partial<Record<SoundEvent, string>>
  focus: [number, number]
  /** palette keys that give light: never darkened by the time of day */
  glow: string
  /** seconds between bites, at random within the range */
  bite: [number, number]
  phases: Record<Phase, { tint: number; amount: number }>
  window: WindowStyle
  labels: Record<Locale, Labels>
}

/** What loader.ts hands in: theme.json parsed, and the text of each file it names. */
export type ThemeFiles = {
  json: unknown
  read: (relativePath: string) => string | undefined
}

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

class Checker {
  readonly errors: string[] = []

  fail(path: string, message: string): undefined {
    this.errors.push(`theme.json: ${path} ${message}`)
    return undefined
  }

  object(value: unknown, path: string): Json | undefined {
    return isObject(value) ? value : this.fail(path, 'must be an object')
  }

  string(value: unknown, path: string): string | undefined {
    return typeof value === 'string' && value !== '' ? value : this.fail(path, 'must be a non-empty string')
  }

  number(value: unknown, path: string, min: number, max: number): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
      ? value
      : this.fail(path, `must be a number from ${min} to ${max}`)
  }

  point(value: unknown, path: string): [number, number] | undefined {
    return Array.isArray(value) && value.length === 2 && value.every(n => Number.isInteger(n))
      ? [value[0] as number, value[1] as number]
      : this.fail(path, 'must be [x, y] in whole pixels')
  }

  color(value: unknown, path: string): string | undefined {
    return parseHex(value) !== undefined ? (value as string) : this.fail(path, 'must be a colour like "#1a2b3c"')
  }
}

function checkLabels(c: Checker, raw: unknown, path: string, fishIds: string[]): Labels | undefined {
  const json = c.object(raw, path)
  if (json === undefined) {
    return undefined
  }
  const record = <K extends string>(value: unknown, at: string, keys: readonly K[]) => {
    const object = c.object(value, at)
    if (object === undefined) {
      return undefined
    }
    const out = {} as Record<K, string>
    for (const key of keys) {
      const text = c.string(object[key], `${at}.${key}`)
      if (text === undefined) {
        return undefined
      }
      out[key] = text
    }

    return out
  }
  const list = (value: unknown, at: string) =>
    Array.isArray(value) && value.length > 0 && value.every(v => typeof v === 'string' && v !== '')
      ? (value as string[])
      : c.fail(at, 'must be a non-empty list of strings')

  const location = c.string(json.location, `${path}.location`)
  const phases = record(json.phases, `${path}.phases`, PHASES)
  const stats = record(json.stats, `${path}.stats`, STAT_SOURCES)
  const menu = record(json.menu, `${path}.menu`, MENU)
  const controls = record(json.controls, `${path}.controls`, ['reel', 'decide'] as const)
  const messages = record(json.messages, `${path}.messages`, MESSAGES)
  const states = record(json.states, `${path}.states`, SESSION_KINDS)
  const tools = record(json.tools, `${path}.tools`, TOOL_KINDS)
  const fish = record(json.fish, `${path}.fish`, fishIds)
  const baits = list(json.baits, `${path}.baits`)
  const rods = list(json.rods, `${path}.rods`)
  if (!location || !phases || !stats || !menu || !controls || !messages || !states || !tools || !fish || !baits || !rods) {
    return undefined
  }

  return { location, phases, stats, menu, controls, messages, states, tools, fish, baits, rods }
}

function checkObjectAnim(c: Checker, raw: unknown, path: string, speeds: Json): ObjectAnim | undefined {
  if (raw === undefined) {
    return { kind: 'static' }
  }
  const json = c.object(raw, path)
  if (json === undefined) {
    return undefined
  }
  const speed = speedOf(c, json.speed, `${path}.speed`, speeds)
  switch (json.kind) {
    case 'static':
      return { kind: 'static' }
    case 'loop':
      return speed === undefined ? undefined : { kind: 'loop', speed }
    case 'patrol': {
      const dx = json.dx ?? 0
      const dy = json.dy ?? 0
      return speed === undefined || !Number.isInteger(dx) || !Number.isInteger(dy)
        ? c.fail(path, 'patrol needs whole-pixel dx/dy and a speed')
        : { kind: 'patrol', dx: dx as number, dy: dy as number, speed }
    }
    case 'swim':
      return speed === undefined || !Number.isInteger(json.dx) || json.dx === 0
        ? c.fail(path, 'swim needs a non-zero whole-pixel dx and a speed')
        : { kind: 'swim', dx: json.dx as number, speed }
    case 'rise':
      return speed === undefined || !Number.isInteger(json.dy) || json.dy === 0
        ? c.fail(path, 'rise needs a non-zero whole-pixel dy and a speed')
        : { kind: 'rise', dy: json.dy as number, speed }
    default:
      return c.fail(`${path}.kind`, 'must be static, loop, patrol, swim or rise')
  }
}

/** A speed is a number of animation ticks (6 a second), or a name in `speeds`. */
function speedOf(c: Checker, raw: unknown, path: string, speeds: Json): number | undefined {
  const value = typeof raw === 'string' ? speeds[raw] : raw
  return c.number(value, typeof raw === 'string' ? `speeds.${raw} (from ${path})` : path, 1, 600)
}

/** Checks a theme's files and compiles them; `errors` is empty when it is usable. */
export function compileTheme(name: string, files: ThemeFiles): { theme?: Theme; errors: string[] } {
  const c = new Checker()
  const json = c.object(files.json, '(top level)')
  if (json === undefined) {
    return { errors: c.errors }
  }
  if (json.schema !== 1) {
    c.fail('schema', 'must be 1')
  }

  // Palette: single-character keys, each a colour and an optional pinned
  // xterm-256 index for terminals without truecolor.
  const palette = new Map<string, PaletteEntry>()
  const rawPalette = c.object(json.palette, 'palette') ?? {}
  for (const [key, value] of Object.entries(rawPalette)) {
    const at = `palette.${key}`
    if ([...key].length !== 1 || key === '.' || key === ' ') {
      c.fail(at, 'key must be one character other than "." or a space')
      continue
    }
    const entry = typeof value === 'string' ? { hex: value } : c.object(value, at)
    const hex = entry && parseHex(entry.hex)
    if (hex === undefined) {
      c.fail(`${at}.hex`, 'must be a colour like "#1a2b3c"')
      continue
    }
    const c256 = entry?.c256
    if (c256 !== undefined && !(Number.isInteger(c256) && (c256 as number) >= 16 && (c256 as number) <= 255)) {
      c.fail(`${at}.c256`, 'must be an xterm-256 index from 16 to 255')
    }
    const ascii = entry?.ascii
    if (ascii !== undefined && !(typeof ascii === 'string' && /^[\x20-\x7e]$/.test(ascii))) {
      c.fail(`${at}.ascii`, 'must be one printable ASCII character')
    }
    palette.set(key, { hex, c256: c256 as number | undefined, ascii: ascii as string | undefined })
  }
  if (palette.size < 2) {
    c.fail('palette', 'needs at least two colours')
  }
  const keys = new Set(palette.keys())
  const paletteKey = (value: unknown, path: string) =>
    typeof value === 'string' && keys.has(value) ? value : c.fail(path, 'must be a palette key')

  // Sprites, from every file the theme lists.
  const sprites = new Map<string, Sprite>()
  const spriteFiles = Array.isArray(json.sprites) ? json.sprites : (c.fail('sprites', 'must list sprite files'), [])
  for (const file of spriteFiles) {
    const text = typeof file === 'string' ? files.read(file) : undefined
    if (text === undefined) {
      c.fail('sprites', `names ${JSON.stringify(file)}, which could not be read`)
      continue
    }
    const parsed = parseSprites(file as string, text)
    c.errors.push(...parsed.errors)
    for (const [spriteName, sprite] of parsed.sprites) {
      const unknown = unknownKeys(sprite, keys)
      if (unknown.length > 0) {
        c.errors.push(`${file as string}: [${spriteName}] uses ${unknown.map(k => `"${k}"`).join(', ')}, not in the palette`)
      }
      sprites.set(spriteName, sprite)
    }
  }
  const spriteRef = (value: unknown, path: string) =>
    typeof value === 'string' && sprites.has(value) ? value : c.fail(path, `names no sprite (${JSON.stringify(value)})`)

  const speeds = c.object(json.speeds ?? {}, 'speeds') ?? {}
  const tileSize = c.number(json.tileSize, 'tileSize', 1, 32) ?? 4

  // Tiles: the materials the map's characters stand for.
  const tiles = new Map<string, Tile>()
  for (const [char, raw] of Object.entries(c.object(json.tiles, 'tiles') ?? {})) {
    const at = `tiles.${char}`
    const tile = c.object(raw, at)
    if (tile === undefined || [...char].length !== 1) {
      c.fail(at, 'must be one map character mapped to an object')
      continue
    }
    const sprite = spriteRef(tile.sprite, `${at}.sprite`)
    const anim = (tile.anim ?? 'static') as TileAnim
    if (!['static', 'flow', 'loop', 'sparkle'].includes(anim)) {
      c.fail(`${at}.anim`, 'must be static, flow, loop or sparkle')
    }
    const dir = tile.dir === undefined ? ([0, 1] as [number, number]) : c.point(tile.dir, `${at}.dir`)
    const speed = anim === 'static' ? 1 : speedOf(c, tile.speed, `${at}.speed`, speeds)
    let edge: Tile['edge']
    if (tile.edge !== undefined) {
      const rawEdge = c.object(tile.edge, `${at}.edge`)
      const color = rawEdge && paletteKey(rawEdge.color, `${at}.edge.color`)
      const group = rawEdge && c.string(rawEdge.group, `${at}.edge.group`)
      edge = color && group ? { color, group } : undefined
    }
    if (sprite && dir && speed !== undefined) {
      tiles.set(char, { sprite, anim, dir, speed, edge })
    }
  }

  // The map: rows of tile characters, all the same width.
  let map: string[] = []
  const mapFile = c.string(json.map, 'map')
  const mapText = mapFile === undefined ? undefined : files.read(mapFile)
  if (mapFile !== undefined && mapText === undefined) {
    c.fail('map', `names ${mapFile}, which could not be read`)
  } else if (mapText !== undefined) {
    map = mapText.split(/\r?\n/).map(row => row.trimEnd()).filter(row => row !== '' && !row.startsWith('#'))
    const width = [...(map[0] ?? '')].length
    map.forEach((row, y) => {
      if ([...row].length !== width) {
        c.errors.push(`${mapFile}: row ${y + 1} is ${[...row].length} tiles wide, not ${width}`)
      }
      for (const char of row) {
        if (!tiles.has(char)) {
          c.errors.push(`${mapFile}: row ${y + 1} uses "${char}", which tiles does not define`)
          break
        }
      }
    })
    if (map.length === 0) {
      c.errors.push(`${mapFile}: holds no rows`)
    }
  }
  const outside = typeof json.outside === 'string' && tiles.has(json.outside) ? json.outside : c.fail('outside', 'must be a tile character')

  const layers = Array.isArray(json.layers) && json.layers.every(l => typeof l === 'string')
    ? (json.layers as string[])
    : (c.fail('layers', 'must list layer names in drawing order'), [])
  const layer = (value: unknown, path: string) =>
    typeof value === 'string' && layers.includes(value) ? value : c.fail(path, `must be one of layers (${layers.join(', ')})`)

  const objects: SceneObject[] = []
  const rawObjects = Array.isArray(json.objects) ? json.objects : (c.fail('objects', 'must be a list'), [])
  rawObjects.forEach((raw, index) => {
    const at = `objects[${index}]`
    const object = c.object(raw, at)
    if (object === undefined) {
      return
    }
    const sprite = spriteRef(object.sprite, `${at}.sprite`)
    const where = c.point([object.x, object.y], `${at}.x/y`)
    const onLayer = layer(object.layer, `${at}.layer`)
    const anim = checkObjectAnim(c, object.anim, `${at}.anim`, speeds)
    const night = object.night === undefined ? undefined : spriteRef(object.night, `${at}.night`)
    const when = object.when === undefined ? undefined
      : Array.isArray(object.when) && object.when.every(p => (PHASES as readonly unknown[]).includes(p))
        ? (object.when as Phase[])
        : c.fail(`${at}.when`, `must list phases (${PHASES.join(', ')})`)
    if (sprite && where && onLayer && anim) {
      objects.push({
        sprite, x: where[0], y: where[1], layer: onLayer, anim, night, when,
        offset: typeof object.offset === 'number' ? object.offset : index * 7,
        flip: object.flip === true,
      })
    }
  })

  let angler: Angler | undefined
  const rawAngler = c.object(json.angler, 'angler')
  if (rawAngler) {
    const sprite = rawAngler.sprite === null ? null : spriteRef(rawAngler.sprite, 'angler.sprite')
    const where = rawAngler.sprite === null ? ([0, 0] as [number, number]) : c.point([rawAngler.x, rawAngler.y], 'angler.x/y')
    const rodTip = c.point(rawAngler.rodTip, 'angler.rodTip')
    const bobber = c.point(rawAngler.bobber, 'angler.bobber')
    const line = paletteKey(rawAngler.line, 'angler.line')
    const bobberSprite = spriteRef(rawAngler.bobberSprite, 'angler.bobberSprite')
    const optional = (key: string) =>
      rawAngler[key] === undefined ? undefined : spriteRef(rawAngler[key], `angler.${key}`)
    const onLayer = layer(rawAngler.layer, 'angler.layer')
    const poses: Record<string, number> = { wait: 0, pull: 1, show: 2 }
    for (const [pose, frame] of Object.entries(c.object(rawAngler.poses ?? {}, 'angler.poses') ?? {})) {
      const frames = sprite ? sprites.get(sprite)!.frames.length : 1
      if (Number.isInteger(frame) && (frame as number) >= 0 && (frame as number) < frames) {
        poses[pose] = frame as number
      } else {
        c.fail(`angler.poses.${pose}`, `must be a frame of the angler sprite (0-${frames - 1})`)
      }
    }
    if (sprite !== undefined && where && rodTip && bobber && line && bobberSprite && onLayer) {
      angler = {
        sprite, poses, x: where[0], y: where[1], layer: onLayer, rodTip, bobber, line, bobberSprite,
        rippleSprite: optional('rippleSprite'), splashSprite: optional('splashSprite'),
      }
    }
  }

  const fish: Fish[] = []
  const rawFish = Array.isArray(json.fish) && json.fish.length > 0 ? json.fish : (c.fail('fish', 'must list at least one fish'), [])
  rawFish.forEach((raw, index) => {
    const at = `fish[${index}]`
    const one = c.object(raw, at)
    if (one === undefined) {
      return
    }
    const id = typeof one.id === 'string' && /^[\w-]+$/.test(one.id) ? one.id : c.fail(`${at}.id`, 'must be a word')
    const sprite = spriteRef(one.sprite, `${at}.sprite`)
    const value = c.number(one.value, `${at}.value`, 0, 100000)
    const weight = c.number(one.weight, `${at}.weight`, 0.01, 1000)
    const size = c.point(one.size, `${at}.size`)
    if (id && sprite && value !== undefined && weight !== undefined && size) {
      fish.push({ id, sprite, value, weight, size })
    }
  })

  const focus = c.point(json.focus, 'focus')
  const glow = json.glow === undefined ? '' : typeof json.glow === 'string' && [...json.glow].every(k => keys.has(k))
    ? json.glow
    : (c.fail('glow', 'must be a string of palette keys'), '')
  const biteRaw = json.biteEverySeconds
  const bite = Array.isArray(biteRaw) && biteRaw.length === 2 && biteRaw.every(n => typeof n === 'number' && n > 0) && biteRaw[0] <= biteRaw[1]
    ? ([biteRaw[0], biteRaw[1]] as [number, number])
    : c.fail('biteEverySeconds', 'must be [min, max] seconds')

  const phases = {} as Theme['phases']
  const rawPhases = c.object(json.phases, 'phases') ?? {}
  for (const phase of PHASES) {
    const entry = c.object(rawPhases[phase], `phases.${phase}`)
    const amount = entry && c.number(entry.amount ?? 0, `phases.${phase}.amount`, 0, 1)
    const tint = entry?.tint === undefined ? 0 : parseHex(entry.tint)
    if (tint === undefined) {
      c.fail(`phases.${phase}.tint`, 'must be a colour like "#1a2b3c"')
    }
    phases[phase] = { tint: tint ?? 0, amount: amount ?? 0 }
  }

  const rawWindow = c.object(json.window, 'window') ?? {}
  const window: WindowStyle = {
    bg: c.color(rawWindow.bg, 'window.bg') ?? '#000000',
    border: c.color(rawWindow.border, 'window.border') ?? '#ffffff',
    text: c.color(rawWindow.text, 'window.text') ?? '#ffffff',
    accent: c.color(rawWindow.accent, 'window.accent') ?? '#ffff00',
    dim: c.color(rawWindow.dim, 'window.dim') ?? '#aaaaaa',
    opacity: c.number(rawWindow.opacity, 'window.opacity', 0, 1) ?? 0.7,
    tab: rawWindow.tab === undefined ? (rawWindow.accent as string) ?? '#ffff00' : c.color(rawWindow.tab, 'window.tab') ?? '#ffff00',
    tabText: rawWindow.tabText === undefined ? (rawWindow.bg as string) ?? '#000000' : c.color(rawWindow.tabText, 'window.tabText') ?? '#000000',
    corners: rawWindow.corners === 'square' ? 'square' : 'round',
  }
  if (rawWindow.corners !== undefined && rawWindow.corners !== 'round' && rawWindow.corners !== 'square') {
    c.fail('window.corners', 'must be "round" or "square"')
  }

  const states = {} as Record<SessionKind, StateLook>
  const rawStates = c.object(json.states ?? {}, 'states') ?? {}
  for (const key of Object.keys(rawStates)) {
    if (!(SESSION_KINDS as readonly string[]).includes(key)) c.fail(`states.${key}`, `is not a state (${SESSION_KINDS.join(', ')})`)
  }
  for (const kind of SESSION_KINDS) {
    const at = `states.${kind}`
    const raw = c.object(rawStates[kind] ?? {}, at) ?? {}
    const look: StateLook = {}
    if (raw.pose !== undefined) {
      look.pose = typeof raw.pose === 'string' && angler && raw.pose in angler.poses ? raw.pose : c.fail(`${at}.pose`, 'must name one of angler.poses')
    }
    if (raw.alert !== undefined) look.alert = spriteRef(raw.alert, `${at}.alert`)
    if (raw.cloud !== undefined) look.cloud = spriteRef(raw.cloud, `${at}.cloud`)
    if (raw.rain !== undefined) look.rain = paletteKey(raw.rain, `${at}.rain`)
    if (raw.phase !== undefined) {
      look.phase = (PHASES as readonly unknown[]).includes(raw.phase) ? (raw.phase as Phase) : c.fail(`${at}.phase`, `must be one of ${PHASES.join(', ')}`)
    }
    if (raw.kinds !== undefined) {
      look.kinds = {}
      for (const [toolKey, value] of Object.entries(c.object(raw.kinds, `${at}.kinds`) ?? {})) {
        const entry = c.object(value, `${at}.kinds.${toolKey}`)
        if (!(TOOL_KINDS as readonly string[]).includes(toolKey)) {
          c.fail(`${at}.kinds.${toolKey}`, `is not a tool kind (${TOOL_KINDS.join(', ')})`)
          continue
        }
        const fishSprite = entry && spriteRef(entry.fish, `${at}.kinds.${toolKey}.fish`)
        const effect = entry?.effect === undefined ? undefined : spriteRef(entry.effect, `${at}.kinds.${toolKey}.effect`)
        if (fishSprite) look.kinds[toolKey as ToolKind] = { fish: fishSprite, effect }
      }
    }
    states[kind] = look
  }

  const sounds: Theme['sounds'] = {}
  for (const [event, file] of Object.entries(c.object(json.sounds ?? {}, 'sounds') ?? {})) {
    if (!(SOUND_EVENTS as readonly string[]).includes(event)) {
      c.fail(`sounds.${event}`, `is not a sound event (${SOUND_EVENTS.join(', ')})`)
    } else if (typeof file !== 'string' || !/^[\w-]+(\/[\w-]+)*\.wav$/.test(file)) {
      c.fail(`sounds.${event}`, 'must be a .wav path inside the theme folder, like "sounds/done.wav"')
    } else {
      sounds[event as SoundEvent] = file
    }
  }

  const fishIds = fish.map(f => f.id)
  const rawLabels = c.object(json.labels, 'labels') ?? {}
  const labels = {} as Record<Locale, Labels>
  const title = {} as Record<Locale, string>
  for (const locale of LOCALES) {
    const checked = checkLabels(c, rawLabels[locale], `labels.${locale}`, fishIds)
    if (checked) {
      labels[locale] = checked
    }
    title[locale] = checked?.location ?? name
  }

  if (c.errors.length > 0 || !angler || !focus || !bite || !outside) {
    return { errors: c.errors.length > 0 ? c.errors : ['theme.json: incomplete'] }
  }

  return {
    errors: [],
    theme: {
      name, title, palette, tileSize, map, outside, tiles, sprites, layers, objects, angler,
      fish, states, sounds, focus, glow, bite, phases, window, labels,
    },
  }
}

export type ThemeOverrides = {
  palette?: Record<string, string>
  window?: Partial<WindowStyle>
  labels?: Partial<Record<Locale, DeepPartial<Labels>>>
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

/**
 * Applies a profile's overrides on top of a compiled theme. Values that are
 * not valid are skipped and reported, never applied.
 */
export function applyOverrides(theme: Theme, overrides: ThemeOverrides): { theme: Theme; warnings: string[] } {
  const warnings: string[] = []
  const palette = new Map(theme.palette)
  for (const [key, value] of Object.entries(overrides.palette ?? {})) {
    const hex = parseHex(value)
    if (!palette.has(key) || hex === undefined) {
      warnings.push(`profile: overrides.palette.${key} skipped (unknown key or not "#rrggbb")`)
      continue
    }
    // A new colour drops the theme's pinned 256-colour index; it snaps to the nearest.
    palette.set(key, { ...palette.get(key), hex, c256: undefined })
  }

  const window = { ...theme.window }
  for (const [key, value] of Object.entries(overrides.window ?? {})) {
    const isOk = key === 'opacity'
      ? typeof value === 'number' && value >= 0 && value <= 1
      : key in window && parseHex(value) !== undefined
    if (isOk) {
      (window as Record<string, unknown>)[key] = value
    } else {
      warnings.push(`profile: overrides.window.${key} skipped`)
    }
  }

  const labels = { ...theme.labels }
  for (const locale of LOCALES) {
    const patch = overrides.labels?.[locale]
    if (patch !== undefined) {
      labels[locale] = mergeLabels(labels[locale], patch, `overrides.labels.${locale}`, warnings)
    }
  }

  return { theme: { ...theme, palette, window, labels }, warnings }
}

function mergeLabels<T>(base: T, patch: unknown, path: string, warnings: string[]): T {
  if (Array.isArray(base)) {
    return Array.isArray(patch) && patch.every(v => typeof v === 'string' && v !== '')
      ? (patch as T)
      : (warnings.push(`profile: ${path} skipped (a list of words)`), base)
  }
  if (typeof base === 'string') {
    return typeof patch === 'string' && patch !== ''
      ? (patch as T)
      : (warnings.push(`profile: ${path} skipped (a word)`), base)
  }
  if (!isObject(patch)) {
    warnings.push(`profile: ${path} skipped (an object)`)
    return base
  }
  const out = { ...(base as Json) }
  for (const [key, value] of Object.entries(patch)) {
    if (key in out) {
      out[key] = mergeLabels(out[key], value, `${path}.${key}`, warnings)
    } else {
      warnings.push(`profile: ${path}.${key} skipped (no such label)`)
    }
  }

  return out as T
}
