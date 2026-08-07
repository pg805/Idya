# Copy the exported tileset PNGs from the Asset Library into public/tiles/.
#
# The Asset Library is the source of truth: tiles are authored as individual
# .aseprite files there, assembled into the two sheets by its build-tilesets.lua,
# and exported to PNG. This just carries the exported sheets across - it does not
# build them. Re-export from Aseprite first, then run this.
#
#   npm run tiles:sync
#
# If a sprite MOVES on a sheet, the atlas in public/terrain.js has to move with
# it - that table mirrors build-tilesets.lua's LAYOUT by hand.
#
# ASCII only, deliberately: Windows PowerShell 5.1 reads a UTF-8 script without a
# BOM as ANSI, and a stray em dash in a comment becomes a parse error.

param(
    [string]$Library = 'G:\Pixel Art\Asset Library'
)

$ErrorActionPreference = 'Stop'
$dest = Join-Path $PSScriptRoot '..\public\tiles'

if (-not (Test-Path $Library)) { throw "Asset Library not found: $Library" }
if (-not (Test-Path $dest)) { New-Item -ItemType Directory $dest | Out-Null }

foreach ($sheet in @('tileset_terrain.png', 'tileset_decor.png')) {
    $src = Join-Path $Library $sheet
    if (-not (Test-Path $src)) { throw "Missing $sheet in ${Library}: export it from Aseprite first." }
    Copy-Item $src $dest -Force
    $size = (Get-Item $src).Length
    Write-Host "synced $sheet ($size bytes)"
}
