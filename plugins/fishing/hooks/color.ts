// Colours are plain 0xRRGGBB numbers throughout: the Raster takes them as is.

export const DEFAULT_COLOR = 0x01000000 // the terminal's own colour (Raster)

export function parseHex(text: unknown): number | undefined {
  if (typeof text !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(text)) {
    return undefined
  }

  return Number.parseInt(text.slice(1), 16)
}

export function toHex(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, '0')}`
}

/** Moves `from` toward `to` by `amount` (0 keeps `from`, 1 gives `to`). */
export function mix(from: number, to: number, amount: number): number {
  const t = Math.min(1, Math.max(0, amount))
  const channel = (shift: number) => {
    const a = (from >> shift) & 0xff
    const b = (to >> shift) & 0xff

    return Math.round(a + (b - a) * t) << shift
  }

  return channel(16) | channel(8) | channel(0)
}

// The xterm 256-colour table: 16 system colours (left to the terminal's
// theme, so never chosen here), a 6x6x6 cube and 24 greys.
const CUBE_STEPS = [0, 95, 135, 175, 215, 255]

export function xterm256(index: number): number {
  if (index >= 16 && index < 232) {
    const n = index - 16
    const r = CUBE_STEPS[Math.floor(n / 36)]!
    const g = CUBE_STEPS[Math.floor(n / 6) % 6]!
    const b = CUBE_STEPS[n % 6]!

    return (r << 16) | (g << 8) | b
  }
  if (index >= 232 && index < 256) {
    const v = 8 + (index - 232) * 10

    return (v << 16) | (v << 8) | v
  }

  return 0
}

function distance(a: number, b: number): number {
  const dr = ((a >> 16) & 0xff) - ((b >> 16) & 0xff)
  const dg = ((a >> 8) & 0xff) - ((b >> 8) & 0xff)
  const db = (a & 0xff) - (b & 0xff)

  // Weighted toward green, as the eye is.
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db
}

/** The xterm-256 index (16-255) nearest to `rgb`. */
export function nearest256(rgb: number): number {
  let best = 16
  let bestDistance = Infinity
  for (let index = 16; index < 256; index++) {
    const d = distance(rgb, xterm256(index))
    if (d < bestDistance) {
      best = index
      bestDistance = d
    }
  }

  return best
}

/**
 * Maps colours for the active colour mode, memoised: in `256` mode each one
 * snaps to the xterm-256 entry nearest it, or to the entry the theme pinned
 * for that exact palette colour, so the terminal never picks for us.
 */
export class ColorSnapper {
  private readonly cache = new Map<number, number>()

  constructor(
    private readonly mode: 'truecolor' | '256',
    private readonly pinned: ReadonlyMap<number, number> = new Map(),
  ) {}

  snap(rgb: number): number {
    if (this.mode === 'truecolor') {
      return rgb
    }
    let snapped = this.cache.get(rgb)
    if (snapped === undefined) {
      snapped = xterm256(this.pinned.get(rgb) ?? nearest256(rgb))
      this.cache.set(rgb, snapped)
    }

    return snapped
  }
}
