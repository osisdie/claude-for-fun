// Finds and reads a theme folder. The reads go through `ThemeIO`, which the
// mod backs with `$.fs` and the preview tool with Node's fs.

import { DEFAULT_THEME } from './profile'
import { applyOverrides, compileTheme, type Theme, type ThemeOverrides } from './theme'

export type ThemeIO = {
  readText: (path: string) => Promise<string>
  listDirs: (path: string) => Promise<string[]>
}

export type ThemeLoad = {
  theme: Theme
  /** where it was read from */
  dir: string
  /** shown once to the person: a fallback, or overrides that were skipped */
  notices: string[]
}

async function tryRead(io: ThemeIO, path: string): Promise<string | undefined> {
  try {
    return await io.readText(path)
  } catch {
    return undefined
  }
}

/** Reads `name` from the first folder that has it: the user's, then the mod's. */
export async function readTheme(
  io: ThemeIO,
  name: string,
  dirs: readonly string[],
): Promise<{ theme?: Theme; dir?: string; errors: string[] }> {
  for (const base of dirs) {
    const dir = `${base}/${name}`
    const jsonText = await tryRead(io, `${dir}/theme.json`)
    if (jsonText === undefined) {
      continue
    }
    let json: unknown
    try {
      json = JSON.parse(jsonText)
    } catch (error) {
      return { dir, errors: [`theme.json: not valid JSON (${(error as Error).message})`] }
    }
    // compileTheme reads synchronously; fetch every file it may ask for first.
    const wanted = new Set<string>()
    if (typeof (json as { map?: unknown }).map === 'string') {
      wanted.add((json as { map: string }).map)
    }
    for (const file of ((json as { sprites?: unknown }).sprites as unknown[] | undefined) ?? []) {
      if (typeof file === 'string' && !file.includes('..')) {
        wanted.add(file)
      }
    }
    const texts = new Map<string, string>()
    for (const file of wanted) {
      const text = await tryRead(io, `${dir}/${file}`)
      if (text !== undefined) {
        texts.set(file, text)
      }
    }
    const compiled = compileTheme(name, { json, read: file => texts.get(file) })

    return { ...compiled, dir }
  }

  return { errors: [`no theme folder named "${name}" in ${dirs.join(' or ')}`] }
}

/**
 * Loads the wanted theme, or falls back to the default with a notice saying
 * what was wrong. Throws only when the default itself cannot be loaded.
 */
export async function loadTheme(
  io: ThemeIO,
  wanted: string,
  dirs: readonly string[],
  overrides: ThemeOverrides = {},
): Promise<ThemeLoad> {
  const notices: string[] = []
  let found = await readTheme(io, wanted, dirs)
  if (!found.theme && wanted !== DEFAULT_THEME) {
    const shown = found.errors.slice(0, 5)
    const more = found.errors.length - shown.length
    notices.push(
      `Theme "${wanted}" could not be used; showing "${DEFAULT_THEME}" instead.`,
      ...shown.map(error => `  ${error}`),
      ...(more > 0 ? [`  ...and ${more} more`] : []),
    )
    found = await readTheme(io, DEFAULT_THEME, dirs)
  }
  if (!found.theme || !found.dir) {
    throw new Error(`The default theme "${DEFAULT_THEME}" is broken: ${found.errors.slice(0, 5).join('; ')}`)
  }
  const applied = applyOverrides(found.theme, overrides)
  notices.push(...applied.warnings)

  return { theme: applied.theme, dir: found.dir, notices }
}

/** Every theme name the folders hold, the user's first, without repeats. */
export async function listThemes(io: ThemeIO, dirs: readonly string[]): Promise<string[]> {
  const names: string[] = []
  for (const dir of dirs) {
    try {
      for (const name of await io.listDirs(dir)) {
        if (!names.includes(name)) {
          names.push(name)
        }
      }
    } catch {
      // a folder that isn't there holds no themes
    }
  }

  return names
}
