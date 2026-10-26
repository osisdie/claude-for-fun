import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FishingGame, FishingHud } from '../types'
import {
  choosePlayer, playArgv, PROBED_COMMANDS, SOUND_EVENTS, SoundGate, type Probe, type ResolvedPlayer, type SoundEvent,
} from './audio'
import { ColorSnapper } from './color'
import { frameInput } from './compose'
import { Fishing, type Catch, type FishingEvent } from './fishing'
import { addCatch, menuAt, moveCursor, NEW_GAME, parseGame, type Direction } from './game'
import { ASCII_GLYPHS, layoutHud, UNICODE_GLYPHS, type HudLayout } from './hud'
import { listThemes, loadTheme, readTheme, type ThemeIO } from './loader'
import { DEFAULT_PROFILE, offsetMinutes, parseProfile, type Profile } from './profile'
import { encodeCells, toRuns } from './raster'
import { Scene } from './scene'
import { effective, HOLD_MS, isPersonAsked, NEW_SESSION, reduce, type SessionEvent, type SessionKind, type SessionState } from './session'
import { NO_USAGE, statValue, STAT_SOURCES, toUsage, type StatSource } from './stats'
import { format } from './text'
import { LOCALES, MENU, type Labels, type MenuId, type MessageId, type Phase, type Theme } from './theme'
import { FrameLoop } from './ticker'
import { localHour, phaseAt } from './time'

const PANE = 'fishing'
const SCENE_KEY = 'scene'
const STORE_GAME = 'game-v1'
/** rows under the map: the message line and the controls */
const FOOTER_ROWS = 2
/** an inline pane (no fullscreen layout) stays short, so the prompt keeps its room */
const INLINE_MAP_ROWS = 10
const MAX_MAP_ROWS = 40
/** the cursor blinks this often while the person is waited on */
const BLINK_MS = 500

// Change a tag when its value's fields change: a reload then reads what the
// earlier code stored as absent instead of misreading it.
const game = atom({ plugin: 'fishing', key: 'game' } as const, NEW_GAME, { shape: 'game-2' })
const hud = atom({ plugin: 'fishing', key: 'hud' } as const, { cursor: 0, message: '', isBite: false }, { shape: 'hud-1' })
const session = atom({ plugin: 'fishing', key: 'session' } as const, NEW_SESSION, { shape: 'session-1' })
const usage = atom({ plugin: 'fishing', key: 'usage' } as const, NO_USAGE, { shape: 'usage-1' })

type Paths = { profile: string; userThemes: string; builtinThemes: string }

type Loaded = {
  theme: Theme
  themeDir: string
  profile: Profile
  paths: Paths
  colorMode: 'truecolor' | '256'
  utcOffset: number
  notices: string[]
}

type Mounted = { columns: number; rows: number; layout: HudLayout; isTerminal: boolean }

// Module state: rebuilt on a reload (which runs session.start again); what
// must survive one lives in `$.state` and `$.store`.
let loading: Promise<Loaded> | undefined
let fishing: Fishing | undefined
let scene: { key: string; scene: Scene } | undefined
let mounted: Mounted | undefined
let loop: FrameLoop | undefined
let lastPhase = ''
let lastShown: SessionKind = 'idle'
let lastBlink = 0
/** the fish a finished turn landed, held up while `done` shows */
let doneCatch: Catch | undefined
const gate = new SoundGate(DEFAULT_PROFILE.sound)
let probing: Promise<Probe> | undefined
const windowsPaths = new Map<string, string>()
const clips = new Map<string, string>()

const labelsOf = (loaded: Loaded): Labels => loaded.theme.labels[loaded.profile.locale]

async function pathsFor($: EngineInterface): Promise<Paths> {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  const user = `${home.replace(/[\\/]$/, '')}/.claude/fishing`

  return { profile: `${user}/profile.json`, userThemes: `${user}/themes`, builtinThemes: `${$.plugin.root}/themes` }
}

function themeIO($: EngineInterface): ThemeIO {
  return {
    readText: path => $.fs.read(path),
    listDirs: async path => (await $.fs.list(path)).filter(entry => entry.kind === 'dir').map(entry => entry.name),
  }
}

