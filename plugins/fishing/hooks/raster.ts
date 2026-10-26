// Turns a pixel frame into terminal cells.
//
// `half`: each cell is "▀" (U+2580), its foreground the upper pixel and its
// background the lower one, so a cell holds two pixels and they come out
// about square. `full`: each cell is a space whose background is one pixel,
// for terminals or fonts that draw "▀" two cells wide (East Asian ambiguous
// width); of each pair of rows it keeps the pixel drawn on top.

import { DEFAULT_COLOR } from './color'
import type { Frame } from './scene'
import type { PixelMode } from './profile'

export const UPPER_HALF = 0x2580
const SPACE = 0x20

/** Pixel rows a cell row holds. */
export const pixelsPerRow = (mode: PixelMode) => (mode === 'half' ? 2 : 1)

export type Cell = { char: number; fg: number; bg: number }

/** Cell (column, row) of a frame, `frame.height` being 2 * rows. */
export function cellAt(frame: Frame, mode: PixelMode, column: number, row: number): Cell {
  const top = (row * 2) * frame.width + column
  const bottom = top + frame.width
  if (mode === 'half') {
    return { char: UPPER_HALF, fg: frame.rgb[top]!, bg: frame.rgb[bottom]! }
  }
  const pick = frame.z[bottom]! > frame.z[top]! ? bottom : top

  return { char: SPACE, fg: DEFAULT_COLOR, bg: frame.rgb[pick]! }
}

/** The Raster's `cells`: base64 of little-endian u32 [codePoint, fg, bg] per cell. */
export function encodeCells(frame: Frame, mode: PixelMode, columns: number, rows: number): string {
  const words = new Uint32Array(columns * rows * 3)
  let w = 0
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const cell = cellAt(frame, mode, column, row)
      words[w++] = cell.char
      words[w++] = cell.fg
      words[w++] = cell.bg
    }
  }

  return toBase64(new Uint8Array(words.buffer))
}

type WithBase64 = Uint8Array & { toBase64?: () => string }

function toBase64(bytes: Uint8Array): string {
  const native = (bytes as WithBase64).toBase64
  if (typeof native === 'function') {
    return native.call(bytes)
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }

  return btoa(binary)
}

/** A run of same-coloured cells in one row, for the Text-based fallback. */
export type Run = { text: string; fg: string; bg: string }

const hex = (rgb: number) => `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`

/**
 * The frame as rows of coloured Text runs, for surfaces with no Raster
 * (desktop, VS Code, mobile): heavier, so it is drawn once, not animated.
 */
export function toRuns(frame: Frame, mode: PixelMode, columns: number, rows: number): Run[][] {
  const out: Run[][] = []
  for (let row = 0; row < rows; row++) {
    const runs: Run[] = []
    for (let column = 0; column < columns; column++) {
      const cell = cellAt(frame, mode, column, row)
      const fg = cell.fg === DEFAULT_COLOR ? '' : hex(cell.fg)
      const bg = hex(cell.bg)
      const last = runs[runs.length - 1]
      const char = String.fromCodePoint(cell.char)
      if (last && last.fg === fg && last.bg === bg) {
        last.text += char
      } else {
        runs.push({ text: char, fg, bg })
      }
    }
    out.push(runs)
  }

  return out
}
