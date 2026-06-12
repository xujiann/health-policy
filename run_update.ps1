# Health Policy site - daily update (harvest + build).
# ASCII-only on purpose: PowerShell 5.1 reads .ps1 as GBK and chokes on non-ASCII.
# Usage:
#   powershell -ExecutionPolicy Bypass -File run_update.ps1
#   powershell -ExecutionPolicy Bypass -File run_update.ps1 -Fulltext   (also fetch article bodies; slow)

param(
    [switch]$Fulltext,
    [switch]$Push,        # after build, commit site/data and push to GitHub (Pages auto-redeploys)
    [int]$Since = 2009
)

# 'Continue' (not 'Stop'): native commands (git/python) write normal info to stderr;
# with 'Stop' + 2>&1 that gets turned into a terminating NativeCommandError and aborts
# the script mid-push. We check $LASTEXITCODE explicitly after each native call instead.
$ErrorActionPreference = "Continue"
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

# 3) optional: push data to GitHub so Pages redeploys
if ($Push) {
    "[{0}] pushing to GitHub..." -f (Get-Date) | Tee-Object -FilePath $log -Append
    & git add site/data 2>&1 | Out-Null
    $changed = & git status --porcelain site/data
    if ($changed) {
        $msg = "Auto data update " + (Get-Date -Format "yyyy-MM-dd")
        (& git commit -m $msg 2>&1 | Out-String).Trim() | Tee-Object -FilePath $log -Append
        (& git push origin main 2>&1 | Out-String).Trim() | Tee-Object -FilePath $log -Append
        $code = $LASTEXITCODE
        if ($code -eq 0) {
            "push done; GitHub Pages will redeploy in ~1 min" | Tee-Object -FilePath $log -Append
        } else {
            "push FAILED exit=$code" | Tee-Object -FilePath $log -Append
        }
    } else {
        "no data change; nothing to push" | Tee-Object -FilePath $log -Append
    }
}

"[{0}] update done. Open site with serve.ps1" -f (Get-Date) | Tee-Object -FilePath $log -Append

# prune logs older than 30 days
Get-ChildItem $logDir -Filter "update_*.txt" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force -ErrorAction SilentlyContinue
