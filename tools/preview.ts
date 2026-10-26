#!/usr/bin/env bun
// Checks and previews the fishing mod's themes outside Claude Code, with the
// mod's own loader and renderer.
//
//   bun tools/preview.ts --check                 validate every theme (exit 1 on errors)
//   bun tools/preview.ts river-rpg               half-block preview in this terminal
//   bun tools/preview.ts river-rpg --ascii       plain-text preview
//   bun tools/preview.ts river-rpg --png out.png --phase night --session waiting
//   bun tools/preview.ts river-rpg --shot shot.png     (with the HUD's words, via tools/render_shot.py)
//
// Options: --cols 48 --rows 22 --phase morning|day|evening|night
//          --session idle|thinking|tool|waiting|done|error|compacting --tool read|edit|bash|web|agent|other
//          --state casting|waiting|bite|reeling|showing|resting (the idle game's own) --tick 0
//          --locale zh-TW|ja|en --color truecolor|256 --dir <themes folder> --scale 4
//
// The status window shows made-up demo figures, never a real session's.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { deflateSync } from 'node:zlib'

import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { ColorSnapper, nearest256, toHex, xterm256 } from '../plugins/fishing/hooks/color'
import { frameInput, type Shown } from '../plugins/fishing/hooks/compose'
import type { FishingView } from '../plugins/fishing/hooks/fishing'
import { layoutHud, UNICODE_GLYPHS } from '../plugins/fishing/hooks/hud'
import { loadTheme, type ThemeIO } from '../plugins/fishing/hooks/loader'
import { Scene, type Frame } from '../plugins/fishing/hooks/scene'
import { SESSION_KINDS, type SessionKind, type ToolKind } from '../plugins/fishing/hooks/session'
import { formatCost } from '../plugins/fishing/hooks/stats'
import { format } from '../plugins/fishing/hooks/text'
import { displayWidth } from '../plugins/fishing/hooks/text'
import type { Locale, Phase, Theme } from '../plugins/fishing/hooks/theme'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const option = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1]! : fallback
}
const themesDir = option('dir', join(dirname(new URL(import.meta.url).pathname), '../plugins/fishing/themes'))
const io: ThemeIO = {
  readText: async path => readFileSync(path, 'utf8'),
  listDirs: async path => readdirSync(path).filter(name => statSync(join(path, name)).isDirectory()),
}

async function check(): Promise<number> {
  let failures = 0
  for (const name of await io.listDirs(themesDir)) {
    try {
      const loaded = await loadTheme(io, name, [themesDir])
      const fellBack = loaded.theme.name !== name
      if (fellBack) {
        failures++
        console.log(`✘ ${name}\n${loaded.notices.join('\n')}`)
        continue
      }
      // Without truecolor every palette colour should still be its own.
      const seen = new Map<number, string>()
      const clashes: string[] = []
      for (const [key, entry] of loaded.theme.palette) {
        const index = entry.c256 ?? nearest256(entry.hex)
        const other = seen.get(index)
        if (other !== undefined) clashes.push(`"${other}" and "${key}" share xterm-256 colour ${index}`)
        seen.set(index, key)
      }
      const sprites = loaded.theme.sprites.size
      console.log(`✔ ${name}: ${loaded.theme.palette.size} colours, ${sprites} sprites, ${loaded.theme.objects.length} objects, map ${loaded.theme.map[0]!.length}x${loaded.theme.map.length} tiles`)
      for (const clash of clashes) console.log(`  ⚠ ${clash}`)
    } catch (error) {
      failures++
      console.log(`✘ ${name}: ${(error as Error).message}`)
    }
  }
  return failures
}

function viewFor(state: string, theme: Theme): FishingView {
  const fish = theme.fish[0]!
  const caught = { id: fish.id, sprite: fish.sprite, size: fish.size[1], value: fish.value }
  switch (state) {
    case 'casting': return { kind: 'casting', progress: 0.6 }
    case 'bite': return { kind: 'bite', progress: 0.2 }
    case 'reeling': return { kind: 'reeling', progress: 0.5, fish: caught }
    case 'showing': return { kind: 'showing', progress: 0.5, fish: caught }
    case 'resting': return { kind: 'resting', progress: 0.5 }
    default: return { kind: 'waiting', progress: 0 }
  }
}

