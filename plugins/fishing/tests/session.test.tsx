import { describe, expect, test, type Engine } from 'claude-code/testing'

import { sessionView } from '../hooks/compose'
import { CAST_MS } from '../hooks/fishing'
import { loadTheme, type ThemeIO } from '../hooks/loader'
import { effective, HOLD_MS, isPersonAsked, NEW_SESSION, reduce, toolKind, type SessionEvent, type SessionState } from '../hooks/session'
import { formatCost, statValue, toUsage } from '../hooks/stats'
import { NEW_GAME } from '../hooks/game'
import { PANE, themeFiles, world } from './fixtures'

/** Runs events through the reducer, a second apart. */
function run(...events: SessionEvent[]): SessionState {
  return events.reduce((s, e, i) => reduce(s, e, (i + 1) * 1000), NEW_SESSION)
}

describe('the session state machine', () => {
  test('a turn: thinking, a tool, thinking again, done, then idle after the hold', () => {
    const s1 = run({ type: 'turn.start' })
    expect(s1).toMatchObject({ kind: 'thinking', isTurn: true, turns: 1 })
    const s2 = reduce(s1, { type: 'tool.start', tool: 'Edit' }, 2000)
    expect(s2).toMatchObject({ kind: 'tool', tool: 'edit', inFlight: 1, toolCalls: 1 })
    const s3 = reduce(s2, { type: 'tool.end', isError: false }, 3000)
    expect(s3).toMatchObject({ kind: 'thinking', inFlight: 0 })
    const s4 = reduce(s3, { type: 'turn.complete', reason: 'answer' }, 4000)
    expect(s4).toMatchObject({ kind: 'done', isTurn: false })
    expect(effective(s4, 4000 + HOLD_MS.done - 1).kind).toBe('done')
    expect(effective(s4, 4000 + HOLD_MS.done).kind).toBe('idle')
  })

  test('tools are sorted into kinds', () => {
    expect(['Read', 'Grep', 'Edit', 'Write', 'Bash', 'WebFetch', 'Agent', 'mcp__x__y'].map(toolKind))
      .toEqual(['read', 'read', 'edit', 'edit', 'bash', 'web', 'agent', 'other'])
  })

  test('parallel calls keep the line taut until the last one ends', () => {
    const s = run({ type: 'turn.start' }, { type: 'tool.start', tool: 'Read' }, { type: 'tool.start', tool: 'Bash' }, { type: 'tool.end', isError: false })
    expect(s).toMatchObject({ kind: 'tool', tool: 'bash', inFlight: 1 })
    expect(reduce(s, { type: 'tool.end', isError: false }, 9000).kind).toBe('thinking')
  })

  test('a question tool or a permission prompt waits on the person', () => {
    expect(run({ type: 'turn.start' }, { type: 'tool.start', tool: 'AskUserQuestion' }).kind).toBe('waiting')
    expect(run({ type: 'turn.start' }, { type: 'tool.start', tool: 'Bash' }, { type: 'ask' }).kind).toBe('waiting')
  })

  test('only a real ask a person answers counts as a permission prompt', () => {
    const real = { tool_use_id: 'u1', approver: 'person' }
    expect(isPersonAsked(real, { decision: 'ask' })).toBe(true)
    expect(isPersonAsked(real, { decision: 'allow' })).toBe(false)
    expect(isPersonAsked({ approver: 'person' }, { decision: 'ask' })).toBe(false) // a query
    expect(isPersonAsked({ ...real, agentId: 'a1' }, { decision: 'ask' })).toBe(false) // a subagent's
    expect(isPersonAsked({ ...real, approver: 'host' }, { decision: 'ask' })).toBe(false)
  })

  test('a failed tool flashes an error, then the turn goes on thinking', () => {
    const s = run({ type: 'turn.start' }, { type: 'tool.start', tool: 'Bash' }, { type: 'tool.end', isError: true })
    expect(s).toMatchObject({ kind: 'error', errors: 1 })
    expect(effective(s, 3000 + HOLD_MS.toolError).kind).toBe('thinking')
  })

  test('an interrupted or failed turn is an error that fades to idle', () => {
    for (const reason of ['aborted', 'error', 'refusal'] as const) {
      const s = run({ type: 'turn.start' }, { type: 'turn.complete', reason })
      expect(s.kind).toBe('error')
      expect(effective(s, 2000 + HOLD_MS.turnError).kind).toBe('idle')
    }
  })

  test('compacting, then back to where it was', () => {
    const s = run({ type: 'turn.start' }, { type: 'compact.start' })
    expect(s.kind).toBe('compacting')
    expect(reduce(s, { type: 'compact.end' }, 5000).kind).toBe('thinking')
    expect(reduce(run({ type: 'compact.start' }), { type: 'compact.end' }, 5000).kind).toBe('idle')
  })
})