async function readProfileJson($: EngineInterface, path: string): Promise<{ raw: unknown; notice?: string }> {
  let text: string
  try {
    text = await $.fs.read(path)
  } catch {
    return { raw: undefined } // no profile yet: the defaults
  }
  try {
    return { raw: JSON.parse(text) }
  } catch (error) {
    return { raw: undefined, notice: `${path}: not valid JSON (${(error as Error).message}); using the defaults` }
  }
}

async function load($: EngineInterface): Promise<Loaded> {
  const paths = await pathsFor($)
  const { raw, notice } = await readProfileJson($, paths.profile)
  const { profile, warnings } = parseProfile(raw)
  const dirs = [paths.userThemes, paths.builtinThemes]
  const loadedTheme = await loadTheme(themeIO($), profile.theme, dirs, profile.overrides)
  const colorTerm = (await $.env.get('COLORTERM')) ?? ''
  const colorMode = profile.colorMode === 'auto'
    ? (/truecolor|24bit/i.test(colorTerm) ? 'truecolor' : '256')
    : profile.colorMode

  return {
    theme: loadedTheme.theme,
    themeDir: loadedTheme.dir,
    profile,
    paths,
    colorMode,
    utcOffset: await utcOffsetFor($, profile),
    notices: [...(notice ? [notice] : []), ...warnings, ...loadedTheme.notices],
  }
}

/** The local time zone: the profile's, else the host's `date +%z`, else the runtime's. */
async function utcOffsetFor($: EngineInterface, profile: Profile): Promise<number> {
  const fromProfile = offsetMinutes(profile.utcOffset)
  if (fromProfile !== undefined) {
    return fromProfile
  }
  try {
    const ran = await $.process.run(['date', '+%z'])
    const fromHost = offsetMinutes(ran.stdout.trim())
    if (ran.exitCode === 0 && fromHost !== undefined) {
      return fromHost
    }
  } catch {
    // no `date` here (or no processes at all): fall through
  }

  return -new Date().getTimezoneOffset()
}

function ensureLoaded($: EngineInterface): Promise<Loaded> {
  if (!loading) {
    loading = load($).then(async loaded => {
      scene = undefined
      const record = await read($, game)
      const labels = loaded.theme.labels[loaded.profile.locale]
      fishing = new Fishing(loaded.theme.fish, loaded.theme.bite, Math.random, await $.clock.now())
      fishing.setBait(record.bait % labels.baits.length)
      fishing.setRod(record.rod % labels.rods.length)
      gate.configure(loaded.profile.sound)
      clips.clear()
      if (loaded.notices.length > 0) {
        $.ui.log(`fishing: ${loaded.notices.join('\n')}`)
      }
      loop?.configure(loopConfig(loaded.profile))
      return loaded
    })
    loading.catch(() => {
      loading = undefined // try again on the next draw or command
    })
  }

  return loading
}

const loopConfig = (profile: Profile) => ({
  fps: Math.min(8, Math.max(2, profile.fps)),
  slowAfterMs: profile.idleSlowMinutes * 60_000,
  freezeAfterMs: profile.idleFreezeMinutes * 60_000,
})

function frameLoop($: EngineInterface): FrameLoop {
  loop ??= new FrameLoop(
    { now: () => $.clock.now(), every: (ms, fn) => $.clock.every(ms, fn) },
    loopConfig(DEFAULT_PROFILE),
    {
      frame: now => paint($, now),
      isVisible: async () => (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced && pane.isShown),
    },
  )

  return loop
}

function sceneFor(loaded: Loaded, columns: number, rows: number): Scene {
  const key = `${columns}x${rows}`
  if (scene?.key !== key) {
    const pinned = new Map<number, number>()
    for (const entry of loaded.theme.palette.values()) {
      if (entry.c256 !== undefined) pinned.set(entry.hex, entry.c256)
    }
    scene = { key, scene: new Scene(loaded.theme, columns, rows * 2, new ColorSnapper(loaded.colorMode, pinned)) }
  }

  return scene.scene
}

const phaseNow = (loaded: Loaded, now: number): Phase => phaseAt(localHour(now, loaded.utcOffset))

function renderFrame(loaded: Loaded, now: number, size: Mounted, state: SessionState) {
  return sceneFor(loaded, size.columns, size.rows).render(frameInput(loaded.theme, effective(state, now), now, {
    clockPhase: phaseNow(loaded, now),
    idleView: fishing!.view(now),
    landed: doneCatch,
    layout: size.layout,
  }))
}

