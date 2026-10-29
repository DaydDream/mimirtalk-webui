[CmdletBinding()]
param(
    [string]$Python = "",
    [string]$OutputDir = ""
)

# Build the static web bundle that ships inside the Android app (dist/).
# Layout mirrors the dev static server mounts:
#   static-data/   read-only JSON built by webui/tools/build_static_data.py
#   static-assets/ webui/assets          (asset-index "webui/assets/..." paths)
#   static-source/ assets_source         (asset-index "assets_source/..." paths)
#   static-root/   webui dir             (other "webui/..." paths)
#   index.html + src/ + assets/          the frontend shell
# The packaged index.html gets window.MIMIRTALK_PLATFORM_MODE = "static" injected,
# so the native shell runs without a backend.

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AndroidDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$RepoRoot = (Resolve-Path (Join-Path $AndroidDir "..")).Path
$WebuiDir = Join-Path $RepoRoot "webui"
$FrontendDir = Join-Path $WebuiDir "frontend"
$AssetsSourceDir = Join-Path $RepoRoot "assets_source"

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $RepoRoot "dist"
}
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)

function Resolve-Python {
    param([string]$Explicit)
    $candidates = New-Object System.Collections.Generic.List[string]
    if (-not [string]::IsNullOrWhiteSpace($Explicit)) { $candidates.Add($Explicit) }
    if (-not [string]::IsNullOrWhiteSpace($env:MIMIRTALK_PYTHON)) { $candidates.Add($env:MIMIRTALK_PYTHON) }
    $candidates.Add("python")
    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
        try {
            $output = & $candidate --version 2>&1
            if ($LASTEXITCODE -eq 0 -and ("$output" -match "Python 3")) { return $candidate }
        } catch {
            continue
        }
    }
    throw "Python 3 interpreter not found. Pass -Python <path> or set MIMIRTALK_PYTHON."
}

function Copy-Tree {
    param([string]$Source, [string]$Destination)
    if (-not (Test-Path -LiteralPath $Source)) { throw "missing source dir: $Source" }
    if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force
}

$PythonExe = Resolve-Python -Explicit $Python
Write-Output "[web-assets] python: $PythonExe"

if (Test-Path -LiteralPath $OutputDir) {
    Remove-Item -LiteralPath $OutputDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

# 1. Read-only static data.
$StaticDataDir = Join-Path $OutputDir "static-data"
Push-Location $WebuiDir
try {
    & $PythonExe -B "tools/build_static_data.py" "--output" $StaticDataDir
    if ($LASTEXITCODE -ne 0) { throw "build_static_data.py failed" }
} finally {
    Pop-Location
}

# 2. Frontend shell.
Copy-Item -LiteralPath (Join-Path $FrontendDir "index.html") -Destination (Join-Path $OutputDir "index.html") -Force
Copy-Tree -Source (Join-Path $FrontendDir "src") -Destination (Join-Path $OutputDir "src")
Copy-Tree -Source (Join-Path $FrontendDir "assets") -Destination (Join-Path $OutputDir "assets")

# 3. Static mounts for packaged assets.
Copy-Tree -Source (Join-Path $WebuiDir "assets") -Destination (Join-Path $OutputDir "static-assets")
Copy-Tree -Source $AssetsSourceDir -Destination (Join-Path $OutputDir "static-source")
New-Item -ItemType Directory -Force -Path (Join-Path $OutputDir "static-root") | Out-Null

# 4. Force static platform mode in the packaged shell.
$IndexPath = Join-Path $OutputDir "index.html"
$html = [System.IO.File]::ReadAllText($IndexPath, [System.Text.Encoding]::UTF8)
$headTag = "<head>"
$headIndex = $html.IndexOf($headTag)
if ($headIndex -lt 0) { throw "index.html has no <head> tag" }
$inject = ($headTag + "`n    <script>window.MIMIRTALK_PLATFORM_MODE = `"static`";</script>")
$html = $html.Substring(0, $headIndex) + $inject + $html.Substring($headIndex + $headTag.Length)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($IndexPath, $html, $utf8NoBom)
if (-not ($html -match 'MIMIRTALK_PLATFORM_MODE\s*=\s*"static"')) {
    throw "failed to inject platform mode into index.html"
}

# 5. Verify both packaged fonts, licenses, pinned hashes and full coverage.
$PackagedFont = Join-Path $OutputDir "assets\fonts\noto-serif-sc-bold.ttf"
Push-Location $WebuiDir
try {
    & $PythonExe -B "tools/check_fonts.py" "--font" $PackagedFont
    if ($LASTEXITCODE -ne 0) { throw "check_fonts.py failed for $PackagedFont" }
} finally {
    Pop-Location
}
$FontInfo = Get-Item -LiteralPath $PackagedFont
Write-Output ("[web-assets] name font: {0:N2} MB" -f ($FontInfo.Length / 1MB))

# 6. Report.
$files = Get-ChildItem -LiteralPath $OutputDir -Recurse -File
$total = ($files | Measure-Object -Property Length -Sum).Sum
Write-Output ("[web-assets] dist: {0}" -f $OutputDir)
Write-Output ("[web-assets] files: {0}, size: {1:N2} MB" -f $files.Count, ($total / 1MB))
