// Composes one frame of a theme's scene into a pixel buffer: the tile map,
// the objects depth-sorted per layer, the angler's line and catch, the time
// of day's tint, then the HUD windows' translucent panels on top.

import { ColorSnapper, mix, parseHex } from './color'
import type { FishingView } from './fishing'
import { TRANSPARENT, type Sprite } from './sprites'
import type { Phase, SceneObject, Theme } from './theme'

/** Animation ticks per second: theme speeds count in these. */
export const TICKS_PER_SECOND = 6

export type Rect = {
  x: number
  y: number
  w: number
  h: number
  /** `panel`: translucent with a frame; `tab`: the opaque title tab on top of one */
  kind?: 'panel' | 'tab'
  /** the frame flashes (the person is being waited on) */
  highlight?: boolean
}

export type Frame = {
  width: number
  height: number
  rgb: Uint32Array
  /** what drew each pixel: 0 ground, then layers; higher wins in `full` mode */
  z: Uint8Array
}

export type FrameInput = {
  tick: number
  phase: Phase
  fishing: FishingView
  /** HUD windows, in pixels of this frame */
  windows: readonly Rect[]
  /** a pose name of the angler's, over the one the line implies */
  pose?: string
  /** sprites over the angler: blinking (`alert`) or drifting (`cloud`) */
  alert?: string
  cloud?: string
  /** a palette key: rain falls in it */
  rain?: string
}

const Z_GEAR = 200
const Z_WINDOW = 255

function hash(a: number, b: number, c = 0): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return (h ^ (h >>> 16)) >>> 0
}

const mod = (n: number, m: number) => ((n % m) + m) % m

export class Scene {
  readonly originX: number
  readonly originY: number
  private readonly colors = new Map<string, number>()
  private readonly glow: Uint8Array
  private readonly frame: Frame
  private readonly map: string[][]
  private readonly tints = new Map<Phase, Map<number, number>>()

  constructor(
    private readonly theme: Theme,
    readonly width: number,
    readonly height: number,
    private readonly snapper: ColorSnapper = new ColorSnapper('truecolor'),
  ) {
    for (const [key, entry] of theme.palette) {
      this.colors.set(key, entry.hex)
    }
    this.map = theme.map.map(row => [...row])
    const mapWidth = (this.map[0]?.length ?? 0) * theme.tileSize
    const mapHeight = this.map.length * theme.tileSize
    // Keep the focus (the angler and the bobber) in view; centre a map
    // smaller than the view, the `outside` tile filling the rest.
    const crop = (focus: number, view: number, size: number) =>
      size <= view ? -Math.floor((view - size) / 2) : Math.min(Math.max(0, focus - Math.floor(view / 2)), size - view)
    this.originX = crop(theme.focus[0], width, mapWidth)
    this.originY = crop(theme.focus[1], height, mapHeight)
    this.frame = { width, height, rgb: new Uint32Array(width * height), z: new Uint8Array(width * height) }
    this.glow = new Uint8Array(width * height)
  }

  render(input: FrameInput): Frame {
    this.glow.fill(0)
    this.drawGround(input.tick)
    const layered = this.objectsByLayer(input)
    this.theme.layers.forEach((layer, index) => {
      for (const { object, x, y, frame, flip, sprite } of layered.get(layer) ?? []) {
        this.blit(sprite, frame, x, y, index + 1, flip)
      }
      if (layer === this.theme.angler.layer) {
        this.drawGear(input)
        this.drawOverhead(input)
      }
    })
    if (input.rain) {
      this.drawRain(input.rain, input.tick)
    }
    this.tint(input.phase)
    for (const rect of input.windows) {
      this.drawWindow(rect, input.tick)
    }
    const { rgb } = this.frame
    for (let i = 0; i < rgb.length; i++) {
      rgb[i] = this.snapper.snap(rgb[i]!)
    }

    return this.frame
  }