/** One tick of the frame timer: advance the angler, repaint the map. */
async function paint($: EngineInterface, now: number): Promise<boolean> {
  if (!mounted?.isTerminal || !loading) {
    return false
  }
  const loaded = await ensureLoaded($)
  const state = await read($, session)
  const shown = effective(state, now)
  if (shown.kind === 'idle') {
    if (lastShown !== 'idle') fishing!.restart(now)
    await handle($, loaded, fishing!.update(now))
  }
  const phase = phaseNow(loaded, now)
  // The words change with the state (a held state fading included), the
  // time of day, and the blinking cursor while waiting.
  const isBlinking = shown.kind === 'waiting' && now - lastBlink >= BLINK_MS
  if (phase !== lastPhase || shown.kind !== lastShown || isBlinking) {
    lastPhase = phase
    lastShown = shown.kind
    if (isBlinking) lastBlink = now
    $.ui.invalidate('ui.render')
  }
  const size = mounted
  const frame = renderFrame(loaded, now, size, state)
  const blitted = await $.ui.blit({
    requestId: PANE, key: SCENE_KEY, columns: size.columns, rows: size.rows,
    cells: encodeCells(frame, loaded.profile.pixelMode, size.columns, size.rows),
  })
  if (blitted.deny !== undefined) {
    // Resized or unmounted: the next render measures again.
    mounted = undefined
    $.ui.invalidate('ui.render')
    return false
  }

  return true
}

async function say($: EngineInterface, loaded: Loaded, id: MessageId, values: Record<string, string | number> = {}, isBite = false) {
  const message = format(labelsOf(loaded).messages[id], values)
  await update($, hud, value => ({ ...value, message, isBite }))
}

async function saveGame($: EngineInterface, change: (value: FishingGame) => FishingGame): Promise<FishingGame> {
  const next = await update($, game, change)
  await $.store.set(STORE_GAME, next)
  return next
}

async function land($: EngineInterface, loaded: Loaded, fish: Catch, message: MessageId) {
  await saveGame($, record => addCatch(record, fish))
  const name = labelsOf(loaded).fish[fish.id] ?? fish.id
  await say($, loaded, message, { fish: name, size: fish.size, value: fish.value })
}

/** The angler's own game, while Claude is idle. */
async function handle($: EngineInterface, loaded: Loaded, events: FishingEvent[]) {
  for (const event of events) {
    switch (event.type) {
      case 'bite':
        await say($, loaded, 'bite', {}, true)
        void sound($, 'bite')
        break
      case 'catch':
        await land($, loaded, event.fish, 'catch')
        void sound($, 'catch')
        break
      case 'escape':
        await say($, loaded, 'escape')
        break
      case 'reel':
        await say($, loaded, 'reel')
        break
      case 'cast':
        void sound($, 'cast')
        break
      case 'hook':
        break
    }
  }
}

// Sound -------------------------------------------------------------------

/** What the host can play with, found once (a `uname` and a `command -v`). */
function probe($: EngineInterface): Promise<Probe> {
  probing ??= (async () => {
    const run = (argv: string[]) => $.process.run(argv).catch(() => ({ exitCode: 1, stdout: '' }))
    const os = (await run(['uname', '-s'])).stdout.trim()
    const isWsl = (await $.env.get('WSL_DISTRO_NAME')) !== undefined
    const hasPulse = (await $.env.get('PULSE_SERVER')) !== undefined
    const found = await run(['sh', '-c', `for c in ${PROBED_COMMANDS.join(' ')}; do command -v "$c" >/dev/null 2>&1 && echo "$c"; done`])
    return { os, isWsl, hasPulse, commands: new Set(found.stdout.split(/\s+/).filter(Boolean)) }
  })()
  return probing
}

async function playerFor($: EngineInterface, loaded: Loaded): Promise<ResolvedPlayer> {
  return choosePlayer(loaded.profile.sound.player, await probe($))
}

