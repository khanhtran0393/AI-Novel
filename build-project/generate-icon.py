"""Create a dependency-free PNG and ICO for AI Video Studio."""
from pathlib import Path
import struct
import zlib

OUT = Path(r"D:\AI Video Studio\build-project\build-resources")
OUT.mkdir(parents=True, exist_ok=True)


def png(width: int, height: int) -> bytes:
    rows = []
    for y in range(height):
        row = bytearray([0])
        for x in range(width):
            # Dark indigo rounded-looking square with a blue/purple diagonal accent.
            edge = min(x, y, width - 1 - x, height - 1 - y)
            if edge < max(2, width // 32):
                r, g, b = 17, 24, 39
            else:
                t = (x + y) / max(1, width + height - 2)
                r = int(17 + 32 * t)
                g = int(24 + 22 * t)
                b = int(64 + 90 * t)
            # Bright stylized A.
            cx = width * 0.37
            top = height * 0.25
            bottom = height * 0.75
            half = max(1.0, width * 0.16)
            rel_y = y - top
            center = cx
            in_a = top <= y <= bottom and abs(x - center) <= half * (1 - rel_y / max(1, bottom - top)) + width * 0.015
            cross = height * 0.53 <= y <= height * 0.59 and abs(x - center) <= half * 0.78
            if in_a and not (height * 0.43 <= y <= height * 0.53 and abs(x - center) < width * 0.045) or cross:
                r, g, b = 167, 139, 250
            # Bright stylized I / play stroke.
            ix = width * 0.67
            if width * 0.58 <= x <= width * 0.76 and height * 0.27 <= y <= height * 0.73:
                r, g, b = 248, 250, 252
            # Small gold dot.
            dx, dy = width * 0.78, height * 0.18
            if (x - dx) ** 2 + (y - dy) ** 2 <= (width * 0.055) ** 2:
                r, g, b = 251, 191, 36
            row.extend((r, g, b, 255))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


sizes = [16, 24, 32, 48, 64, 128, 256]
images = [(s, png(s, s)) for s in sizes]
(OUT / "icon.png").write_bytes(dict(images)[256])
header = struct.pack("<HHH", 0, 1, len(images))
offset = 6 + 16 * len(images)
entries = []
blobs = []
for s, data in images:
    dim = 0 if s >= 256 else s
    entries.append(struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset))
    blobs.append(data)
    offset += len(data)
(OUT / "ai-video-studio.ico").write_bytes(header + b"".join(entries) + b"".join(blobs))
print(f"created {OUT / 'icon.png'} and {OUT / 'ai-video-studio.ico'}")
