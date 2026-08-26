#!/usr/bin/env python3
"""Keep the whole site on the art's 64-colour palette.

The Asset Library is the source of truth, the same as it is for tiles and the
font. `sync` carries its .gpl into the repo so the check can run anywhere;
`build` turns that into public/palette.css as named custom properties; `check`
reports anything on the site that is not a palette entry; `fix` snaps those to
the nearest one.

    python tools/palette.py sync     # copy the .gpl in from the Asset Library
    python tools/palette.py build    # regenerate public/palette.css
    python tools/palette.py check    # report drift, exit 1 if any (npm run palette:check)
    python tools/palette.py fix      # snap off-palette colours to the nearest entry

Nearest is measured in CIE Lab, not RGB. RGB distance is not perceptual: it will
happily move a colour somewhere that looks wrong because the arithmetic is
closer. Lab is roughly uniform to the eye, which is the thing being matched.

Stylesheets get var(--name) so the palette stays one source. Scripts get a hex
literal instead, because canvas fillStyle cannot read a custom property.

Alpha survives. rgba() overlays keep their alpha and only the colour underneath
is snapped, since a shadow at 45% is doing a job that a solid palette entry
cannot do.
"""

import argparse
import os
import re
import shutil
import sys

LIBRARY = os.environ.get('IDYA_ASSET_LIBRARY', r'G:\Pixel Art\Asset Library')
SPRITES = os.environ.get('IDYA_SPRITE_LIBRARY', r'G:\Pixel Art\Sprites')

# Two palettes, both fair game. The terrain one names its colours by material
# ("water 5", "pop gold") and keeps those names; the sprite one names them by
# family with an index ("07 Neutral"), so those become --sprite-neutral-07 to
# keep them apart from the terrain neutrals, which are different colours.
#
# 26 entries appear in both. The terrain name wins, so a shared colour has one
# variable rather than two spellings of itself.
SOURCES = [
    ('terrain', LIBRARY, 'mac-asset-library-64.gpl', None),
    ('sprite',  SPRITES, 'mac-actor-64.gpl',         'sprite'),
]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PALETTE_CSS = os.path.join(ROOT, 'public', 'palette.css')
PUBLIC = os.path.join(ROOT, 'public')

# Generated, binary, or vendored: nothing here is ours to restyle.
SKIP_DIRS = {'tiles', 'fonts', 'vendor', 'node_modules'}
SKIP_FILES = {'palette.css'}

HEX = re.compile(r'#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b')
FUNC = re.compile(r'\brgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)')
COMMENT = re.compile(r'/\*.*?\*/', re.S)

# The mask is a transparency key in the art. It must never end up on screen, so
# it is excluded from the candidates something can snap to.
MASK_INDEX = 0


# ---- palette ----

def slugify(name, prefix):
    """A CSS variable name from a palette entry's label.

    Terrain labels are "water 5" or "neutral 5 / black" -- the nickname after the
    slash is a second name for one colour, not a second colour, so it is dropped.
    Sprite labels lead with their index, "07 Neutral", which would make an
    identifier that starts with a digit, so the index moves to the end.
    """
    name = name.split('/')[0].strip()
    parts = name.lower().replace('-', ' ').split()
    if prefix and parts and parts[0].isdigit():
        parts = parts[1:] + [parts[0]]
    slug = '-'.join(re.sub(r'[^a-z0-9]', '', p) for p in parts if p)
    return f'--{prefix}-{slug}' if prefix else f'--{slug}'


def load():
    """Both palettes merged into [(index, (r,g,b), name, css_var)].

    Deduplicated by colour: a hex that appears in both is the same paint, and
    gets the terrain name because that is the one already used across the site.
    """
    out, seen, missing = [], {}, []
    for source, _dirname, filename, prefix in SOURCES:
        path = os.path.join(ROOT, 'tools', filename)
        if not os.path.exists(path):
            missing.append(filename)
            continue
        i = -1
        for line in open(path, encoding='utf-8'):
            parts = line.split()
            if len(parts) >= 3 and parts[0].isdigit():
                i += 1
                rgb = tuple(int(p) for p in parts[:3])
                key = '#%02x%02x%02x' % rgb
                if key in seen:
                    continue
                name = ' '.join(parts[3:])
                var = slugify(name, prefix)
                seen[key] = var
                out.append((i, rgb, f'{source} {name}', var))
    if missing:
        sys.exit(f'Missing {", ".join(missing)} in tools/. '
                 f'Run `python tools/palette.py sync` first.')
    return out


def to_lab(rgb):
    """sRGB to CIE Lab, D65. Verbose on purpose: it is easier to check against
    the standard than a clever one-liner would be."""
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(float(c)) for c in rgb)
    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
    y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else (7.787 * t) + (16 / 116)
    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def nearest(rgb, palette):
    """The palette entry a colour should become, and how far it moved."""
    lab = to_lab(rgb)
    best, best_d = None, None
    for entry in palette:
        if entry[1] == (255, 0, 255):
            continue   # never snap anything onto the transparency key
        el = to_lab(entry[1])
        d = sum((a - b) ** 2 for a, b in zip(lab, el)) ** 0.5
        if best_d is None or d < best_d:
            best, best_d = entry, d
    return best, best_d


def expand(h):
    h = h.lower()
    return '#' + ''.join(c * 2 for c in h[1:]) if len(h) == 4 else h


