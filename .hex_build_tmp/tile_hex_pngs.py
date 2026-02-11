import os, math
from PIL import Image

# Allow very large images (our 16384x16384 export is intentional)
Image.MAX_IMAGE_PIXELS = 300_000_000

TILE  = int(os.environ.get("HEX_TILE", "256"))
MIN_Z = int(os.environ.get("HEX_MIN_Z", "0"))
MAX_Z = int(os.environ.get("HEX_MAX_Z", "6"))
BASE  = int(os.environ.get("HEX_BASE", "16384"))

IN_DIR  = os.environ["HEX_IN_DIR"]
OUT_DIR = os.environ["HEX_OUT_DIR"]

BLEED = 1  # 1px overlap to avoid seams on transparent line layers

def ensure_dir(p):
    os.makedirs(p, exist_ok=True)

for z in range(MIN_Z, MAX_Z + 1):
    size = int(BASE / (2 ** (MAX_Z - z)))
    src = os.path.join(IN_DIR, f"hex_z{z}.png")
    if not os.path.exists(src):
        raise FileNotFoundError(src)

    img = Image.open(src).convert("RGBA")
    if img.size != (size, size):
        raise RuntimeError(f"{src} is {img.size}, expected {(size, size)}")

    tiles_x = math.ceil(size / TILE)
    tiles_y = math.ceil(size / TILE)

    for x in range(tiles_x):
        for y in range(tiles_y):
            left   = x * TILE
            top    = y * TILE
            right  = min(left + TILE, size)
            bottom = min(top + TILE, size)

            # Crop with 1px bleed (clamped to image bounds)
            src_left   = max(left - BLEED, 0)
            src_top    = max(top - BLEED, 0)
            src_right  = min(right + BLEED, size)
            src_bottom = min(bottom + BLEED, size)

            patch = img.crop((src_left, src_top, src_right, src_bottom))

            # Paste into a 256x256 tile at the correct offset
            tile = Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))
            paste_x = -(left - src_left)
            paste_y = -(top  - src_top)
            tile.paste(patch, (paste_x, paste_y))

            out_folder = os.path.join(OUT_DIR, str(z), str(x))
            ensure_dir(out_folder)
            tile.save(os.path.join(out_folder, f"{y}.png"), optimize=True)

    print(f"tiled z={z}: {tiles_x}x{tiles_y} tiles")
