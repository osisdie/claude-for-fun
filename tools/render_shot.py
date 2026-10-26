#!/usr/bin/env python3
"""Draws a screenshot of the fishing pane from a spec tools/preview.ts writes.

The spec holds the scene's pixels (two pixel rows per terminal row, as the
half-block renderer shows them) and the HUD's words with their cell
positions and colours. Each terminal cell becomes `scale` x 2*`scale`
image pixels; a CJK character takes two cells, as in the terminal.

    python3 tools/render_shot.py spec.json out.png

Needs Pillow, and fontconfig's `fc-match` to find a monospace font and a
CJK one (it falls back to Pillow's own font where none is found).
"""

import json
import subprocess
import sys
import unicodedata

from PIL import Image, ImageDraw, ImageFont


def font_file(pattern):
    try:
        found = subprocess.run(['fc-match', '-f', '%{file}', pattern], capture_output=True, text=True, timeout=10)
        return found.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def load_font(pattern, size):
    path = font_file(pattern)
    try:
        return ImageFont.truetype(path, size) if path else ImageFont.load_default()
    except OSError:
        return ImageFont.load_default()


def hex_rgb(text):
    return tuple(int(text[i:i + 2], 16) for i in (1, 3, 5))


def main(spec_path, out_path):
    spec = json.load(open(spec_path, encoding='utf-8'))
    columns, rows, footer, scale = spec['columns'], spec['rows'], spec['footer'], spec['scale']
    cell_w, cell_h = scale, 2 * scale
    image = Image.new('RGB', (columns * cell_w, (rows + footer) * cell_h), (18, 18, 22))
    pixels = spec['pixels']
    # The scene: every pixel a scale x scale block.
    canvas = image.load()
    for y in range(rows * 2):
        for x in range(columns):
            rgb = pixels[y * columns + x]
            color = ((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255)
            for dy in range(scale):
                for dx in range(scale):
                    canvas[x * scale + dx, y * scale + dy] = color

    draw = ImageDraw.Draw(image)
    size = int(cell_h * 0.8)
    latin = load_font('DejaVu Sans Mono', size)
    latin_bold = load_font('DejaVu Sans Mono:bold', size)
    cjk = load_font('Noto Sans CJK TC', size)
    for item in spec['texts']:
        x = item['x']
        fg = hex_rgb(item['fg'])
        bg = hex_rgb(item['bg']) if item.get('bg') else None
        for char in item['text']:
            wide = unicodedata.east_asian_width(char) in 'WF'
            width = 2 if wide else 1
            left, top = x * cell_w, item['y'] * cell_h
            if bg:
                draw.rectangle([left, top, left + width * cell_w - 1, top + cell_h - 1], fill=bg)
            if char != ' ':
                font = cjk if wide or ord(char) > 0x2e7f else (latin_bold if item.get('bold') else latin)
                box = draw.textbbox((0, 0), char, font=font)
                glyph_w = box[2] - box[0]
                draw.text((left + (width * cell_w - glyph_w) / 2 - box[0], top + (cell_h - size) / 2 - 1), char, font=font, fill=fg)
            x += width
    image.save(out_path)
    print(f'wrote {out_path} {image.size[0]}x{image.size[1]}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
