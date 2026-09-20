<#
  MimirTalk WebUI launcher (source checkout).

  Resolution order for the Python interpreter:
    1. python-runtime\python.exe  (portable runtime, if present)
    2. python                     (from PATH)
    3. py -3                      (Windows launcher)

  This file is intentionally ASCII-only so that Windows PowerShell 5.1,
  which reads scripts without a BOM as ANSI, never mis-parses it.
#>
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'MimirTalk WebUI'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($args.Count -ge 1 -and "$($args[0])" -match '^\d+$') { $Port = [int]$args[0] } else { $Port = 8765 }

function Fail([string]$Message, [string]$Hint = '') {
    Write-Host ''
    Write-Host "[ERROR] $Message" -ForegroundColor Red
    if ($Hint) { Write-Host "        $Hint" -ForegroundColor Yellow }
    Write-Host ''
    Read-Host 'Press Enter to close'
    exit 1
}

$Python = $null
$PyArgs = @()
$Portable = Join-Path $Root 'python-runtime\python.exe'
if (Test-Path -LiteralPath $Portable) {
    $Python = $Portable
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $Python = 'python'
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    $Python = 'py'
    $PyArgs = @('-3')
}
if (-not $Python) {
    Fail 'Python 3 was not found.' 'Install Python 3.12+ with "Add python.exe to PATH", or download a release build with a bundled runtime.'
}

& $Python @PyArgs -c 'import PIL' 2>$null
if ($LASTEXITCODE -ne 0) {
    Fail 'Missing dependency: Pillow.' "Run: `"$Python`" $($PyArgs -join ' ') -m pip install pillow"
}

$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($busy) {
    Fail "Port $Port is already in use by PID $($busy[0].OwningProcess)." "Try another port, for example: Start-WebUI.ps1 8766"
}

if ($env:MIMIRTALK_SKIP_BROWSER -ne '1') {
    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:$Port/'" | Out-Null
}

Write-Host ''
Write-Host '  MimirTalk WebUI' -ForegroundColor Cyan
Write-Host "  URL:  http://127.0.0.1:$Port/"
Write-Host '  Stop: press Ctrl+C in this window'
Write-Host ''

& $Python @PyArgs (Join-Path $Root 'webui\backend\app.py') --host 127.0.0.1 --port $Port
if ($LASTEXITCODE -ne 0) { Fail "Server exited with code $LASTEXITCODE." }
Write-Host ''
Write-Host '[OK] Server stopped.'