def as_rgb(h):
    h = expand(h)
    return (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16))


# ---- files ----

def site_files():
    for root, dirs, names in os.walk(PUBLIC):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for n in sorted(names):
            if n in SKIP_FILES:
                continue
            if n.endswith(('.css', '.js', '.html')):
                yield os.path.join(root, n)


def scan(path, palette):
    """Every off-palette colour in one file, as (literal, replacement, drift)."""
    by_hex = {'#%02x%02x%02x' % e[1]: e for e in palette}
    src = COMMENT.sub(lambda m: ' ' * len(m.group(0)), open(path, encoding='utf-8').read())
    is_css = path.endswith('.css')
    found = []

    for m in HEX.finditer(src):
        h = expand(m.group(0))
        if h in by_hex:
            continue
        entry, drift = nearest(as_rgb(h), palette)
        rep = f'var({entry[3]})' if is_css else '#%02x%02x%02x' % entry[1]
        found.append((m.group(0), rep, entry, drift))

    for m in FUNC.finditer(src):
        r, g, b = (int(float(m.group(i))) for i in (1, 2, 3))
        alpha = m.group(4)
        # An rgba() over a palette colour is already on palette. Alpha is a
        # separate thing from which paint is being used, so it does not make a
        # palette entry stop being one.
        if '#%02x%02x%02x' % (r, g, b) in by_hex:
            continue
        entry, drift = nearest((r, g, b), palette)
        if alpha is None:
            rep = f'var({entry[3]})' if is_css else '#%02x%02x%02x' % entry[1]
        else:
            # Alpha is doing real work; only the colour under it gets snapped.
            er, eg, eb = entry[1]
            rep = f'rgba({er}, {eg}, {eb}, {alpha})'
        found.append((m.group(0), rep, entry, drift))

    return found


# ---- commands ----

def cmd_sync(_args):
    for source, dirname, filename, _prefix in SOURCES:
        src = os.path.join(dirname, filename)
        if not os.path.exists(src):
            sys.exit(f'{source} palette not found: {src}\n'
                     f'Set IDYA_ASSET_LIBRARY / IDYA_SPRITE_LIBRARY if it moved.')
        dst = os.path.join(ROOT, 'tools', filename)
        shutil.copy2(src, dst)
        print(f'synced {filename} ({os.path.getsize(dst)} bytes)')


def cmd_build(_args):
    palette = load()
    lines = [
        '/* The art palette, as CSS. Generated by tools/palette.py -- do not edit.',
        ' *',
        ' * The whole site draws from these and nothing else, so the interface and',
        ' * the world stay one thing. Both palettes are here, the terrain one and the',
        ' * sprite one, deduplicated where they share a colour. Regenerate with',
        ' * `npm run palette:build` after `npm run palette:sync`.',
        ' *',
        ' * `npm run palette:check` fails if a colour appears anywhere on the site',
        ' * that is not one of these.',
        ' */',
        ':root {',
    ]
    width = max(len(e[3]) for e in palette)
    for _idx, rgb, name, var in palette:
        if rgb == (255, 0, 255):
            continue   # a transparency key, never a colour to design with
        lines.append(f'  {var:<{width}}: #%02x%02x%02x;   /* {name} */' % rgb)
    lines.append('}')
    open(PALETTE_CSS, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines) + '\n')
    print(f'wrote public/palette.css ({len(palette) - 1} colours)')


def cmd_check(args):
    palette = load()
    total, worst = 0, []
    for path in site_files():
        found = scan(path, palette)
        if not found:
            continue
        total += len(found)
        rel = os.path.relpath(path, ROOT)
        print(f'\n{rel}')
        for lit, rep, entry, drift in found:
            print(f'  {lit:<24} -> {rep:<22} {entry[2]:<14} drift {drift:>5.1f}')
            worst.append((drift, rel, lit, entry[2]))
    if not total:
        print('every colour on the site is a palette entry.')
        return 0
    print(f'\n{total} off-palette colours.')
    if args.top:
        print('\nfurthest from the palette (check these by eye):')
        for drift, rel, lit, name in sorted(worst, reverse=True)[:args.top]:
            print(f'  drift {drift:>5.1f}  {lit:<12} -> {name:<14} {rel}')
    return 1


def cmd_fix(_args):
    palette = load()
    changed = 0
    for path in site_files():
        found = scan(path, palette)
        if not found:
            continue
        src = open(path, encoding='utf-8').read()
        # Longest first, so #ffffff is never clipped by a shorter overlapping
        # match, and each literal is replaced everywhere it occurs.
        for lit, rep, _entry, _drift in sorted(found, key=lambda f: -len(f[0])):
            src = src.replace(lit, rep)
        open(path, 'w', encoding='utf-8', newline='').write(src)
        changed += 1
        print(f'  {os.path.relpath(path, ROOT)}: {len(found)} snapped')
    print(f'{changed} files changed.')
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('sync').set_defaults(fn=cmd_sync)
    sub.add_parser('build').set_defaults(fn=cmd_build)
    c = sub.add_parser('check')
    c.add_argument('--top', type=int, default=0, help='list the N furthest drifts')
    c.set_defaults(fn=cmd_check)
    sub.add_parser('fix').set_defaults(fn=cmd_fix)
    args = ap.parse_args()
    sys.exit(args.fn(args) or 0)


if __name__ == '__main__':
    main()
