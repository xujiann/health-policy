# Serve the static site locally and open it in the browser.
# ASCII-only (PowerShell 5.1 reads .ps1 as GBK).
# Usage: powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8765]

param([int]$Port = 8765)

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$siteDir = Join-Path $root "site"
$dataFile = Join-Path $siteDir "data\policies.json"
if (-not (Test-Path $dataFile)) {
    Write-Warning "data\policies.json not found. Run run_update.ps1 first."
}

$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = (Get-Command py -ErrorAction SilentlyContinue).Source }
if (-not $py) { Write-Error "python not found in PATH"; exit 1 }

$url = "http://localhost:$Port/"
Write-Host "Serving $siteDir at $url  (Ctrl+C to stop)"
Start-Process $url
& $py -m http.server $Port --directory $siteDir
