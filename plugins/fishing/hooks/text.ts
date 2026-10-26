// Terminal cell widths for the HUD's labels: CJK and full-width forms take
// two cells, everything else one (ambiguous-width glyphs are counted as one,
// as the engine counts them).

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  )
}

export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    width += isWide(char.codePointAt(0)!) ? 2 : 1
  }

  return width
}

export function padEnd(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)))
}

export function padStart(text: string, width: number): string {
  return ' '.repeat(Math.max(0, width - displayWidth(text))) + text
}

/** Cuts `text` to at most `width` cells. */
export function clip(text: string, width: number): string {
  let out = ''
  let used = 0
  for (const char of text) {
    const w = isWide(char.codePointAt(0)!) ? 2 : 1
    if (used + w > width) {
      break
    }
    out += char
    used += w
  }

  return out
}

/** Fills `{name}` placeholders. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  )
}