function writePng(path: string, frame: Frame, scale: number): void {
  const width = frame.width * scale
  const height = frame.height * scale
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    for (let x = 0; x < width; x++) {
      const rgb = frame.rgb[Math.floor(y / scale) * frame.width + Math.floor(x / scale)]!
      const at = y * (width * 3 + 1) + 1 + x * 3
      raw[at] = (rgb >> 16) & 0xff
      raw[at + 1] = (rgb >> 8) & 0xff
      raw[at + 2] = rgb & 0xff
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([length, body, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]))
}

async function preview(name: string): Promise<void> {
  const columns = Number(option('cols', '48'))
  const rows = Number(option('rows', '22'))
  const clockPhase = option('phase', 'day') as Phase
  const locale = option('locale', flag('ascii') ? 'en' : 'zh-TW') as Locale
  const colorMode = option('color', 'truecolor') as 'truecolor' | '256'
  const kind = option('session', 'idle') as SessionKind
  if (!SESSION_KINDS.includes(kind)) throw new Error(`--session must be one of ${SESSION_KINDS.join(', ')}`)
  const loaded = await loadTheme(io, name, [themesDir])
  for (const notice of loaded.notices) console.error(notice)
  const theme = loaded.theme
  const labels = theme.labels[locale]
  // Demo figures for the status window: made up, never a real session's.
  const demo: Record<string, string> = { contextLeft: '72%', cost: formatCost(0.42), turns: '14', tools: '37', weeklyLeft: '81%', fiveHourLeft: '64%', catches: '9' }
  const stats = (['contextLeft', 'cost', 'turns'] as const).map(source => ({ label: labels.stats[source], value: demo[source]! }))
  const look = theme.states[kind]
  const phase = look.phase ?? clockPhase
  const layout = layoutHud(labels, phase, stats, 0, columns, rows, UNICODE_GLYPHS)
  const pinned = new Map<number, number>()
  for (const entry of theme.palette.values()) if (entry.c256 !== undefined) pinned.set(entry.hex, entry.c256)
  const scene = new Scene(theme, columns, rows * 2, new ColorSnapper(colorMode, pinned))
  // A state well into itself (`--tick` is in sixths of a second since it began).
  const tick = Number(option('tick', kind === 'done' ? '14' : '20'))
  const now = 1_000_000_000 + Math.round((tick * 1000) / 6)
  const shown: Shown = { kind, tool: option('tool', 'edit') as ToolKind, since: 1_000_000_000 }
  const frame = scene.render(frameInput(theme, shown, now, { clockPhase, idleView: viewFor(option('state', 'waiting'), theme), layout }))
  const message = kind === 'idle'
    ? format(labels.messages.welcome, { location: labels.location })
    : format(labels.states[kind], { tool: labels.tools[shown.tool ?? 'other'] })
  const controls = `r: ${labels.controls.reel}  z: ${labels.controls.decide}  h: ◀  j: ▼  k: ▲  l: ▶`

  const shot = option('shot', '')
  if (shot !== '') {
    // The words go on as the pane draws them: the tab, the windows, the two lines under the map.
    const style = theme.window
    const texts: { x: number; y: number; text: string; fg: string; bg?: string; bold?: boolean }[] = []
    if (layout.status) {
      texts.push({ x: layout.status.tab.rect.x + 1, y: layout.status.tab.rect.y, text: layout.status.tab.text, fg: style.tabText, bg: style.tab, bold: true })
      layout.status.lines.forEach((line, i) => texts.push({ x: layout.status!.rect.x + 1, y: layout.status!.rect.y + 1 + i, text: ` ${line} `, fg: style.text, bg: style.bg }))
    }
    if (layout.menu) {
      layout.menu.rows.forEach((items, i) => texts.push({
        x: layout.menu!.rect.x + 1, y: layout.menu!.rect.y + 1 + i,
        text: ` ${items.map(item => item.text).join(' ')} `, fg: style.text, bg: style.bg,
      }))
    }
    texts.push({ x: 0, y: rows, text: message, fg: kind === 'waiting' ? style.accent : '#d8d8d8' })
    texts.push({ x: 0, y: rows + 1, text: controls, fg: '#9a9a9a' })
    const spec = {
      columns, rows, footer: 2, scale: Number(option('scale', '4')),
      pixels: Array.from(frame.rgb, rgb => rgb & 0xffffff), texts,
    }
    const dir = mkdtempSync(join(tmpdir(), 'fishing-shot-'))
    const specPath = join(dir, 'spec.json')
    writeFileSync(specPath, JSON.stringify(spec))
    const ran = spawnSync('python3', ['-I', join(dirname(new URL(import.meta.url).pathname), 'render_shot.py'), specPath, shot], { stdio: 'inherit' })
    if (ran.status !== 0) process.exit(ran.status ?? 1)
    return
  }

  const png = option('png', '')
  if (png !== '') {
    writePng(png, frame, Number(option('scale', '6')))
    console.log(`wrote ${png}`)
    return
  }

  // Text: each cell the glyph of its palette colour (the pixel drawn on top of
  // the pair), then the HUD's windows and words over it.
  console.error(message)
  const glyphOf = new Map<number, string>()
  for (const [key, entry] of theme.palette) glyphOf.set(entry.hex, entry.ascii ?? key)
  const grid: string[][] = []
  for (let row = 0; row < rows; row++) {
    const line: string[] = []
    for (let column = 0; column < columns; column++) {
      const top = row * 2 * columns + column
      const bottom = top + columns
      if (flag('ascii')) {
        const pick = frame.z[bottom]! > frame.z[top]! ? bottom : top
        line.push(glyphOf.get(frame.rgb[pick]!) ?? '?')
      } else {
        const fg = frame.rgb[top]!
        const bg = frame.rgb[bottom]!
        line.push(`\x1b[38;2;${fg >> 16};${(fg >> 8) & 255};${fg & 255}m\x1b[48;2;${bg >> 16};${(bg >> 8) & 255};${bg & 255}m▀`)
      }
    }
    grid.push(line)
  }
  const reset = flag('ascii') ? '' : '\x1b[0m'
  // A CJK glyph takes two cells: it fills the first, the second is left empty.
  const put = (x: number, y: number, text: string) => {
    for (const char of text) {
      const wide = displayWidth(char) === 2
      if (grid[y] && x + (wide ? 1 : 0) < columns) {
        grid[y]![x] = flag('ascii') ? char : `${reset}${char}`
        if (wide) grid[y]![x + 1] = ''
      }
      x += wide ? 2 : 1
    }
  }
  for (const window of [layout.status, layout.menu]) {
    if (!window) continue
    const { x, y, w, h } = window.rect
    for (let r = y; r < y + h; r++) {
      const edge = r === y || r === y + h - 1
      put(x, r, edge ? `+${'-'.repeat(w - 2)}+` : `|${' '.repeat(w - 2)}|`)
    }
  }
  if (layout.status) layout.status.lines.forEach((line, i) => put(layout.status!.rect.x + 2, layout.status!.rect.y + 1 + i, line))
  if (layout.menu) layout.menu.rows.forEach((items, i) => put(layout.menu!.rect.x + 2, layout.menu!.rect.y + 1 + i, items.map(item => item.text).join(' ')))
  console.log(grid.map(line => line.join('') + reset).join('\n'))
  if (flag('legend')) {
    console.log([...theme.palette].map(([key, entry]) => `${entry.ascii ?? key}=${key} ${toHex(entry.hex)} (256: ${entry.c256 ?? nearest256(entry.hex)} ${toHex(xterm256(entry.c256 ?? nearest256(entry.hex)))})`).join('\n'))
  }
}

if (flag('check')) {
  process.exit((await check()) > 0 ? 1 : 0)
} else {
  await preview(args.find(arg => !arg.startsWith('--') && !/^\d/.test(arg) && args[args.indexOf(arg) - 1]?.startsWith('--') !== true) ?? 'river-rpg')
}