  private drawGround(tick: number): void {
    const { tileSize, tiles, sprites, outside } = this.theme
    const { width, height, rgb, z } = this.frame
    for (let vy = 0; vy < height; vy++) {
      for (let vx = 0; vx < width; vx++) {
        const X = this.originX + vx
        const Y = this.originY + vy
        const tx = Math.floor(X / tileSize)
        const ty = Math.floor(Y / tileSize)
        const char = this.charAt(tx, ty)
        const tile = tiles.get(char) ?? tiles.get(outside)!
        const sprite = sprites.get(tile.sprite)!
        const step = Math.floor(tick / tile.speed)
        let sx = X
        let sy = Y
        let frameIndex = 0
        if (tile.anim === 'flow') {
          sx -= tile.dir[0] * step
          sy -= tile.dir[1] * step
        } else if (tile.anim === 'loop') {
          frameIndex = step % sprite.frames.length
        } else if (tile.anim === 'sparkle') {
          frameIndex = hash(tx, ty, step) % sprite.frames.length
        }
        const key = sprite.frames[frameIndex]![mod(sy, sprite.height)]![mod(sx, sprite.width)]!
        let color = this.colors.get(key) ?? 0
        if (tile.edge) {
          color = this.edgeColor(tile.edge, X, Y, tx, ty) ?? color
        }
        rgb[vy * width + vx] = color
        z[vy * width + vx] = 0
      }
    }
  }

  private charAt(tx: number, ty: number): string {
    return this.map[ty]?.[tx] ?? this.theme.outside
  }

  /** A shoreline: a 1-px line on the sides that touch another group. */
  private edgeColor(edge: { color: string; group: string }, X: number, Y: number, tx: number, ty: number) {
    const size = this.theme.tileSize
    const lx = mod(X, size)
    const ly = mod(Y, size)
    const outsideGroup = (dx: number, dy: number) => !edge.group.includes(this.charAt(tx + dx, ty + dy))
    const isEdge =
      (lx === 0 && outsideGroup(-1, 0)) ||
      (lx === size - 1 && outsideGroup(1, 0)) ||
      (ly === 0 && outsideGroup(0, -1)) ||
      (ly === size - 1 && outsideGroup(0, 1))

    return isEdge ? this.colors.get(edge.color) : undefined
  }

  private objectsByLayer(input: FrameInput) {
    type Placed = { object: SceneObject; sprite: Sprite; x: number; y: number; frame: number; flip: boolean }
    const byLayer = new Map<string, Placed[]>()
    const { sprites, angler } = this.theme
    const place = (object: SceneObject) => {
      if (object.when && !object.when.includes(input.phase)) {
        return
      }
      const name = input.phase === 'night' && object.night ? object.night : object.sprite
      const sprite = sprites.get(name)!
      const placed = { object, sprite, ...this.animate(object, sprite, input.tick) }
      const list = byLayer.get(object.layer) ?? []
      list.push(placed)
      byLayer.set(object.layer, list)
    }
    this.theme.objects.forEach(place)
    if (angler.sprite !== null) {
      // The pose follows the line unless the session's state names one.
      const byLine = { casting: 'pull', waiting: 'wait', bite: 'pull', reeling: 'pull', showing: 'show', resting: 'wait', drift: 'wait', struggle: 'pull', snap: 'wait' } as const
      const pose = angler.poses[input.pose ?? ''] ?? angler.poses[byLine[input.fishing.kind]] ?? 0
      const sprite = sprites.get(angler.sprite)!
      const frame = Math.min(pose, sprite.frames.length - 1)
      const object: SceneObject = {
        sprite: angler.sprite, x: angler.x, y: angler.y, layer: angler.layer,
        anim: { kind: 'static' }, offset: 0, flip: false,
      }
      const list = byLayer.get(angler.layer) ?? []
      list.push({ object, sprite, x: angler.x, y: angler.y, frame, flip: false })
      byLayer.set(angler.layer, list)
    }
    // Overhead 3/4 view: whatever stands lower on the map is in front.
    for (const list of byLayer.values()) {
      list.sort((a, b) => a.y + a.sprite.height - (b.y + b.sprite.height))
    }

    return byLayer
  }

