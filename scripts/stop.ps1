# Stops running Glacier servers.
#
# Needed because Ctrl+C and pkill do not reliably kill the Next process on
# Windows: a zombie survives and keeps holding the port. The next start then
# fails with EADDRINUSE, which is invisible when launched in the background --
# leaving you staring at a stale build wondering why your edits do nothing.
#
# ASCII only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI unless the
# file has a BOM, and mangled non-ASCII bytes break the parser.

$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*glacier*' -and $_.CommandLine -like '*next*' }

if (-not $procs) {
    Write-Output "No running Glacier server found."
    exit 0
}

foreach ($p in $procs) {
    Write-Output ("Stopping PID " + $p.ProcessId)
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Milliseconds 800
Write-Output "Done."
