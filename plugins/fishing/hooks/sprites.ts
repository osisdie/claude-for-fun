// Sprite files are plain text: one character per pixel, keyed by the
// theme's palette, `.` for a transparent pixel.
//
//   # a comment
//   [bobber]        <- a sprite starts with its name in brackets
//   .xx.
//   .oo.
//   ---             <- the next animation frame of the same sprite
//   ....
//   .xx.
//
// Blank lines are ignored. Every frame of a sprite has the same size.

export const TRANSPARENT = '.'

export type Sprite = {
  name: string
  width: number
  height: number
  /** frames[f][y] is one row of palette keys */
  frames: string[][]
}

export type SpriteParse = { sprites: Map<string, Sprite>; errors: string[] }

export function parseSprites(file: string, text: string): SpriteParse {
  const sprites = new Map<string, Sprite>()
  const errors: string[] = []
  let current: { name: string; line: number; frames: string[][] } | undefined

  const finish = () => {
    if (current === undefined) {
      return
    }
    const { name, line, frames } = current
    const nonEmpty = frames.filter(frame => frame.length > 0)
    if (nonEmpty.length !== frames.length || nonEmpty.length === 0) {
      errors.push(`${file}:${line}: [${name}] has an empty frame`)
      return
    }
    const height = nonEmpty[0]!.length
    const width = [...nonEmpty[0]![0]!].length
    nonEmpty.forEach((frame, index) => {
      if (frame.length !== height) {
        errors.push(`${file}:${line}: [${name}] frame ${index + 1} is ${frame.length} rows tall, not ${height}`)
      }
      frame.forEach((row, y) => {
        if ([...row].length !== width) {
          errors.push(`${file}:${line}: [${name}] frame ${index + 1} row ${y + 1} is ${[...row].length} wide, not ${width}`)
        }
      })
    })
    if (sprites.has(name)) {
      errors.push(`${file}:${line}: [${name}] is defined twice`)
    }
    sprites.set(name, { name, width, height, frames: nonEmpty })
  }

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trimEnd()
    if (line === '' || line.startsWith('#')) {
      return
    }
    const header = /^\[([\w-]+)\]$/.exec(line)
    if (header) {
      finish()
      current = { name: header[1]!, line: index + 1, frames: [[]] }
      return
    }
    if (current === undefined) {
      errors.push(`${file}:${index + 1}: pixels before any [name] header`)
      return
    }
    if (line === '---') {
      current.frames.push([])
      return
    }
    current.frames[current.frames.length - 1]!.push(line.trim())
  })
  finish()

  return { sprites, errors }
}

/** Every key a sprite uses that the palette lacks, for validation. */
export function unknownKeys(sprite: Sprite, palette: ReadonlySet<string>): string[] {
  const unknown = new Set<string>()
  for (const frame of sprite.frames) {
    for (const row of frame) {
      for (const key of row) {
        if (key !== TRANSPARENT && !palette.has(key)) {
          unknown.add(key)
        }
      }
    }
  }

  return [...unknown]
}
