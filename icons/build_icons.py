"""Build the Inkpen Windows icon set.

Processing constraints (PROMPT_icon_building.md):
  * Lanczos resampling only — never nearest-neighbour or bilinear.
  * Transparency preserved throughout; every output is RGBA PNG-24.
  * Windows .ico carries 16, 24, 32, 48, 64, 128, 256 (plus 20 and 96, which
    Windows requests at 125% DPI and in some shell views).

Two things this does beyond a plain resize, both of which matter at icon sizes:

1. ALPHA IS PREMULTIPLIED BEFORE RESAMPLING.
   The transparent regions of the master carry RGB (0,0,0). Resampling RGBA
   directly makes Lanczos average those black pixels into neighbouring opaque
   ones, painting a dark fringe around every edge. Premultiplying, resizing,
   then un-premultiplying keeps the edge colour honest.

2. NO SHARPENING.
   An unsharp pass was tried, on the theory that a 22x downscale needs edge
   recovery. It does not: Lanczos on a high-resolution master is already crisp,
   and the extra contrast crushed the antialiasing into hard black/white steps —
   visibly blocky at 16-32px, which is exactly where icons can least afford it.
   Compared at 0%, 20% and 60%, unsharpened won outright.

Artwork selection is deliberate and not a single master: below 32px the detailed
page-and-rules artwork collapses into a grey smudge, so the splat-forward master
is used there instead. See UI_SPEC §17.
"""

import struct
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

SRC = Path(__file__).resolve().parent.parent

# Write straight into the directory the Tauri bundler reads. Keeping a second
# copy beside the masters meant a rebuild silently shipped the previous icons,
# because nothing linked the two — one output location, no stale copies.
OUT = SRC / "app" / "src-tauri" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

DETAILED = Image.open(SRC / "icon_transparent_bg_highres.png").convert("RGBA")  # 1458²
SIMPLE = Image.open(SRC / "icon_BIG_SPLAT.png").convert("RGBA")                 # 729²

SMALL = [16, 20, 24, 32]              # simplified artwork
LARGE = [48, 64, 96, 128, 256]        # detailed artwork
ICO_SIZES = SMALL + LARGE



def premultiply(img: Image.Image) -> Image.Image:
    """Scale colour by coverage, so transparent pixels carry no colour weight."""
    a = np.asarray(img, dtype=np.float32)
    alpha = a[..., 3:4] / 255.0
    rgb = a[..., :3] * alpha
    return Image.fromarray(
        np.concatenate([rgb, a[..., 3:4]], axis=-1).round().clip(0, 255).astype(np.uint8),
        "RGBA",
    )


def unpremultiply(img: Image.Image) -> Image.Image:
    a = np.asarray(img, dtype=np.float32)
    alpha = a[..., 3:4]
    # Where alpha is zero the colour is meaningless; leave it fully transparent
    # rather than dividing by zero.
    safe = np.where(alpha == 0, 1.0, alpha)
    rgb = np.where(alpha == 0, 0.0, a[..., :3] * 255.0 / safe)
    return Image.fromarray(
        np.concatenate([rgb, alpha], axis=-1).round().clip(0, 255).astype(np.uint8),
        "RGBA",
    )


def resize(img: Image.Image, size: int) -> Image.Image:
    """Lanczos downscale with premultiplied alpha. No post-sharpening — see §2."""
    return unpremultiply(premultiply(img).resize((size, size), Image.LANCZOS))


def source_for(size: int) -> Image.Image:
    return SIMPLE if size in SMALL else DETAILED


def write_ico(path: Path, frames: list[tuple[int, Image.Image]]) -> list[int]:
    """ICO container with PNG-compressed RGBA frames (valid since Vista)."""
    blobs = []
    for size, img in frames:
        buf = BytesIO()
        img.save(buf, format="PNG", optimize=True)
        blobs.append((size, buf.getvalue()))

    header = struct.pack("<HHH", 0, 1, len(blobs))
    offset = len(header) + 16 * len(blobs)
    entries, data = b"", b""
    for size, blob in blobs:
        entries += struct.pack(
            "<BBBBHHII",
            0 if size >= 256 else size,   # width  (0 means 256)
            0 if size >= 256 else size,   # height
            0, 0, 1, 32,
            len(blob), offset,
        )
        data += blob
        offset += len(blob)

    path.write_bytes(header + entries + data)
    return [s for s, _ in blobs]


def main() -> None:
    # App icon: splat-forward throughout, so it stays distinct in the taskbar.
    app = [(s, resize(SIMPLE, s)) for s in ICO_SIZES]
    # File-type icon: page-forward where there is room, splat where there is not,
    # so a .md file never looks identical to the executable.
    doc = [(s, resize(source_for(s), s)) for s in ICO_SIZES]
    # Installer icon: the full artwork. The installer window shows it at 32px and
    # larger, where the detail reads clearly, and it is the mark people recognise
    # from the download rather than the taskbar.
    setup = [(s, resize(DETAILED, s)) for s in ICO_SIZES]

    print("icon.ico     ", write_ico(OUT / "icon.ico", app))
    print("file-md.ico  ", write_ico(OUT / "file-md.ico", doc))
    print("installer.ico", write_ico(OUT / "installer.ico", setup))

    for name, size, src in [
        ("32x32.png", 32, SIMPLE),
        ("128x128.png", 128, DETAILED),
        ("128x128@2x.png", 256, DETAILED),
        ("icon.png", 512, DETAILED),
        ("installer-header.png", 150, DETAILED),
    ]:
        resize(src, size).save(OUT / name, optimize=True)

    print()
    for p in sorted(OUT.iterdir()):
        if p.suffix in {".png", ".ico"}:
            print(f"  {p.name:<22} {p.stat().st_size:>8,} bytes")


if __name__ == "__main__":
    main()
