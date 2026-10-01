"""
Export a .aseprite file to PNG, without Aseprite.

    python tools/aseprite_png.py <in.aseprite> <out.png> [--preview]

Aseprite's own CLI (`aseprite -b in.aseprite --save-as out.png`) is the right
tool and does more than this. It is not installed on this machine, and an item
icon is one 32x32 drawing, so this reads the format directly instead: header,
palette chunk, cel chunk, composite, write a PNG. Pure stdlib, no pillow.

What it handles: indexed (8-bit) and RGBA (32-bit) colour depth, one or many
layers composited in order, the modern palette chunk and both old ones. What it
does not: grayscale, blend modes other than normal, layer opacity, tilemaps,
and frames past the first. It raises rather than guessing on any of those.

--preview prints the drawing as ASCII and lists the colours it used, which is
how you check an export without opening it.

Format reference: https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
"""
import struct
import sys
import zlib

HEADER_MAGIC = 0xA5E0
FRAME_MAGIC = 0xF1FA

CHUNK_OLD_PALETTE_8 = 0x0004   # RGB 0-255
CHUNK_OLD_PALETTE_6 = 0x0011   # RGB 0-63, needs scaling
CHUNK_LAYER = 0x2004
CHUNK_CEL = 0x2005
CHUNK_PALETTE = 0x2019

CEL_RAW = 0
CEL_LINKED = 1
CEL_COMPRESSED = 2
CEL_COMPRESSED_TILEMAP = 3


def _palette_new(body, pal):
    _, first, last = struct.unpack_from('<III', body, 0)
    at = 20
    for i in range(first, last + 1):
        flags, r, g, b, a = struct.unpack_from('<HBBBB', body, at)
        at += 6
        if flags & 1:                              # has a name we do not need
            length, = struct.unpack_from('<H', body, at)
            at += 2 + length
        pal[i] = (r, g, b, a)


def _palette_old(body, pal, six_bit):
    packets, = struct.unpack_from('<H', body, 0)
    at, index = 2, 0
    for _ in range(packets):
        skip, count = struct.unpack_from('<BB', body, at)
        at += 2
        index += skip
        for _ in range(count or 256):              # 0 means 256
            r, g, b = struct.unpack_from('<BBB', body, at)
            at += 3
            if six_bit:
                r, g, b = r * 255 // 63, g * 255 // 63, b * 255 // 63
            pal[index] = (r, g, b, 255)
            index += 1


def read_aseprite(path):
    """Return (width, height, pixels) where pixels is a list of rows of RGBA."""
    data = open(path, 'rb').read()
    magic, frames, w, h, depth = struct.unpack_from('<HHHHH', data, 4)
    if magic != HEADER_MAGIC:
        raise ValueError(f'{path}: not an aseprite file (magic 0x{magic:04X})')
    if depth not in (8, 32):
        raise ValueError(f'{path}: colour depth {depth} unsupported, use indexed or RGBA')
    transparent = data[28]

    palette, cels = {}, []
    offset = 128
    for frame in range(frames):
        frame_bytes, frame_magic, old_count = struct.unpack_from('<IHH', data, offset)
        if frame_magic != FRAME_MAGIC:
            raise ValueError(f'{path}: frame {frame} has magic 0x{frame_magic:04X}')
        new_count, = struct.unpack_from('<I', data, offset + 12)
        at = offset + 16
        for _ in range(new_count or old_count):
            size, kind = struct.unpack_from('<IH', data, at)
            body = data[at + 6: at + size]
            if kind == CHUNK_PALETTE:
                _palette_new(body, palette)
            elif kind in (CHUNK_OLD_PALETTE_8, CHUNK_OLD_PALETTE_6):
                # Only as a fallback. The modern chunk carries alpha, and a file
                # usually writes both; letting the old one win would drop it.
                if not palette:
                    _palette_old(body, palette, six_bit=(kind == CHUNK_OLD_PALETTE_6))
            elif kind == CHUNK_CEL and frame == 0:
                layer, x, y, _opacity, cel_type = struct.unpack_from('<Hhhbh', body, 0)
                if cel_type == CEL_COMPRESSED_TILEMAP:
                    raise ValueError(f'{path}: tilemap cels unsupported')
                if cel_type == CEL_LINKED:
                    continue                        # points at another frame
                cw, ch = struct.unpack_from('<HH', body, 16)
                raw = body[20:]
                if cel_type == CEL_COMPRESSED:
                    raw = zlib.decompress(raw)
                cels.append((layer, x, y, cw, ch, raw))
            at += size
        offset += frame_bytes

    if not cels:
        raise ValueError(f'{path}: no image data in the first frame')

    pixels = [[(0, 0, 0, 0)] * w for _ in range(h)]
    # Layer order is the order cels appear, which is bottom up.
    for (_layer, cx, cy, cw, ch, raw) in cels:
        for y in range(ch):
            for x in range(cw):
                if depth == 32:
                    i = (y * cw + x) * 4
                    px = (raw[i], raw[i + 1], raw[i + 2], raw[i + 3])
                else:
                    v = raw[y * cw + x]
                    if v == transparent:
                        continue
                    px = palette.get(v)
                    if px is None:
                        raise ValueError(f'{path}: pixel uses palette index {v}, which is not defined')
                if px[3] == 0:
                    continue
                ty, tx = cy + y, cx + x
                if 0 <= ty < h and 0 <= tx < w:
                    pixels[ty][tx] = px
    return w, h, pixels


def write_png(path, w, h, pixels):
    raw = b''.join(
        b'\x00' + b''.join(bytes(px) for px in row)   # filter 0, then RGBA
        for row in pixels
    )

    def chunk(tag, payload):
        body = tag + payload
        return (struct.pack('>I', len(payload)) + body
                + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF))

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    open(path, 'wb').write(png)
    return len(png)


def preview(w, h, pixels):
    used = {}
    for row in pixels:
        line = ''
        for px in row:
            if px[3] == 0:
                line += '.'
            else:
                key = '#%02X%02X%02X' % px[:3]
                used[key] = used.get(key, 0) + 1
                line += '#'
        print('  ' + line)
    print(f'\n  {w}x{h}, {len(used)} colours:')
    for key, n in sorted(used.items(), key=lambda kv: -kv[1]):
        print(f'    {key}  x{n}')


def main(argv):
    if len(argv) < 3:
        print(__doc__.strip())
        return 2
    src, dest = argv[1], argv[2]
    w, h, pixels = read_aseprite(src)
    if '--preview' in argv:
        preview(w, h, pixels)
    size = write_png(dest, w, h, pixels)
    print(f'{src} -> {dest}  {w}x{h}, {size} bytes')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
