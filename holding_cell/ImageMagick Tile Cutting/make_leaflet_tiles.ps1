param(
  [Parameter(Mandatory=$true)][string]$InputPng,
  [Parameter(Mandatory=$true)][string]$OutDir,
  [int]$TileSize = 256,
  [int]$MaxZ = -1
)

# --- Helpers ---
function Ensure-Dir([string]$p) { New-Item -ItemType Directory -Force -Path $p | Out-Null }

# Validate input
if (!(Test-Path $InputPng)) { throw "Input not found: $InputPng" }
Ensure-Dir $OutDir

# Auto-detect MaxZ if not provided:
# Assumes square image and that you want a power-of-two pyramid anchored on TileSize.
if ($MaxZ -lt 0) {
  $identify = & magick identify -format "%w %h" "$InputPng"
  $parts = $identify -split " "
  $w = [int]$parts[0]
  $h = [int]$parts[1]
  if ($w -ne $h) { throw "Input must be square for auto MaxZ. Got ${w}x${h}. Provide -MaxZ manually if needed." }
  $ratio = $w / $TileSize
  $MaxZ = [int][math]::Round([math]::Log($ratio, 2))
  if ($TileSize * [math]::Pow(2, $MaxZ) -ne $w) {
    throw "Input size ${w} isn't exactly TileSize*2^MaxZ. (TileSize=$TileSize, computed MaxZ=$MaxZ). Provide -MaxZ manually."
  }
}

Write-Host "Input: $InputPng"
Write-Host "Output: $OutDir"
Write-Host "TileSize: $TileSize"
Write-Host "MaxZ: $MaxZ"

# Create empty.png (transparent)
& magick -size "${TileSize}x${TileSize}" xc:none -define png:color-type=6 "$OutDir\empty.png"

for ($z = $MaxZ; $z -ge 0; $z--) {
  $dim  = [int]($TileSize * [math]::Pow(2, $z))
  $cols = [int]([math]::Pow(2, $z))

  $zDir = Join-Path $OutDir $z
  Ensure-Dir $zDir

  Write-Host "Generating z=$z (${dim}x${dim}), grid=${cols}x${cols}..."

  # 1) Resize to this zoom level
  # 2) Crop into TileSize tiles
  # 3) Write sequential temp tiles: temp_0.png, temp_1.png, ...
  #
  # Notes:
  # -alpha on keeps transparency
  # -define png:color-type=6 forces RGBA output
  # -filter point avoids edge blending halos when downscaling pixel art / sharp lines;
  #   for painted maps, you may prefer lanczos (see tip below).
  #
  & magick "$InputPng" `
    -alpha on `
    -resize "${dim}x${dim}!" `
    -define png:color-type=6 `
    -crop "${TileSize}x${TileSize}" +repage +adjoin `
    "$zDir\temp_%d.png"

  # Move temp_%d.png into z/x/y.png
  Get-ChildItem "$zDir\temp_*.png" | ForEach-Object {
    if ($_.Name -match "^temp_(\d+)\.png$") {
      $i = [int]$matches[1]
      $x = $i % $cols
      $y = [int]([math]::Floor($i / $cols))

      $xDir = Join-Path $zDir $x
      Ensure-Dir $xDir

      Move-Item $_.FullName (Join-Path $xDir "$y.png") -Force
    }
  }
}

Write-Host "Done."