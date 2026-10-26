// The one frame timer and when it rests. Active: the profile's fps. After
// `slowAfterMs` without activity: one frame a second. After `freezeAfterMs`:
// no frames at all until something happens. Hidden or unplaced: stopped.

export type Clock = {
  now: () => Promise<number>
  /** starts an interval */
  every: (ms: number, fn: () => void) => { cancel: () => void }
}

export type LoopConfig = { fps: number; slowAfterMs: number; freezeAfterMs: number }

export type LoopMode = 'active' | 'slow' | 'frozen'

export function modeFor(config: LoopConfig, idleMs: number): LoopMode {
  if (idleMs >= config.freezeAfterMs) return 'frozen'
  if (idleMs >= config.slowAfterMs) return 'slow'
  return 'active'
}

/** How often the pane's visibility is checked while the timer runs. */
export const VISIBILITY_CHECK_MS = 2000

export type LoopHooks = {
  /** draws and repaints one frame; false when the pane is gone */
  frame: (now: number) => Promise<boolean>
  /** whether the pane is placed and shown */
  isVisible: () => Promise<boolean>
}

export class FrameLoop {
  private timer: { cancel: () => void } | undefined
  /** the mode the running timer's period was chosen for */
  private timerMode: 'active' | 'slow' = 'active'
  private lastActivity = 0
  private lastCheck = 0
  private isBusy = false
  /** why the loop is not running, for /fishing status */
  stopReason: 'not started' | 'hidden' | 'frozen' | 'closed' | undefined = 'not started'

  constructor(
    private readonly clock: Clock,
    private config: LoopConfig,
    private readonly hooks: LoopHooks,
  ) {}

  get isRunning(): boolean {
    return this.timer !== undefined
  }

  get interval(): number {
    return Math.max(50, Math.round(1000 / this.config.fps))
  }

  configure(config: LoopConfig): void {
    this.config = config
    if (this.timer) {
      this.stop('not started')
      this.start(this.timerMode === 'slow' ? 'slow' : 'active')
    }
  }

  /** Something happened (a prompt, a turn, a press): wake to full speed. */
  async poke(): Promise<void> {
    this.lastActivity = await this.clock.now()
    if (this.timer && this.timerMode !== 'active') {
      this.stop('not started')
      this.start('active')
    } else if (!this.timer && this.stopReason === 'frozen') {
      this.start('active')
    }
  }

  /** Starts the timer unless it runs; a render of the pane calls this. */
  async ensure(): Promise<void> {
    if (this.timer) return
    const now = await this.clock.now()
    if (this.lastActivity === 0 || this.stopReason === 'frozen') {
      this.lastActivity = now
    }
    this.start(this.mode(now) === 'slow' ? 'slow' : 'active')
  }

  stop(reason: 'hidden' | 'frozen' | 'closed' | 'not started'): void {
    this.timer?.cancel()
    this.timer = undefined
    this.stopReason = reason
  }

  mode(now: number): LoopMode {
    return modeFor(this.config, now - this.lastActivity)
  }

  /** One timer: the profile's fps while active, once a second while slow. */
  private start(mode: 'active' | 'slow'): void {
    this.stopReason = undefined
    this.timerMode = mode
    this.timer = this.clock.every(mode === 'slow' ? 1000 : this.interval, () => {
      void this.tick()
    })
  }

  private async tick(): Promise<void> {
    if (this.isBusy) return
    this.isBusy = true
    try {
      const now = await this.clock.now()
      const mode = this.mode(now)
      if (mode === 'frozen') {
        this.stop('frozen')
        return
      }
      if (now - this.lastCheck >= VISIBILITY_CHECK_MS) {
        this.lastCheck = now
        if (!(await this.hooks.isVisible())) {
          this.stop('hidden')
          return
        }
      }
      if (mode !== this.timerMode) {
        this.stop('not started')
        this.start(mode)
      }
      if (!(await this.hooks.frame(now))) {
        this.stop('hidden')
      }
    } finally {
      this.isBusy = false
    }
  }
}