  private animate(object: SceneObject, sprite: Sprite, tick: number) {
    const frames = sprite.frames.length
    const anim = object.anim
    const t = tick + object.offset
    switch (anim.kind) {
      case 'static':
        return { x: object.x, y: object.y, frame: 0, flip: object.flip }
      case 'loop':
        return { x: object.x, y: object.y, frame: Math.floor(t / anim.speed) % frames, flip: object.flip }
      case 'patrol': {
        // There and back along (dx, dy), facing the way it walks.
        const distance = Math.max(Math.abs(anim.dx), Math.abs(anim.dy), 1)
        const step = Math.floor(t / anim.speed) % (distance * 2)
        const along = step <= distance ? step : distance * 2 - step
        const goingBack = step > distance
        return {
          x: object.x + Math.round((anim.dx * along) / distance),
          y: object.y + Math.round((anim.dy * along) / distance),
          frame: step % frames,
          flip: anim.dx !== 0 && (anim.dx < 0) !== goingBack,
        }
      }
      case 'swim': {
        const step = Math.floor(t / anim.speed) % Math.abs(anim.dx)
        return { x: object.x + Math.sign(anim.dx) * step, y: object.y, frame: step % frames, flip: anim.dx < 0 }
      }
      case 'rise': {
        const step = Math.floor(t / anim.speed) % Math.abs(anim.dy)
        return { x: object.x, y: object.y + Math.sign(anim.dy) * step, frame: step % frames, flip: object.flip }
      }
    }
  }

  /** Draws a sprite at world (x, y). */
  private blit(sprite: Sprite, frameIndex: number, x: number, y: number, zIndex: number, flip = false): void {
    const { width, height, rgb, z } = this.frame
    const rows = sprite.frames[Math.min(frameIndex, sprite.frames.length - 1)]!
    const left = x - this.originX
    const top = y - this.originY
    for (let sy = 0; sy < sprite.height; sy++) {
      const vy = top + sy
      if (vy < 0 || vy >= height) continue
      const row = rows[sy]!
      for (let sx = 0; sx < sprite.width; sx++) {
        const vx = left + sx
        if (vx < 0 || vx >= width) continue
        const key = row[flip ? sprite.width - 1 - sx : sx]!
        if (key === TRANSPARENT) continue
        const i = vy * width + vx
        rgb[i] = this.colors.get(key) ?? 0
        z[i] = zIndex
        this.glow[i] = this.theme.glow.includes(key) ? 1 : 0
      }
    }
  }

  private plot(x: number, y: number, color: number): void {
    const vx = x - this.originX
    const vy = y - this.originY
    if (vx >= 0 && vx < this.width && vy >= 0 && vy < this.height) {
      const i = vy * this.width + vx
      this.frame.rgb[i] = color
      this.frame.z[i] = Z_GEAR
    }
  }