/** Plays a theme's sound for `event` with the profile's player; says how. */
async function play($: EngineInterface, loaded: Loaded, event: SoundEvent): Promise<string> {
  const file = loaded.theme.sounds[event]
  if (!file) return `the theme has no "${event}" sound`
  const path = `${loaded.themeDir}/${file}`
  const player = await playerFor($, loaded)
  const volume = loaded.profile.sound.volume
  if (player === 'none') return 'no player found (set sound.player in the profile)'
  if (player === 'engine') {
    let clip = clips.get(path)
    if (clip === undefined) {
      clip = (await $.fs.read(path, { as: 'bytes' })).base64
      clips.set(path, clip)
    }
    void $.audio.play({ base64: clip, mime: 'audio/wav' }, { gain: volume }).catch(() => undefined)
    return `engine: ${file}`
  }
  let windowsPath: string | undefined
  if (player === 'powershell') {
    windowsPath = windowsPaths.get(path)
    if (windowsPath === undefined) {
      windowsPath = (await $.process.run(['wslpath', '-w', path])).stdout.trim()
      windowsPaths.set(path, windowsPath)
    }
  }
  const argv = playArgv(player, path, volume, windowsPath)
  if (!argv) return `${player}: cannot play ${file}`
  void $.process.run(argv).catch(() => undefined)
  return argv.join(' ')
}

/** A sound for an event, if the gate lets it through: never awaited on a hot path. */
async function sound($: EngineInterface, event: SoundEvent): Promise<void> {
  try {
    const loaded = await ensureLoaded($)
    const now = await $.clock.now()
    const minutes = (Math.floor(now / 60000) + loaded.utcOffset) % 1440
    if (gate.allow(event, now, (minutes + 1440) % 1440)) {
      await play($, loaded, event)
    }
  } catch {
    // a sound is never worth a failure
  }
}

// The session ----------------------------------------------------------------

/** Feeds the state machine and reacts to the state it enters. */
async function moveSession($: EngineInterface, event: SessionEvent) {
  const now = await $.clock.now()
  const before = await read($, session)
  const after = await update($, session, value => reduce(value, event, now))
  if (loop) await loop.poke()
  if (after.kind === before.kind && after.tool === before.tool) return
  if (after.kind === 'done' || after.kind === 'error') {
    // A held state fades by itself; redraw when it has (the frame loop may be
    // resting, and off the terminal there is none).
    const hold = after.kind === 'done' ? HOLD_MS.done : after.isTurn ? HOLD_MS.toolError : HOLD_MS.turnError
    $.clock.after(hold + 50, () => $.ui.invalidate('ui.render'))
  }
  switch (after.kind) {
    case 'thinking':
      if (before.kind !== 'tool' && before.kind !== 'waiting') void sound($, 'cast')
      break
    case 'tool':
      void sound($, 'bite')
      break
    case 'waiting':
      void sound($, 'waiting')
      break
    case 'error':
      void sound($, 'snap')
      break
    case 'done': {
      // A finished turn lands a fish: shown held up, counted in the creel.
      const loaded = await ensureLoaded($)
      doneCatch = fishing?.landFor()
      if (doneCatch) await land($, loaded, doneCatch, 'doneCatch')
      void sound($, 'done')
      break
    }
    case 'idle':
    case 'compacting':
      break
  }
}

async function refreshUsage($: EngineInterface) {
  try {
    const figures = toUsage(await $.session.usage())
    await update($, usage, () => figures)
  } catch {
    // no usage where the host keeps none
  }
}

// Commands -------------------------------------------------------------------

/** A command from the window (or its hotkey): the person's own act. */
async function act($: EngineInterface, id: MenuId) {
  const loaded = await ensureLoaded($)
  const labels = labelsOf(loaded)
  const now = await $.clock.now()
  await frameLoop($).poke()
  switch (id) {
    case 'cast':
      await handle($, loaded, fishing!.recast(now))
      await say($, loaded, 'cast')
      return
    case 'reel': {
      const events = fishing!.reel(now)
      await handle($, loaded, events)
      if (events.some(event => event.type === 'hook' && event.byPlayer)) {
        await update($, hud, value => ({ ...value, isBite: false }))
      }
      return
    }
    case 'bait': {
      const next = await saveGame($, value => ({ ...value, bait: (value.bait + 1) % labels.baits.length }))
      fishing!.setBait(next.bait)
      await say($, loaded, 'bait', { bait: labels.baits[next.bait]! })
      return
    }
    case 'bag': {
      const next = await saveGame($, value => ({ ...value, rod: (value.rod + 1) % labels.rods.length }))
      fishing!.setRod(next.rod)
      await say($, loaded, 'bag', { rod: labels.rods[next.rod]!, bait: labels.baits[next.bait % labels.baits.length]! })
      return
    }
    case 'dex': {
      const record = await read($, game)
      const list = Object.entries(record.bySpecies)
        .filter(([, n]) => n > 0)
        .map(([fishId, n]) => `${labels.fish[fishId] ?? fishId}×${n}`)
        .join(' ')
      await say($, loaded, list === '' ? 'dexEmpty' : 'dex', { list, total: record.total })
      return
    }
    case 'setup': {
      const s = loaded.profile.sound
      await say($, loaded, 'setup', { theme: loaded.theme.name, sound: s.enabled ? (s.alertsOnly ? 'alerts' : 'on') : 'off' })
      return
    }
  }
}

