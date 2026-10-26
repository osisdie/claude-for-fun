import { describe, expect, test, type Engine } from 'claude-code/testing'

import { choosePlayer, DEFAULT_SOUND, GLOBAL_GAP_MS, isQuiet, playArgv, SoundGate, type Probe } from '../hooks/audio'
import { HOLD_MS } from '../hooks/session'
import { PROFILE_PATH, world } from './fixtures'

const probe = (patch: Partial<Probe>): Probe => ({ os: 'Linux', isWsl: false, hasPulse: false, commands: new Set(), ...patch })

describe('choosing a player', () => {
  test('auto picks per platform', () => {
    expect(choosePlayer('auto', probe({ os: 'Darwin', commands: new Set(['afplay']) }))).toBe('afplay')
    // WSL with WSLg's PulseAudio: the Linux side plays, no Windows process to start.
    expect(choosePlayer('auto', probe({ isWsl: true, hasPulse: true, commands: new Set(['paplay', 'powershell.exe']) }))).toBe('paplay')
    // WSL without it: Windows' own player.
    expect(choosePlayer('auto', probe({ isWsl: true, commands: new Set(['paplay', 'powershell.exe']) }))).toBe('powershell')
    expect(choosePlayer('auto', probe({ commands: new Set(['aplay']) }))).toBe('aplay')
    expect(choosePlayer('auto', probe({}))).toBe('none')
  })

  test('a named player is used as named', () => {
    expect(choosePlayer('powershell', probe({ os: 'Darwin' }))).toBe('powershell')
  })

  test('each player is called with the file and the volume it understands', () => {
    expect(playArgv('paplay', '/t/done.wav', 0.5)).toEqual(['paplay', '--volume=32768', '/t/done.wav'])
    expect(playArgv('afplay', '/t/done.wav', 0.25)).toEqual(['afplay', '-v', '0.25', '/t/done.wav'])
    expect(playArgv('aplay', '/t/done.wav', 0.5)).toEqual(['aplay', '-q', '/t/done.wav'])
    expect(playArgv('powershell', '/t/done.wav', 1, "\\\\wsl.localhost\\D\\it's.wav")).toEqual([
      'powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
      "(New-Object Media.SoundPlayer '\\\\wsl.localhost\\D\\it''s.wav').PlaySync()",
    ])
    expect(playArgv('none', '/t/done.wav', 1)).toBeUndefined()
  })
})

describe('the sound gate', () => {
  const on = { ...DEFAULT_SOUND, enabled: true }

  test('off by default', () => {
    expect(new SoundGate(DEFAULT_SOUND).allow('done', 0, 600)).toBe(false)
  })

  test('a burst of tool calls makes one bite, not ten', () => {
    const gate = new SoundGate(on)
    const heard = Array.from({ length: 10 }, (_, i) => gate.allow('bite', i * 100, 600)).filter(Boolean)
    expect(heard.length).toBe(1)
    expect(gate.allow('bite', on.minGapMs + 1, 600)).toBe(true)
  })

  test('an alert is not swallowed by a click just before it', () => {
    const gate = new SoundGate(on)
    expect(gate.allow('bite', 0, 600)).toBe(true)
    expect(gate.allow('cast', GLOBAL_GAP_MS - 1, 600)).toBe(false)
    expect(gate.allow('done', GLOBAL_GAP_MS - 1, 600)).toBe(true)
  })

  test('alerts only, mutes and quiet hours', () => {
    expect(new SoundGate({ ...on, alertsOnly: true }).allow('bite', 0, 600)).toBe(false)
    expect(new SoundGate({ ...on, alertsOnly: true }).allow('waiting', 0, 600)).toBe(true)
    expect(new SoundGate({ ...on, mute: ['done'] }).allow('done', 0, 600)).toBe(false)
    expect(isQuiet('22:00-07:00', 23 * 60)).toBe(true)
    expect(isQuiet('22:00-07:00', 6 * 60 + 59)).toBe(true)
    expect(isQuiet('22:00-07:00', 12 * 60)).toBe(false)
    expect(isQuiet('12:00-13:00', 12 * 60 + 30)).toBe(true)
    // 03:00 UTC is 12:00 at +09:00, inside 11:00-13:00.
    expect(new SoundGate({ ...on, quietHours: '11:00-13:00' }).allow('done', 0, 12 * 60)).toBe(false)
  })
})

describe('sound, in the mod', () => {
  const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const command = ($: Engine, args: string) =>
    $.command.run({ command: 'fishing', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  const played = (runs: string[][]) => runs.filter(argv => ['paplay', 'powershell.exe', 'afplay', 'aplay'].includes(argv[0]!))

  test('WSL with WSLg plays through paplay; a turn ending plays the done sound once', async ($, on) => {
    const w = world(on, undefined, { WSL_DISTRO_NAME: 'Distro', PULSE_SERVER: 'unix:/mnt/wslg/PulseServer' })
    w.host.commands = ['paplay', 'powershell.exe']
    w.fs.files.set(PROFILE_PATH, JSON.stringify({ sound: { enabled: true, volume: 0.5 } }))
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    await start($)

    await $.turn.start({ text: 'hi', turnId: 't1' })
    await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.settle()
    const sounds = played(w.runs)
    expect(sounds.map(argv => argv.at(-1)!.split('/').pop())).toEqual(['done.wav'])
    expect(sounds[0]!.slice(0, 2)).toEqual(['paplay', '--volume=32768'])
    expect(sounds[0]!.at(-1)).toMatch(/themes\/river-rpg\/sounds\/done\.wav$/)
  })

  test('WSL without WSLg plays through Windows, with the Windows path of the file', async ($, on) => {
    const w = world(on, undefined, { WSL_DISTRO_NAME: 'Distro' })
    w.host.commands = ['powershell.exe']
    await start($)
    const answer = await command($, 'sound test waiting')
    expect(answer.text).toContain('powershell.exe')
    const [argv] = played(w.runs)
    expect(argv!.slice(0, 4)).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command'])
    expect(argv![4]).toMatch(/^\(New-Object Media\.SoundPlayer '\\\\wsl\.localhost\\Distro\\.*\\waiting\.wav'\)\.PlaySync\(\)$/)
  })

  test('sound stays off until turned on, and /fishing sound on saves it', async ($, on) => {
    const w = world(on)
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    await start($)
    await $.turn.start({ text: 'hi', turnId: 't1' })
    await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(played(w.runs)).toEqual([])

    await command($, 'sound alerts')
    expect(JSON.parse(w.fs.files.get(PROFILE_PATH)!)).toEqual({ sound: { enabled: true, alertsOnly: true } })
    await w.clock.advance(HOLD_MS.done)
    await $.turn.start({ text: 'again', turnId: 't2' }) // a cast: not an alert, stays quiet
    await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't2', reason: 'answer' })
    await w.clock.settle()
    expect(played(w.runs).map(argv => argv.at(-1)!.split('/').pop())).toEqual(['done.wav'])
  })
})