  private line(x0: number, y0: number, x1: number, y1: number, color: number): void {
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    for (let guard = 0; guard < 4096; guard++) {
      this.plot(x0, y0, color)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= dy) { err += dy; x0 += sx }
      if (e2 <= dx) { err += dx; y0 += sy }
    }
  }

  /** The angler's line, bobber, ripples and the fish on its way in. */
  private drawGear({ fishing, tick }: FrameInput): void {
    const { angler, sprites } = this.theme
    const [tipX, tipY] = angler.rodTip
    const [restX, restY] = angler.bobber
    const lineColor = this.colors.get(angler.line)!
    const bobber = sprites.get(angler.bobberSprite)!
    const centred = (sprite: Sprite, x: number, y: number, frame: number) =>
      this.blit(sprite, frame, x - (sprite.width >> 1), y - (sprite.height >> 1), Z_GEAR)
    const p = fishing.progress

    switch (fishing.kind) {
      case 'casting': {
        const x = Math.round(tipX + (restX - tipX) * p)
        const y = Math.round(tipY + (restY - tipY) * p - Math.sin(Math.PI * p) * 6)
        this.line(tipX, tipY, x, y, lineColor)
        centred(bobber, x, y, 0)
        return
      }
      case 'waiting': {
        const ripple = angler.rippleSprite && sprites.get(angler.rippleSprite)
        const cycle = tick % 36
        if (ripple && cycle < ripple.frames.length * 3) {
          centred(ripple, restX, restY, Math.floor(cycle / 3))
        }
        this.line(tipX, tipY, restX, restY - (bobber.height >> 1), lineColor)
        centred(bobber, restX, restY, Math.floor(tick / 4) % Math.min(2, bobber.frames.length))
        return
      }
      case 'bite': {
        const ripple = angler.rippleSprite && sprites.get(angler.rippleSprite)
        if (ripple) {
          centred(ripple, restX, restY, Math.floor(tick / 2) % ripple.frames.length)
        }
        this.line(tipX, tipY, restX, restY, lineColor)
        const dip = bobber.frames.length > 2 && tick % 2 === 0 ? 2 : Math.min(1, bobber.frames.length - 1)
        centred(bobber, restX, restY + (tick % 2), dip)
        return
      }
      case 'reeling': {
        const splash = angler.splashSprite && sprites.get(angler.splashSprite)
        if (splash && p < 0.5) {
          centred(splash, restX, restY, Math.min(splash.frames.length - 1, Math.floor(p * 2 * splash.frames.length)))
        }
        const x = Math.round(restX + (tipX - restX) * p)
        const y = Math.round(restY + (tipY - restY) * p - Math.sin(Math.PI * p) * 8)
        this.line(tipX, tipY, x, y, lineColor)
        const fish = fishing.fish && sprites.get(fishing.fish.sprite)
        if (fish) {
          centred(fish, x, y, tick % fish.frames.length)
        }
        return
      }
      case 'showing': {
        // Held up over the angler's head, as a catch is shown off.
        const fish = fishing.fish && sprites.get(fishing.fish.sprite)
        if (!fish) return
        const anglerSprite = angler.sprite === null ? undefined : sprites.get(angler.sprite)
        const x = anglerSprite ? angler.x + (anglerSprite.width >> 1) : tipX
        const y = anglerSprite ? angler.y - (fish.height >> 1) - 1 : tipY + fish.height
        centred(fish, x, y + (Math.floor(tick / 3) % 2), 0)
        return
      }
      case 'resting':
        return
      case 'drift': {
        // The float drifts on the current while Claude thinks.
        const x = restX + Math.round(Math.sin(tick / 9) * 2)
        this.line(tipX, tipY, x, restY - (bobber.height >> 1), lineColor)
        centred(bobber, x, restY, Math.floor(tick / 4) % Math.min(2, bobber.frames.length))
        return
      }
      case 'struggle': {
        // A fish on: the line taut, the float jerking, the fish thrashing by it.
        const effect = fishing.struggle?.effect && sprites.get(fishing.struggle.effect)
        if (effect) {
          centred(effect, restX, restY, Math.floor(tick / 2) % effect.frames.length)
        }
        const jerk = tick % 4 < 2 ? 1 : -1
        const fish = fishing.struggle && sprites.get(fishing.struggle.fish)
        if (fish) {
          const swing = Math.round(Math.sin(tick / 2) * 3)
          centred(fish, restX + swing, restY + (fish.height >> 1) + 2, tick % fish.frames.length)
        }
        this.line(tipX, tipY, restX + jerk, restY, lineColor)
        centred(bobber, restX + jerk, restY + (tick % 2), bobber.frames.length > 2 ? 2 : 0)
        return
      }
      case 'snap': {
        // The line parted: a short end hangs from the tip, the float is gone.
        const endX = Math.round(tipX + (restX - tipX) * 0.4)
        const endY = Math.round(tipY + (restY - tipY) * 0.4)
        this.line(tipX, tipY, endX, endY, lineColor)
        this.line(endX, endY, endX, endY + 4 + (Math.floor(tick / 3) % 2), lineColor)
        return
      }
    }
  }

  /** Where things float over the angler: above the head, or over the line's end. */
  private overheadPoint(): [number, number] {
    const { angler, sprites } = this.theme
    const sprite = angler.sprite === null ? undefined : sprites.get(angler.sprite)
    return sprite ? [angler.x + (sprite.width >> 1), angler.y - 2] : [angler.bobber[0], angler.bobber[1] - 8]
  }

  private drawOverhead({ alert, cloud, tick }: FrameInput): void {
    const [x, y] = this.overheadPoint()
    const draw = (name: string, dx: number, dy: number) => {
      const sprite = this.theme.sprites.get(name)
      if (sprite) this.blit(sprite, Math.floor(tick / 3) % sprite.frames.length, x - (sprite.width >> 1) + dx, y - sprite.height + dy, Z_GEAR)
    }
    if (alert && tick % 6 < 4) draw(alert, 0, -Math.floor(tick / 3) % 2)
    if (cloud) draw(cloud, (Math.floor(tick / 6) % 3) - 1, -2)
  }

  /** Slanting streaks falling across the view. */
  private drawRain(key: string, tick: number): void {
    const color = this.colors.get(key)
    if (color === undefined) return
    const drops = Math.max(6, Math.floor((this.width * this.height) / 70))
    for (let i = 0; i < drops; i++) {
      const x0 = (hash(i, 7) + tick) % (this.width + this.height)
      const y0 = (hash(i, 13) + tick * 3) % this.height
      for (let k = 0; k < 2; k++) {
        const vx = x0 - (y0 + k) / 2
        const vy = y0 + k
        if (vx >= 0 && vx < this.width && vy < this.height) {
          const at = vy * this.width + Math.floor(vx)
          this.frame.rgb[at] = color
          this.frame.z[at] = Z_GEAR
        }
      }
    }
  }

  private tint(phase: Phase): void {
    const { tint, amount } = this.theme.phases[phase]
    if (amount === 0) return
    let table = this.tints.get(phase)
    if (!table) {
      table = new Map()
      this.tints.set(phase, table)
    }
    const { rgb } = this.frame
    for (let i = 0; i < rgb.length; i++) {
      if (this.glow[i]) continue
      const from = rgb[i]!
      let to = table.get(from)
      if (to === undefined) {
        to = mix(from, tint, amount)
        table.set(from, to)
      }
      rgb[i] = to
    }
  }

  /**
   * A HUD window: the map seen through a tinted panel inside a 1-px frame
   * with rounded corners; a tab is opaque, rounded on top, and has no frame.
   */
  private drawWindow(rect: Rect, tick: number): void {
    const { bg, border, accent, opacity, tab, corners } = this.theme.window
    const fill = parseHex(rect.kind === 'tab' ? tab : bg)!
    const isLit = rect.highlight === true && Math.floor(tick / 3) % 2 === 0
    const frameColor = parseHex(isLit ? accent : border)!
    const { width, height, rgb, z } = this.frame
    const right = rect.x + rect.w - 1
    const bottom = rect.y + rect.h - 1
    const isRound = corners === 'round'
    for (let y = Math.max(0, rect.y); y <= Math.min(height - 1, bottom); y++) {
      for (let x = Math.max(0, rect.x); x <= Math.min(width - 1, right); x++) {
        const isCornerX = x === rect.x || x === right
        if (isRound && isCornerX && (y === rect.y || (y === bottom && rect.kind !== 'tab'))) {
          continue // the map shows through a rounded corner
        }
        const i = y * width + x
        if (rect.kind === 'tab') {
          rgb[i] = fill
        } else {
          const isFrame = isCornerX || y === rect.y || y === bottom
          rgb[i] = isFrame ? frameColor : mix(rgb[i]!, fill, opacity)
        }
        z[i] = Z_WINDOW
      }
    }
  }
}
