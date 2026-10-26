// The shipped themes load with the mod's own loader, their sounds exist,
// and their palettes stay distinct without truecolor.
//
//   bun test tools/checks

import { expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { nearest256 } from '../../plugins/fishing/hooks/color'
import { loadTheme, type ThemeIO } from '../../plugins/fishing/hooks/loader'
import { MENU } from '../../plugins/fishing/hooks/theme'

const THEMES = join(import.meta.dir, '..', '..', 'plugins', 'fishing', 'themes')
const io: ThemeIO = {
  readText: async path => readFileSync(path, 'utf8'),
  listDirs: async path => readdirSync(path).filter(name => statSync(join(path, name)).isDirectory()),
}

for (const name of readdirSync(THEMES)) {
  test(`theme ${name} loads, with its sounds, and 256 colours tell its palette apart`, async () => {
    const loaded = await loadTheme(io, name, [THEMES])
    expect(loaded.notices).toEqual([])
    expect(loaded.theme.name).toBe(name)
    for (const file of Object.values(loaded.theme.sounds)) {
      expect(existsSync(join(loaded.dir, file!))).toBe(true)
    }
    const indexes = [...loaded.theme.palette.values()].map(entry => entry.c256 ?? nearest256(entry.hex))
    expect(new Set(indexes).size).toBe(indexes.length)
    // Every locale names every command (the window is laid out from them).
    for (const labels of Object.values(loaded.theme.labels)) {
      expect(MENU.every(id => labels.menu[id].length > 0)).toBe(true)
    }
  })
}