describe('the HUD stats', () => {
  test('each source maps a session figure', () => {
    const usage = toUsage({ context: { percent: 28 }, rateLimits: [{ kind: 'seven_day', percentUsed: 19.5 }, { kind: 'five_hour', percentUsed: 60 }], cost: { usd: 1.234 } })
    const session = { ...NEW_SESSION, turns: 7, toolCalls: 31 }
    const game = { ...NEW_GAME, total: 4 }
    const values = (['contextLeft', 'cost', 'turns', 'tools', 'weeklyLeft', 'fiveHourLeft', 'catches'] as const)
      .map(source => statValue(source, usage, session, game))
    expect(values).toEqual(['72%', '$1.23', '7', '31', '81%', '40%', '4'])
  })

  test('a figure the host has not reported shows as --', () => {
    expect(statValue('contextLeft', toUsage({}), NEW_SESSION, NEW_GAME)).toBe('--')
    expect(formatCost(undefined)).toBe('--')
    expect(formatCost(123.4)).toBe('$123')
  })
})

describe('the scene per state', () => {
  const io: ThemeIO = {
    readText: async path => {
      const text = themeFiles()[path.split('/').pop()!]
      if (text === undefined) throw new Error('ENOENT')
      return text
    },
    listDirs: async () => [],
  }

  test('each state picks its view, pose, overlay and sound from the theme', async () => {
    const { theme } = await loadTheme(io, 'river-rpg', ['/t'])
    const idle = { kind: 'drift' as const, progress: 0 }
    const at = (kind: Parameters<typeof sessionView>[1]['kind'], age: number, tool?: 'edit' | 'web') =>
      sessionView(theme, { kind, tool, since: 0 }, age, idle)
    expect(at('idle', 0)).toBe(idle)
    expect(at('thinking', 0).kind).toBe('casting')
    expect(at('thinking', CAST_MS).kind).toBe('drift')
    expect(at('tool', 0, 'edit')).toMatchObject({ kind: 'struggle', struggle: { fish: 'fish', effect: 'bobber' } })
    expect(at('tool', 0, 'web')).toMatchObject({ kind: 'struggle', struggle: { fish: 'fish' } }) // falls back to `other`
    expect(at('done', 0).kind).toBe('reeling')
    expect(at('done', 5000).kind).toBe('showing')
    expect(at('error', 0).kind).toBe('snap')
    expect(theme.states.idle.pose).toBe('sit')
    expect(theme.states.waiting.alert).toBe('rock')
    expect(theme.states.compacting).toEqual({ phase: 'night', rain: 'c' })
    expect(theme.sounds).toEqual({ done: 'sounds/done.wav', waiting: 'sounds/waiting.wav', bite: 'sounds/bite.wav' })
  })
})

describe('the session, in the mod', () => {
  const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  test('the state follows turn, tool, question and the end of the turn', async ($, on) => {
    const w = world(on)
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    // Stands for the engine running a tool: it holds the call open until released.
    let release = () => {}
    on('tool.call', () => new Promise(resolve => {
      release = () => resolve({ result: {} })
    }))
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const line = async () => (await ui.find({ type: 'Text', text: /zh-TW:state:/ }))?.text

    await $.turn.start({ text: 'hi', turnId: 't1' })
    expect(await line()).toBe('zh-TW:state:thinking')

    const editing = $.tool.call({ tool: 'Edit', tool_use_id: 'u1', file_path: '/x', old_string: 'a', new_string: 'b' } as never)
    await w.clock.settle()
    expect(await line()).toBe('zh-TW:state:tool:t-edit')
    release()
    await editing
    expect(await line()).toBe('zh-TW:state:thinking')

    // A question to the person waits on them while it is open.
    const asking = $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'u2', questions: [] } as never)
    await w.clock.settle()
    expect(await line()).toBe('zh-TW:state:waiting')
    release()
    await asking

    await $.turn.complete({ answer: '', durationMs: 5000, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(await line()).toBe('zh-TW:state:done')
    // A finished turn lands a fish in the creel.
    expect(w.store.get('game-v1')).toMatchObject({ total: 1 })
    await w.clock.advance(HOLD_MS.done + 100)
    expect(await ui.find({ type: 'Text', text: /zh-TW:state:/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a compaction shows, a background precompute does not', async ($, on) => {
    const w = world(on)
    let release = () => {}
    on('session.compact', (_, e) => new Promise(resolve => {
      release = () => resolve({ messages: e.messages })
    }))
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const line = async () => (await ui.find({ type: 'Text', text: /zh-TW:state:/ }))?.text
    const messages = [{ role: 'user' as const, text: 'hello', toolUses: [] }]

    const manual = $.session.compact({ trigger: 'manual', messages })
    await w.clock.settle()
    expect(await line()).toBe('zh-TW:state:compacting')
    release()
    await manual
    expect(await line()).toBeUndefined()

    const background = $.session.compact({ trigger: 'precompute', messages })
    await w.clock.settle()
    expect(await line()).toBeUndefined()
    release()
    await background
    await ui.unmount()
  })

  test('the status window shows the session figures the profile asks for', async ($, on) => {
    world(on)
    await start($)
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 60 }, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /Focus\s+72%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Cost\s+\$0\.42/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Turns\s+0/ })).toBeDefined()
    await ui.unmount()
  })
})
