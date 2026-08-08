"""Build a web font from the Asset Library's bitmap font sheets.

    python tools/build-font.py          # writes public/fonts/idya-pixel.woff

The artist authors the font as four 8x8-cell PNG sheets (upper, lower, digits,
punctuation). This turns those pixels into real vector glyphs so the browser can
set them as text — the alternative, drawing every string onto a canvas, would
mean the DOM couldn't hold any of the UI's words.

Metrics are not guessed. The advance rule below was derived by reproducing
fnt_specimen_tight.png pixel-for-pixel: advance = ink width + 1px, space = 4px.
`--verify` re-runs that check against the built font.

Requires: pillow, fonttools. Re-run after editing any fnt_*.png.
"""
import argparse
import os
import sys

from PIL import Image
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

LIB = os.environ.get('IDYA_ASSET_LIB', r'G:\Pixel Art\Asset Library')
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'fonts')

CELL = 8          # glyph cell, px
SCALE = 128       # font units per pixel -> 8px em = 1024 upm
UPM = CELL * SCALE
BASELINE_ROW = 7  # pixel rows 0-6 sit above the baseline, row 7 below it
ADVANCE_GAP = 1   # px added to a glyph's ink width (see module docstring)
SPACE_PX = 4

# Sheet -> the characters its cells hold, in reading order (4 cells per row).
SHEETS = [
    ('fnt_upper.png',       'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
    ('fnt_lower.png',       'abcdefghijklmnopqrstuvwxyz'),
    ('fnt_digits.png',      '1234567890'),          # note: 1-9 then 0, not 0-9
    ('fnt_punctuation.png', '.,\'"!?-:;()\u2026+\u00d7=%'),
]

# Typographic characters that should reuse a plain glyph rather than go missing.
ALIASES = {
    '\u2019': "'", '\u2018': "'",                    # curly single quotes
    '\u201c': '"', '\u201d': '"',                    # curly double quotes
    '\u2010': '-', '\u2013': '-', '\u2014': '-',     # hyphen / en / em dash
}


def read_cells(name):
    im = Image.open(os.path.join(LIB, name)).convert('RGBA')
    px = im.load()
    cells = []
    for row in range(im.height // CELL):
        for col in range(im.width // CELL):
            cells.append([[1 if px[col * CELL + x, row * CELL + y][3] > 128 else 0
                           for x in range(CELL)] for y in range(CELL)])
    return cells


def load_glyphs():
    glyphs = {}
    for name, chars in SHEETS:
        cells = read_cells(name)
        if len(cells) < len(chars):
            sys.exit(f'{name}: {len(cells)} cells but {len(chars)} characters expected')
        for ch, cell in zip(chars, cells):
            glyphs[ch] = cell
    return glyphs


def ink_bounds(cell):
    cols = [x for x in range(CELL) if any(cell[y][x] for y in range(CELL))]
    return (cols[0], cols[-1]) if cols else None


def rectangles(cell, x_offset):
    """Merge the ink into as few axis-aligned rectangles as possible.

    One contour per pixel would work — TrueType's non-zero winding unions
    same-direction contours — but it makes for large glyphs and leaves the
    rasterizer more seams to hairline. Greedy horizontal runs grown downward is
    plenty for 8x8.
    """
    used = [[False] * CELL for _ in range(CELL)]
    rects = []
    for y in range(CELL):
        for x in range(CELL):
            if not cell[y][x] or used[y][x]:
                continue
            x2 = x
            while x2 + 1 < CELL and cell[y][x2 + 1] and not used[y][x2 + 1]:
                x2 += 1
            y2 = y
            while (y2 + 1 < CELL
                   and all(cell[y2 + 1][i] and not used[y2 + 1][i] for i in range(x, x2 + 1))):
                y2 += 1
            for yy in range(y, y2 + 1):
                for xx in range(x, x2 + 1):
                    used[yy][xx] = True
            rects.append((x - x_offset, y, x2 + 1 - x_offset, y2 + 1))
    return rects


def draw(pen, cell, x_offset):
    for (x0, y0, x1, y1) in rectangles(cell, x_offset):
        # Pixel row r spans font-y (BASELINE_ROW - r - 1)*SCALE .. (BASELINE_ROW - r)*SCALE.
        left, right = x0 * SCALE, x1 * SCALE
        top, bottom = (BASELINE_ROW - y0) * SCALE, (BASELINE_ROW - y1) * SCALE
        pen.moveTo((left, bottom))       # clockwise in a y-up system
        pen.lineTo((left, top))
        pen.lineTo((right, top))
        pen.lineTo((right, bottom))
        pen.closePath()


def build(path):
    glyphs = load_glyphs()
    order = ['.notdef', 'space']
    pen_glyphs = {}
    metrics = {}
    cmap = {}

    empty = TTGlyphPen(None)
    pen_glyphs['.notdef'] = empty.glyph()
    metrics['.notdef'] = (SPACE_PX * SCALE, 0)
    pen_glyphs['space'] = TTGlyphPen(None).glyph()
    metrics['space'] = (SPACE_PX * SCALE, 0)
    cmap[ord(' ')] = 'space'

    for ch, cell in glyphs.items():
        name = f'uni{ord(ch):04X}'
        b = ink_bounds(cell)
        pen = TTGlyphPen(None)
        if b is None:
            metrics[name] = (SPACE_PX * SCALE, 0)
        else:
            x0, x1 = b
            draw(pen, cell, x0)
            metrics[name] = ((x1 - x0 + 1 + ADVANCE_GAP) * SCALE, 0)
        pen_glyphs[name] = pen.glyph()
        order.append(name)
        cmap[ord(ch)] = name

    for alias, base in ALIASES.items():
        if base in glyphs:
            cmap[ord(alias)] = f'uni{ord(base):04X}'

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(pen_glyphs)
    fb.setupHorizontalMetrics(metrics)
    ascent, descent = (BASELINE_ROW) * SCALE, (CELL - BASELINE_ROW) * SCALE
    fb.setupHorizontalHeader(ascent=ascent, descent=-descent)
    fb.setupNameTable({
        'familyName': 'Idya Pixel',
        'styleName': 'Regular',
        'psName': 'IdyaPixel-Regular',
        'version': '1.0',
        'copyright': 'Idya asset library',
    })
    fb.setupOS2(sTypoAscender=ascent, sTypoDescender=-descent, sTypoLineGap=3 * SCALE,
                usWinAscent=ascent, usWinDescent=descent, sxHeight=5 * SCALE,
                sCapHeight=7 * SCALE)
    fb.setupPost()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fb.font.flavor = 'woff'
    fb.save(path)
    return len(order) - 1


def verify(path):
    """Re-render the specimen's own pangrams with the BUILT font and diff."""
    from PIL import ImageDraw, ImageFont
    spec = Image.open(os.path.join(LIB, 'fnt_specimen_tight.png')).convert('RGB')
    sp = spec.load()
    ink = lambda x, y: 0 <= x < spec.width and 0 <= y < spec.height and sum(sp[x, y]) < 300

    ttf = path.replace('.woff', '.ttf')
    from fontTools.ttLib import TTFont
    f = TTFont(path); f.flavor = None; f.save(ttf)
    font = ImageFont.truetype(ttf, CELL)

    cases = [(0, 'The quick brown fox jumps over a lazy dog.'),
             (5, 'Levels 1234567890 cleared.')]
    ok = True
    for line, text in cases:
        top = 6 + 11 * line
        xs = [x for x in range(spec.width) if any(ink(x, top + y) for y in range(CELL))]
        img = Image.new('L', (spec.width, CELL * 3), 0)
        d = ImageDraw.Draw(img)
        d.fontmode = '1'                     # no antialiasing
        d.text((0, 0), text, font=font, fill=255, anchor='la')
        px = img.load()
        rows = [y for y in range(img.height) if any(px[x, y] for x in range(img.width))]
        cols = [x for x in range(img.width) if any(px[x, y] for y in range(img.height))]
        dx, dy = xs[0] - cols[0], top - rows[0]
        diff = sum(1 for y in range(rows[0], rows[-1] + 1) for x in range(cols[0], cols[-1] + 1)
                   if bool(px[x, y]) != ink(x + dx, y + dy))
        total = (rows[-1] - rows[0] + 1) * (cols[-1] - cols[0] + 1)
        print(f'  line {line}: {total - diff}/{total} pixels match' + ('  OK' if not diff else '  MISMATCH'))
        ok = ok and not diff
    os.remove(ttf)
    return ok


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--verify', action='store_true',
                    help='re-render the specimen with the built font and diff it')
    args = ap.parse_args()

    out = os.path.normpath(os.path.join(OUT, 'idya-pixel.woff'))
    n = build(out)
    print(f'built {out} ({n} glyphs, {os.path.getsize(out)} bytes)')
    if args.verify:
        print('verifying against fnt_specimen_tight.png:')
        sys.exit(0 if verify(out) else 1)