async function moveTo($: EngineInterface, cursor: number) {
  await frameLoop($).poke()
  await update($, hud, value => ({ ...value, cursor }))
}

async function openPane($: EngineInterface) {
  const loaded = await ensureLoaded($)
  return $.ui.open({ id: PANE, title: loaded.theme.title[loaded.profile.locale] })
}

const USAGE = '/fishing [open | close | themes | theme <name> | locale <zh-TW|ja|en> | fps <2-8> | pixel <half|full> | color <auto|truecolor|256> | stats <a,b,c> | sound <on|off|alerts|all|test [event]|player <name>|volume <0-1>|quiet <HH:MM-HH:MM|off>> | reload | status]'

async function runCommand($: EngineInterface, verb: string, value: string): Promise<string> {
  const paths = await pathsFor($)
  const dirs = [paths.userThemes, paths.builtinThemes]
  switch (verb) {
    case '':
    case 'open': {
      const opened = await openPane($)
      return opened.isPlaced ? 'Fishing pane opened. Focus it with ctrl+x tab; r reels in, z runs the ➤ command.' : `The pane waits: ${opened.reason}`
    }
    case 'close':
      await $.ui.close({ id: PANE })
      return 'Fishing pane closed.'
    case 'themes': {
      const loaded = await ensureLoaded($)
      const names = await listThemes(themeIO($), dirs)
      return [
        `Themes (yours in ${paths.userThemes}, built-in in ${paths.builtinThemes}):`,
        ...names.map(name => `${name === loaded.theme.name ? '➤' : ' '} ${name}`),
      ].join('\n')
    }
    case 'theme': {
      if (value === '') return 'Usage: /fishing theme <name>  (see /fishing themes)'
      const found = await readTheme(themeIO($), value, dirs)
      if (!found.theme) {
        return [`Theme "${value}" was not switched to:`, ...found.errors.slice(0, 8).map(err => `  ${err}`)].join('\n')
      }
      await saveProfile($, paths.profile, json => ({ ...json, theme: value }))
      return `Theme is now "${value}" (from ${found.dir}).`
    }
    case 'locale':
    case 'lang':
      if (!(LOCALES as readonly string[]).includes(value)) return `Usage: /fishing locale <${LOCALES.join('|')}>`
      await saveProfile($, paths.profile, json => ({ ...json, locale: value }))
      return `Language is now ${value}.`
    case 'fps': {
      const fps = Number(value)
      if (!Number.isInteger(fps) || fps < 2 || fps > 8) return 'Usage: /fishing fps <2-8>'
      await saveProfile($, paths.profile, json => ({ ...json, fps }))
      return `Drawing at ${fps} frames a second.`
    }
    case 'pixel':
      if (value !== 'half' && value !== 'full') return 'Usage: /fishing pixel <half|full>  (full avoids ▀ for terminals that draw it double-width)'
      await saveProfile($, paths.profile, json => ({ ...json, pixelMode: value }))
      return `Pixel mode is now ${value}.`
    case 'color':
      if (value !== 'auto' && value !== 'truecolor' && value !== '256') return 'Usage: /fishing color <auto|truecolor|256>'
      await saveProfile($, paths.profile, json => ({ ...json, colorMode: value }))
      return `Colour mode is now ${value}.`
    case 'stats': {
      const stats = value.split(/[\s,]+/).filter(Boolean)
      if (stats.length < 1 || stats.length > 4 || !stats.every(s => (STAT_SOURCES as readonly string[]).includes(s))) {
        return `Usage: /fishing stats <1-4 of ${STAT_SOURCES.join(', ')}>`
      }
      await saveProfile($, paths.profile, json => ({ ...json, stats: stats as StatSource[] }))
      return `The status window shows ${stats.join(', ')}.`
    }
    case 'sound':
      return soundCommand($, paths.profile, value)
    case 'reload':
      await reload($)
      return 'Profile and theme read again.'
    case 'status': {
      const loaded = await ensureLoaded($)
      const record = await read($, game)
      const state = await read($, session)
      const player = await playerFor($, loaded)
      return [
        `theme ${loaded.theme.name} (${loaded.themeDir}), locale ${loaded.profile.locale}, ${loaded.profile.pixelMode} pixels, ${loaded.colorMode} colour`,
        `profile ${loaded.paths.profile}`,
        `frames: ${loop?.isRunning ? `running at ${loaded.profile.fps} fps` : `stopped (${loop?.stopReason ?? 'not started'})`}`,
        `session: ${state.kind}${state.tool ? ` (${state.tool})` : ''}, ${state.turns} turns, ${state.toolCalls} tool calls`,
        `sound: ${loaded.profile.sound.enabled ? 'on' : 'off'}${loaded.profile.sound.alertsOnly ? ' (alerts only)' : ''}, player ${player}`,
        `catches ${record.total}`,
        ...loaded.notices,
      ].join('\n')
    }
    default:
      return `Usage: ${USAGE}`
  }
}

