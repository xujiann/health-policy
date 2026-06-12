# Health Policy site - daily update (harvest + build).
# ASCII-only on purpose: PowerShell 5.1 reads .ps1 as GBK and chokes on non-ASCII.
# Usage:
#   powershell -ExecutionPolicy Bypass -File run_update.ps1
#   powershell -ExecutionPolicy Bypass -File run_update.ps1 -Fulltext   (also fetch article bodies; slow)

param(
    [switch]$Fulltext,
    [int]$Since = 2009
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $root

# Find python
$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = (Get-Command py -ErrorAction SilentlyContinue).Source }
if (-not $py) { Write-Error "python not found in PATH"; exit 1 }

$logDir = Join-Path $root "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$log = Join-Path $logDir "update_$stamp.txt"

"[{0}] update start (Since={1}, Fulltext={2})" -f (Get-Date), $Since, $Fulltext.IsPresent | Tee-Object -FilePath $log

# 1) harvest
$harvestArgs = @("harvest.py", "--since", "$Since")
if ($Fulltext) { $harvestArgs += "--fulltext" }
& $py @harvestArgs 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) { "harvest FAILED exit=$LASTEXITCODE" | Tee-Object -FilePath $log -Append; exit 1 }

# 2) build site JSON
& $py "build_site.py" 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) { "build FAILED exit=$LASTEXITCODE" | Tee-Object -FilePath $log -Append; exit 1 }

"[{0}] update done. Open site with serve.ps1" -f (Get-Date) | Tee-Object -FilePath $log -Append

# prune logs older than 30 days
Get-ChildItem $logDir -Filter "update_*.txt" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force -ErrorAction SilentlyContinue
