param(
  [string]$Svg = "hex_grid.svg",
  [int]$MinZoom = 0,
  [int]$MaxZoom = 6,
  [int]$BaseSize = 16384,      # size of SVG at MaxZoom
  [int]$TileSize = 256,
  [string]$OutTiles = "tiles/overlays/hexes",
  [string]$TempDir = ".hex_build_tmp",
  [switch]$Clean
)

$ErrorActionPreference = "Stop"

function Require-Cmd($name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "Required command not found: $name. Make sure it’s installed and on PATH." }
  return $cmd.Source
}

function Ensure-Dir($p) {
  if (!(Test-Path $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
}

function Remove-Dir($p) {
  if (Test-Path $p) { Remove-Item -Recurse -Force $p }
}

Write-Host "== Hex overlay build =="

# Check inputs
if (!(Test-Path $Svg)) { throw "SVG not found: $Svg" }

# Check tools
$inkscapeExe = Require-Cmd "inkscape"
$pythonExe = $null
try {
  $pythonExe = (Get-Command "py" -ErrorAction SilentlyContinue).Source
} catch {}
if (-not $pythonExe) {
  $pythonExe = Require-Cmd "python"
}

Write-Host "Inkscape: $inkscapeExe"
Write-Host "Python:   $pythonExe"

if ($Clean) {
  Write-Host "Cleaning output folders..."
  Remove-Dir $TempDir
  Remove-Dir $OutTiles
}

Ensure-Dir $TempDir
Ensure-Dir $OutTiles

# Ensure Pillow is installed
Write-Host "Checking Pillow..."
& $pythonExe -c "import PIL; print('Pillow OK')" | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Installing Pillow (one-time)..."
  & $pythonExe -m pip install --upgrade pillow
}

# Export per-zoom PNGs from SVG (crisp at each zoom)
Write-Host "`nExporting PNGs per zoom..."
$pngDir = Join-Path $TempDir "png"
Ensure-Dir $pngDir

for ($z = $MinZoom; $z -le $MaxZoom; $z++) {
  $size = [int]($BaseSize / [math]::Pow(2, ($MaxZoom - $z)))
  $png = Join-Path $pngDir ("hex_z{0}.png" -f $z)

  Write-Host ("  z={0}  {1}x{1} -> {2}" -f $z, $size, $png)

  & $inkscapeExe $Svg `
    --export-type=png `
    --export-filename="$png" `
    --export-width=$size `
    --export-height=$size `
    --export-background-opacity=0 `
    --export-overwrite

  if (!(Test-Path $png)) { throw "Export failed (file not created): $png" }
}

# Write a small Python tiler to temp and run it
$tilerPath = Join-Path $TempDir "tile_hex_pngs.py"

$tiler = @"
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
"@

Set-Content -Path $tilerPath -Value $tiler -Encoding UTF8

Write-Host "`nTiling PNGs into Leaflet folders..."
$env:HEX_TILE = "$TileSize"
$env:HEX_MIN_Z = "$MinZoom"
$env:HEX_MAX_Z = "$MaxZoom"
$env:HEX_BASE = "$BaseSize"
$env:HEX_IN_DIR = (Resolve-Path $pngDir).Path
$env:HEX_OUT_DIR = (Resolve-Path $OutTiles).Path

if ($pythonExe -like "*\py.exe") {
  & $pythonExe $tilerPath
} else {
  & $pythonExe $tilerPath
}

if ($LASTEXITCODE -ne 0) {
  throw "Python tiler failed with exit code $LASTEXITCODE"
}

Write-Host "`nDone."
Write-Host "Tiles at: $OutTiles"
Write-Host "Tip: hard-refresh your browser cache (Ctrl+F5) after replacing tiles."