async function soundCommand($: EngineInterface, profilePath: string, value: string): Promise<string> {
  const [what = '', arg = ''] = value.split(/\s+/)
  const setSound = (patch: Record<string, unknown>) =>
    saveProfile($, profilePath, json => ({ ...json, sound: { ...(isObject(json.sound) ? json.sound : {}), ...patch } }))
  switch (what) {
    case 'on':
      await setSound({ enabled: true, alertsOnly: false })
      return 'Sound on.'
    case 'off':
      await setSound({ enabled: false })
      return 'Sound off.'
    case 'alerts':
      await setSound({ enabled: true, alertsOnly: true })
      return 'Sound on, for waiting and done only.'
    case 'all':
      await setSound({ alertsOnly: false })
      return 'Every sound event plays (when sound is on).'
    case 'player':
      if (!['auto', 'afplay', 'paplay', 'aplay', 'powershell', 'engine', 'none'].includes(arg)) {
        return 'Usage: /fishing sound player <auto|afplay|paplay|aplay|powershell|engine|none>'
      }
      probing = undefined
      await setSound({ player: arg })
      return `Sound player: ${arg}.`
    case 'volume': {
      const volume = Number(arg)
      if (!(volume >= 0 && volume <= 1)) return 'Usage: /fishing sound volume <0-1>'
      await setSound({ volume })
      return `Volume ${volume}.`
    }
    case 'quiet':
      if (arg !== 'off' && !/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(arg)) return 'Usage: /fishing sound quiet <HH:MM-HH:MM|off>'
      await setSound({ quietHours: arg === 'off' ? '' : arg })
      return arg === 'off' ? 'No quiet hours.' : `Quiet from ${arg.replace('-', ' to ')}.`
    case 'test': {
      // Plays now, whatever the gate says: the person asked to hear it.
      const event = (arg || 'done') as SoundEvent
      if (!SOUND_EVENTS.includes(event)) return `Usage: /fishing sound test [${SOUND_EVENTS.join('|')}]`
      const loaded = await ensureLoaded($)
      return `Playing "${event}": ${await play($, loaded, event)}`
    }
    default:
      return 'Usage: /fishing sound <on|off|alerts|all|test [event]|player <name>|volume <0-1>|quiet <HH:MM-HH:MM|off>>'
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Rewrites profile.json through `change`, keeping everything else in it. */
async function saveProfile($: EngineInterface, path: string, change: (json: Record<string, unknown>) => Record<string, unknown>) {
  const { raw, notice } = await readProfileJson($, path)
  if (notice) {
    throw new Error(`${notice}. Fix the file first; it was left as it is.`)
  }
  await $.fs.write(path, `${JSON.stringify(change(isObject(raw) ? raw : {}), null, 2)}\n`)
  await reload($)
}

async function reload($: EngineInterface) {
  loading = undefined
  mounted = undefined
  // The last message was the old theme's (and maybe another language's).
  await update($, hud, value => ({ ...value, message: '', isBite: false }))
  const loaded = await ensureLoaded($)
  await $.ui.open({ id: PANE, title: loaded.theme.title[loaded.profile.locale] }).catch(() => undefined)
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    frameLoop($) // the timer's `$` is the session's
    await $.command.register({
      name: 'fishing',
      description: 'Open the fishing pane, or change its theme, language, sound and speed',
      argumentHint: '[theme <name> | themes | locale | sound on|off | stats | status ...]',
    })
    const stored = await $.store.get(STORE_GAME)
    if (stored !== undefined) {
      await update($, game, () => parseGame(stored))
    }
    await update($, session, () => ({ ...NEW_SESSION, since: 0 }))
    void refreshUsage($)
    try {
      const loaded = await ensureLoaded($)
      void probe($)
      // Unasked, the engine places it only on a wide terminal; it waits otherwise.
      if (loaded.profile.autoOpen) void openPane($)
    } catch (error) {
      $.ui.log(`fishing: ${(error as Error).message}`)
    }

    return next(e)
  })

  on('command.run', { command: 'fishing' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    const value = rest.join(' ')
    if (loop) await loop.poke()
    try {
      return { text: await runCommand($, verb.toLowerCase(), value) }
    } catch (error) {
      return { text: `fishing: ${(error as Error).message}` }
    }
  })

  // What Claude is doing, from the main loop's own events (a subagent's are
  // its own business). Each hook passes its event on whatever happens here.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await moveSession($, { type: 'turn.start' })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await moveSession($, { type: 'tool.start', tool: String(e.tool) })
    const ran = await next(e)
    await moveSession($, { type: 'tool.end', isError: ran.deny !== undefined || ran.isError === true })
    return ran
  }).catch(($, e, next) => next(e))

  // A permission prompt: the verdict is `ask` and a person answers it.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (isPersonAsked(e, verdict)) {
      await moveSession($, { type: 'ask' })
    }
    return verdict
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    await moveSession($, { type: 'agent.spawn' })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined) {
      await moveSession($, { type: 'turn.complete', reason: e.reason })
      void refreshUsage($)
    }
    return ran
  }).catch(($, e, next) => next(e))

  // A compaction the person sees (not a background precompute).
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined || e.trigger === 'precompute') return next(e)
    await moveSession($, { type: 'compact.start' })
    try {
      return await next(e)
    } finally {
      await moveSession($, { type: 'compact.end' })
    }
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => toUsage(e))
    return next(e)
  }).catch(($, e, next) => next(e))

  // Activity keeps the frames coming; quiet slows, then freezes them.
  on('prompt.submit', async ($, e, next) => {
    if (loop) await loop.poke()
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      loop?.stop('closed')
      mounted = undefined
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Tab, the arrows or a click walking the command window move the cursor too.
  on('ui.focus', async ($, e, next) => {
    const element = e.requestId === PANE ? e.element : undefined
    if (element?.startsWith('menu:')) {
      const index = MENU.indexOf(element.slice('menu:'.length) as MenuId)
      if (index >= 0) await moveTo($, index)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    let loaded: Loaded
    try {
      loaded = await ensureLoaded($)
    } catch (error) {
      return <Text color="red">{`fishing: ${(error as Error).message}`}</Text>
    }
    const { theme, profile } = loaded
    const labels = labelsOf(loaded)
    const style = theme.window
    const glyphs = profile.pixelMode === 'full' ? ASCII_GLYPHS : UNICODE_GLYPHS
    const record = await read($, game)
    const state: FishingHud = await read($, hud)
    const sessionState = await read($, session)
    const figures = await read($, usage)
    const now = await $.clock.now()
    const shown = effective(sessionState, now)
    const isWaiting = shown.kind === 'waiting'
    // While the person is waited on, the cursor blinks.
    const isCursorShown = !isWaiting || Math.floor(now / BLINK_MS) % 2 === 0

    const columns = Math.max(8, Math.min(512, e.props.bodyColumns))
    const room = e.props.scroll.bodyRows - FOOTER_ROWS
    const rows = Math.max(4, Math.min(e.props.placement === 'inline' ? INLINE_MAP_ROWS : MAX_MAP_ROWS, room))
    const stats = profile.stats.map(source => ({ label: labels.stats[source], value: statValue(source, figures, sessionState, record) }))
    const phase = theme.states[shown.kind].phase ?? phaseNow(loaded, now)
    const layout: HudLayout = layoutHud(labels, phase, stats, isCursorShown ? state.cursor : -1, columns, rows, glyphs)
    const isTerminal = e.surface === 'terminal'
    const size: Mounted = { columns, rows, layout, isTerminal }
    lastPhase = phaseNow(loaded, now)
    lastShown = shown.kind
    const frame = renderFrame(loaded, now, size, sessionState)

    let map
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      map = <Raster key={SCENE_KEY} columns={columns} rows={rows} cells={encodeCells(frame, profile.pixelMode, columns, rows)} />
      mounted = size
      void frameLoop($).ensure()
    } else {
      // No Raster off the terminal: the same frame as coloured text, still.
      map = (
        <Box flexDirection="column">
          {toRuns(frame, profile.pixelMode, columns, rows).map(runs => (
            <Text>
              {runs.map(run => <Text color={run.fg || undefined} backgroundColor={run.bg}>{run.text}</Text>)}
            </Text>
          ))}
        </Box>
      )
    }

    const status = layout.status && [
      <Box position="absolute" top={layout.status.tab.rect.y} left={layout.status.tab.rect.x + 1}>
        <Text color={style.tabText} backgroundColor={style.tab} bold>{layout.status.tab.text}</Text>
      </Box>,
      <Box position="absolute" top={layout.status.rect.y + 1} left={layout.status.rect.x + 1} flexDirection="column">
        {layout.status.lines.map(line => (
          <Text color={style.text} backgroundColor={style.bg}>{` ${line} `}</Text>
        ))}
      </Box>,
    ]
    const menu = layout.menu && (
      <Box position="absolute" top={layout.menu.rect.y + 1} left={layout.menu.rect.x + 1} flexDirection="column">
        {layout.menu.rows.map(items => (
          <Box flexDirection="row">
            <Text backgroundColor={style.bg}> </Text>
            {items.map((item, index) => [
              index > 0 && <Text backgroundColor={style.bg}> </Text>,
              <Button key={`menu:${item.id}`} plain onPress={async () => {
                await moveTo($, MENU.indexOf(item.id))
                await act($, item.id)
              }}>
                <Text color={MENU[state.cursor] === item.id ? style.accent : style.text} backgroundColor={style.bg}>{item.text}</Text>
              </Button>,
            ])}
            <Text backgroundColor={style.bg}> </Text>
          </Box>
        ))}
      </Box>
    )

    const move = (direction: Direction) => async () => moveTo($, moveCursor((await read($, hud)).cursor, direction))
    const hasRoomForArrows = columns >= 34
    // While Claude works, the line says what it is doing; idle, the game's own.
    const message = shown.kind !== 'idle'
      ? format(labels.states[shown.kind], { tool: labels.tools[shown.tool ?? 'other'] })
      : state.message || format(labels.messages.welcome, { location: labels.location })

    return (
      <Box flexDirection="column">
        <Box width={columns} height={rows}>
          {map}
          {status}
          {menu}
        </Box>
        <Text color={state.isBite || isWaiting ? style.accent : undefined} wrap="truncate-end">{message}</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="reel" plain hotkey="r" label={labels.controls.reel} onPress={() => act($, 'reel')} />
          <Button key="decide" plain hotkey="z" label={labels.controls.decide} onPress={async () => act($, menuAt((await read($, hud)).cursor))} />
          {hasRoomForArrows && <Button key="left" plain hotkey="h" label={glyphs.left} onPress={move('left')} />}
          {hasRoomForArrows && <Button key="down" plain hotkey="j" label={glyphs.down} onPress={move('down')} />}
          {hasRoomForArrows && <Button key="up" plain hotkey="k" label={glyphs.up} onPress={move('up')} />}
          {hasRoomForArrows && <Button key="right" plain hotkey="l" label={glyphs.right} onPress={move('right')} />}
        </Box>
      </Box>
    )
  })
}
