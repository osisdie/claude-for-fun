// Sound: which player to use, how to call it, and when to stay quiet.
//
// `$.audio.play` plays through `afplay` on macOS and plays nothing on Linux
// or Windows terminals, so the mod runs a player itself with `$.process.run`
// (the `engine` choice keeps `$.audio.play` for hosts where it does play).

export const PLAYERS = ['auto', 'afplay', 'paplay', 'aplay', 'powershell', 'engine', 'none'] as const
export type Player = (typeof PLAYERS)[number]
export type ResolvedPlayer = Exclude<Player, 'auto'>

export const SOUND_EVENTS = ['cast', 'bite', 'catch', 'snap', 'waiting', 'done'] as const
export type SoundEvent = (typeof SOUND_EVENTS)[number]
/** The alerts worth hearing when the rest is muted. */
export const ALERT_EVENTS: readonly SoundEvent[] = ['waiting', 'done']

/** What the host has, found once per session. */
export type Probe = {
  /** `uname -s`: Darwin, Linux, ... */
  os: string
  isWsl: boolean
  /** a PulseAudio server to talk to (WSLg sets PULSE_SERVER) */
  hasPulse: boolean
  commands: ReadonlySet<string>
}

/** The commands `auto` looks for, in `command -v` order. */
export const PROBED_COMMANDS = ['afplay', 'paplay', 'aplay', 'powershell.exe'] as const

/**
 * `auto`: macOS's afplay; under WSL the Linux side's PulseAudio when WSLg runs
 * it (no process start-up on Windows), else Windows' own player through
 * powershell.exe; plain Linux paplay, then aplay; else nothing.
 */
export function choosePlayer(wanted: Player, probe: Probe): ResolvedPlayer {
  if (wanted !== 'auto') return wanted
  const has = (command: string) => probe.commands.has(command)
  if (probe.os === 'Darwin') return has('afplay') ? 'afplay' : 'engine'
  if (has('paplay') && (probe.hasPulse || !probe.isWsl)) return 'paplay'
  if (probe.isWsl && has('powershell.exe')) return 'powershell'
  if (has('aplay')) return 'aplay'
  return 'none'
}

/**
 * The command that plays `file` (an absolute path) at `volume` (0-1), for a
 * player that runs as a process; `windowsPath` is the file as Windows names
 * it, for powershell. aplay and Windows' SoundPlayer have no volume.
 */
export function playArgv(player: ResolvedPlayer, file: string, volume: number, windowsPath?: string): string[] | undefined {
  const v = Math.min(1, Math.max(0, volume))
  switch (player) {
    case 'afplay':
      return ['afplay', '-v', v.toFixed(2), file]
    case 'paplay':
      return ['paplay', `--volume=${Math.round(v * 65536)}`, file]
    case 'aplay':
      return ['aplay', '-q', file]
    case 'powershell':
      return windowsPath === undefined ? undefined : [
        'powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
        `(New-Object Media.SoundPlayer '${windowsPath.replace(/'/g, "''")}').PlaySync()`,
      ]
    case 'engine':
    case 'none':
      return undefined
  }
}

export type SoundSettings = {
  enabled: boolean
  player: Player
  volume: number
  /** "22:00-07:00"; empty for none */
  quietHours: string
  mute: SoundEvent[]
  /** play only `waiting` and `done` */
  alertsOnly: boolean
  /** the least time between two sounds of one event */
  minGapMs: number
}

export const DEFAULT_SOUND: SoundSettings = {
  enabled: false,
  player: 'auto',
  volume: 0.6,
  quietHours: '',
  mute: [],
  alertsOnly: false,
  minGapMs: 1500,
}

/** Minutes after midnight for each end of "HH:MM-HH:MM", or undefined. */
export function parseQuietHours(text: string): [number, number] | undefined {
  const match = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!match) return undefined
  const [h1, m1, h2, m2] = match.slice(1).map(Number) as [number, number, number, number]
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return undefined
  return [h1 * 60 + m1, h2 * 60 + m2]
}

export function isQuiet(quietHours: string, localMinutes: number): boolean {
  const range = parseQuietHours(quietHours)
  if (!range) return false
  const [from, to] = range
  return from <= to ? localMinutes >= from && localMinutes < to : localMinutes >= from || localMinutes < to
}

/** The least time between any two sounds, so bursts of tool calls don't rattle. */
export const GLOBAL_GAP_MS = 400

/**
 * Says whether a sound may play now: on, not muted, outside quiet hours, and
 * not too soon after the last one (per event and overall).
 */
export class SoundGate {
  private readonly last = new Map<SoundEvent, number>()
  private lastAny = -Infinity

  constructor(private settings: SoundSettings) {}

  configure(settings: SoundSettings): void {
    this.settings = settings
  }

  allow(event: SoundEvent, now: number, localMinutes: number): boolean {
    const s = this.settings
    if (!s.enabled || s.mute.includes(event)) return false
    if (s.alertsOnly && !ALERT_EVENTS.includes(event)) return false
    if (isQuiet(s.quietHours, localMinutes)) return false
    const isAlert = ALERT_EVENTS.includes(event)
    if (now - (this.last.get(event) ?? -Infinity) < s.minGapMs) return false
    // An alert is never swallowed by a click that came just before it.
    if (!isAlert && now - this.lastAny < GLOBAL_GAP_MS) return false
    this.last.set(event, now)
    this.lastAny = now
    return true
  }
}
