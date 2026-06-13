# Health Policy - tagging loop. Runs every ~5.5h until the LLM-tagging backlog
# is cleared, then keeps tagging each day's new policies. Each run:
#   tag one usage window -> rebuild site JSON -> push if data changed.
# ASCII-only (PowerShell 5.1 reads .ps1 as GBK). Continue + explicit $LASTEXITCODE
# so native stderr (git/python) never aborts the script mid-run.

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $root

$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = (Get-Command py -ErrorAction SilentlyContinue).Source }
if (-not $py) { Write-Error "python not found"; exit 1 }

$logDir = Join-Path $root "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir ("tagloop_" + (Get-Date -Format "yyyy-MM-dd_HHmmss") + ".txt")

"[{0}] tag-loop start" -f (Get-Date) | Tee-Object -FilePath $log

# 1) tag one usage window (stops gracefully on session limit)
& $py "tag_policies.py" --batch 20 2>&1 | Tee-Object -FilePath $log -Append

# 2) rebuild site data
& $py "build_site.py" 2>&1 | Tee-Object -FilePath $log -Append

# 3) push if site/data changed
& git add site/data 2>&1 | Out-Null
$changed = & git status --porcelain site/data
if ($changed) {
    $msg = "Auto tag+build " + (Get-Date -Format "yyyy-MM-dd_HH")
    (& git commit -m $msg 2>&1 | Out-String).Trim() | Tee-Object -FilePath $log -Append
    (& git push origin main 2>&1 | Out-String).Trim() | Tee-Object -FilePath $log -Append
    if ($LASTEXITCODE -eq 0) { "push done" | Tee-Object -FilePath $log -Append }
    else { "push FAILED exit=$LASTEXITCODE" | Tee-Object -FilePath $log -Append }
} else {
    "no data change; nothing to push" | Tee-Object -FilePath $log -Append
}

# report remaining backlog
$remain = & $py -c "import sqlite3;c=sqlite3.connect('policies.db');print(c.execute('SELECT COUNT(*) FROM policies WHERE id NOT IN (SELECT policy_id FROM tag_status)').fetchone()[0])"
"[{0}] tag-loop done; untagged remaining: {1}" -f (Get-Date), $remain | Tee-Object -FilePath $log -Append

# prune tagloop logs older than 14 days
Get-ChildItem $logDir -Filter "tagloop_*.txt" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item -Force -ErrorAction SilentlyContinue
