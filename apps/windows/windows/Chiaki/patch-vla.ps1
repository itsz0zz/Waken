# MSVC has no variable length arrays (C99 VLAs), which chiaki-ng uses in a few places, all on its rudp path
# (remote play over the Internet, stubbed out in Waken). This writes a copy of each file with
# `uint8_t name[size_var];` turned into a stack allocation of the same size, so the submodule stays untouched.
param(
  [Parameter(Mandatory)][string]$Source,
  [Parameter(Mandatory)][string]$OutDir
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$text = [System.IO.File]::ReadAllText($Source)
$pattern = 'uint8_t\s+(\w+)\[(\w+_size)\];'
$count = ([regex]::Matches($text, $pattern)).Count
if ($count -eq 0) { throw "patch-vla: no variable length array left in $Source, update Chiaki.vcxproj" }
$patched = [regex]::Replace($text, $pattern, 'uint8_t *$1 = (uint8_t *)_alloca($2);')
$out = Join-Path $OutDir ([System.IO.Path]::GetFileName($Source))
$content = "#include <malloc.h>`n#line 1 `"$($Source -replace '\\', '/')`"`n" + $patched
# Rewrite only on change, so the incremental build does not recompile every time.
if (-not (Test-Path $out) -or [System.IO.File]::ReadAllText($out) -ne $content) {
  [System.IO.File]::WriteAllText($out, $content, (New-Object System.Text.UTF8Encoding $false))
}
