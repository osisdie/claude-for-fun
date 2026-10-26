// From the session's state to what the scene draws: which view of the line,
// which pose, overlays and time of day. Shared by the mod and the screenshot
// tool, so both draw a state the same way.

import { CAST_MS, REEL_MS, type Catch, type FishingView } from './fishing'
import { windowRects, type HudLayout } from './hud'
import type { FrameInput } from './scene'
import { TICKS_PER_SECOND } from './scene'
import type { SessionKind, ToolKind } from './session'
import type { Phase, Theme } from './theme'

/** The session's state as shown (session.ts `effective`). */
export type Shown = { kind: SessionKind; tool?: ToolKind; since: number }

/** The line's picture for a state; `idleView` is the angler's own game. */
export function sessionView(theme: Theme, shown: Shown, now: number, idleView: FishingView, landed?: Catch): FishingView {
  const age = now - shown.since
  switch (shown.kind) {
    case 'idle':
      return idleView
    case 'thinking':
      return age < CAST_MS ? { kind: 'casting', progress: age / CAST_MS } : { kind: 'drift', progress: 0 }
    case 'tool': {
      const kinds = theme.states.tool.kinds
      const look = kinds?.[shown.tool ?? 'other'] ?? kinds?.other
      return { kind: 'struggle', progress: 0, struggle: look ?? { fish: theme.fish[0]!.sprite } }
    }
    case 'done': {
      const fish = landed ?? { id: theme.fish[0]!.id, sprite: theme.fish[0]!.sprite, size: 0, value: 0 }
      return age < REEL_MS
        ? { kind: 'reeling', progress: age / REEL_MS, fish }
        : { kind: 'showing', progress: Math.min(1, (age - REEL_MS) / 1000), fish }
    }
    case 'error':
      return { kind: 'snap', progress: 0 }
    case 'waiting':
    case 'compacting':
      return { kind: 'drift', progress: 0 }
  }
}

/** Everything one frame needs, for a state at `now`. */
export function frameInput(
  theme: Theme,
  shown: Shown,
  now: number,
  options: { clockPhase: Phase; idleView: FishingView; landed?: Catch; layout: HudLayout },
): FrameInput {
  const look = theme.states[shown.kind]
  return {
    tick: Math.floor((now * TICKS_PER_SECOND) / 1000),
    phase: look.phase ?? options.clockPhase,
    fishing: sessionView(theme, shown, now, options.idleView, options.landed),
    windows: windowRects(options.layout, shown.kind === 'waiting'),
    pose: look.pose,
    alert: look.alert,
    cloud: look.cloud,
    rain: look.rain,
  }
}
