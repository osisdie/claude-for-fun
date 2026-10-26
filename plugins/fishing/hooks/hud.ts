// Where the HUD's windows sit and what they say. The scene paints each
// window's panel and frame into the map (see Scene.drawWindow); the words go
// on top as Text, since the map's cells take only one-cell-wide glyphs and
// the labels are CJK.
//
// Layout: along the bottom of the map, the status window on the left under
// a title tab (place and time of day) and the command window on the right.

import type { Rect } from './scene'
import { displayWidth, padEnd, padStart } from './text'
import { MENU, type Labels, type MenuId, type Phase } from './theme'

/** A window in cells: x, y from the map's top-left. */
export type CellRect = { x: number; y: number; w: number; h: number }

export type StatusWindow = { rect: CellRect; tab: { rect: CellRect; text: string }; lines: string[] }
export type MenuWindow = {
  rect: CellRect
  /** one entry per row: the two items in it */
  rows: { id: MenuId; text: string }[][]
  width: number
}
export type HudLayout = { status?: StatusWindow; menu?: MenuWindow }

export type Glyphs = { cursor: string; left: string; right: string; up: string; down: string }
export const UNICODE_GLYPHS: Glyphs = { cursor: '➤', left: '◀', right: '▶', up: '▲', down: '▼' }
/** For terminals that draw ambiguous-width glyphs two cells wide. */
export const ASCII_GLYPHS: Glyphs = { cursor: '>', left: '<', right: '>', up: '^', down: 'v' }

/** One line of the status window: a name and its value. */
export type StatLine = { label: string; value: string }

// A window's text sits one cell in from the frame, with a space each side.
const FRAME = 1
const PAD = 1

const windowOf = (innerWidth: number, lines: number): CellRect =>
  ({ x: 0, y: 0, w: innerWidth + 2 * (FRAME + PAD), h: lines + 2 * FRAME })

export function statusLines(stats: readonly StatLine[]): string[] {
  const labelWidth = Math.max(...stats.map(stat => displayWidth(stat.label)))
  const valueWidth = Math.max(...stats.map(stat => displayWidth(stat.value)))
  return stats.map(stat => `${padEnd(stat.label, labelWidth)} ${padStart(stat.value, valueWidth)}`)
}

export function tabText(labels: Labels, phase: Phase): string {
  return `${labels.location}  ${labels.phases[phase]}`
}

export function layoutHud(
  labels: Labels,
  phase: Phase,
  stats: readonly StatLine[],
  cursor: number,
  columns: number,
  rows: number,
  glyphs: Glyphs,
): HudLayout {
  const itemWidth = Math.max(...MENU.map(id => displayWidth(labels.menu[id])))
  const menuRows: MenuWindow['rows'] = []
  for (let row = 0; row < MENU.length / 2; row++) {
    menuRows.push([0, 1].map(column => {
      const index = row * 2 + column
      const id = MENU[index]!
      const mark = index === cursor ? glyphs.cursor : ' '
      return { id, text: mark + padEnd(labels.menu[id], itemWidth) }
    }))
  }
  // Two items and a gap between them.
  const menuWidth = 2 * (1 + itemWidth) + 1
  const menuRect = windowOf(menuWidth, menuRows.length)
  menuRect.x = columns - menuRect.w
  menuRect.y = rows - menuRect.h
  if (rows < menuRect.h + 3 || columns < menuRect.w) {
    return {} // too small for windows: the map alone
  }
  const menu: MenuWindow = { rect: menuRect, rows: menuRows, width: menuWidth }

  const lines = statusLines(stats)
  const title = tabText(labels, phase)
  const inner = Math.max(displayWidth(lines[0]!), displayWidth(title))
  const statusRect = windowOf(inner, lines.length)
  statusRect.y = rows - statusRect.h
  const tab = { rect: { x: 1, y: statusRect.y - 1, w: displayWidth(title) + 2, h: 1 }, text: title }
  const fits = statusRect.w + menuRect.w + 2 <= columns && rows >= statusRect.h + 4

  return fits ? { status: { rect: statusRect, tab, lines: lines.map(line => padEnd(line, inner)) }, menu } : { menu }
}

/** The windows as pixel rectangles of a frame with two pixel rows a cell row. */
export function windowRects(layout: HudLayout, isMenuLit = false): Rect[] {
  const px = (rect: CellRect): Rect => ({ x: rect.x, y: rect.y * 2, w: rect.w, h: rect.h * 2 })
  const rects: Rect[] = []
  if (layout.status) {
    rects.push({ ...px(layout.status.rect), kind: 'panel' })
    rects.push({ ...px(layout.status.tab.rect), kind: 'tab' })
  }
  if (layout.menu) {
    rects.push({ ...px(layout.menu.rect), kind: 'panel', highlight: isMenuLit })
  }
  return rects
}
