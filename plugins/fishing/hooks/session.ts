// What Claude is doing, as one small state machine fed by the hooks in
// register.tsx. Pure: `reduce` takes an event and the time, `effective`
// applies the timed holds (done and error fade back by themselves), so the
// renderer reads one value and the tests drive it without a session.

import type { FishingSession } from '../types'

export const SESSION_KINDS = ['idle', 'thinking', 'tool', 'waiting', 'done', 'error', 'compacting'] as const
export type SessionKind = (typeof SESSION_KINDS)[number]

export const TOOL_KINDS = ['read', 'edit', 'bash', 'web', 'agent', 'other'] as const
export type ToolKind = (typeof TOOL_KINDS)[number]

/**
 * `kind`, and `tool` while it is `tool`; `since` when `kind` last changed;
 * `isTurn` while a turn of the main loop runs; `inFlight` its tool calls still
 * running; the counts are this session's. Declared in the state contract.
 */
export type SessionState = FishingSession

export const NEW_SESSION: SessionState = {
  kind: 'idle', since: 0, isTurn: false, inFlight: 0, turns: 0, toolCalls: 0, errors: 0,
}

export type SessionEvent =
  | { type: 'turn.start' }
  | { type: 'tool.start'; tool: string }
  | { type: 'tool.end'; isError: boolean }
  /** the person must answer: a permission prompt or a question */
  | { type: 'ask' }
  | { type: 'agent.spawn' }
  | { type: 'turn.complete'; reason: 'answer' | 'aborted' | 'refusal' | 'error' }
  | { type: 'compact.start' }
  | { type: 'compact.end' }

/** How long `done` and `error` show before the scene settles again. */
export const HOLD_MS = { done: 3000, turnError: 4000, toolError: 2000 }

const TOOL_NAMES: Record<Exclude<ToolKind, 'other'>, readonly string[]> = {
  read: ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'ToolSearch', 'ListMcpResourcesTool', 'ReadMcpResourceTool'],
  edit: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
  bash: ['Bash', 'PowerShell', 'BashOutput', 'KillShell', 'Monitor'],
  web: ['WebFetch', 'WebSearch'],
  agent: ['Agent', 'Task', 'Workflow', 'SendMessage'],
}

/** The tools that put a question to the person rather than doing work. */
export const QUESTION_TOOLS: readonly string[] = ['AskUserQuestion']

/**
 * Whether a permission verdict puts a prompt in front of the person: an ask,
 * on a real call of the main loop (not a query), that a person answers.
 */
export function isPersonAsked(
  check: { tool_use_id?: string; agentId?: string; approver?: string },
  verdict: { decision: string },
): boolean {
  return verdict.decision === 'ask' && check.tool_use_id !== undefined && check.agentId === undefined && check.approver === 'person'
}

export function toolKind(tool: string): ToolKind {
  for (const kind of Object.keys(TOOL_NAMES) as (keyof typeof TOOL_NAMES)[]) {
    if (TOOL_NAMES[kind].includes(tool)) return kind
  }
  return 'other'
}

const enter = (s: SessionState, kind: SessionKind, now: number, tool?: ToolKind): SessionState =>
  ({ ...s, kind, tool: kind === 'tool' ? tool : undefined, since: now })

/** Where a turn rests between its calls. */
const resting = (s: SessionState): SessionKind => (s.isTurn ? 'thinking' : 'idle')

export function reduce(s: SessionState, event: SessionEvent, now: number): SessionState {
  switch (event.type) {
    case 'turn.start':
      return enter({ ...s, isTurn: true, inFlight: 0, turns: s.turns + 1 }, 'thinking', now)
    case 'tool.start': {
      const next = { ...s, inFlight: s.inFlight + 1, toolCalls: s.toolCalls + 1 }
      return QUESTION_TOOLS.includes(event.tool) ? enter(next, 'waiting', now) : enter(next, 'tool', now, toolKind(event.tool))
    }
    case 'agent.spawn':
      return s.isTurn ? enter(s, 'tool', now, 'agent') : s
    case 'ask':
      return enter(s, 'waiting', now)
    case 'tool.end': {
      const inFlight = Math.max(0, s.inFlight - 1)
      if (event.isError) {
        return enter({ ...s, inFlight, errors: s.errors + 1 }, 'error', now)
      }
      // Another call still running keeps the line taut.
      if (inFlight > 0 && s.kind === 'tool') return { ...s, inFlight }
      return enter({ ...s, inFlight }, resting(s), now)
    }
    case 'turn.complete': {
      const ended = { ...s, isTurn: false, inFlight: 0 }
      return event.reason === 'answer'
        ? enter(ended, 'done', now)
        : enter({ ...ended, errors: s.errors + 1 }, 'error', now)
    }
    case 'compact.start':
      return enter(s, 'compacting', now)
    case 'compact.end':
      return s.kind === 'compacting' ? enter(s, resting(s), now) : s
  }
}

/** The state as shown at `now`: a held `done` or `error` has faded back. */
export function effective(s: SessionState, now: number): { kind: SessionKind; tool?: ToolKind; since: number } {
  const age = now - s.since
  if (s.kind === 'done' && age >= HOLD_MS.done) {
    return { kind: 'idle', since: s.since + HOLD_MS.done }
  }
  if (s.kind === 'error') {
    const hold = s.isTurn ? HOLD_MS.toolError : HOLD_MS.turnError
    if (age >= hold) return { kind: resting(s), since: s.since + hold }
  }

  return { kind: s.kind, tool: s.tool, since: s.since }
}
