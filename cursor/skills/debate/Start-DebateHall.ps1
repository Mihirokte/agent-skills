<#
.SYNOPSIS
  Starts Debate Hall — GUI only, no console window, script exits immediately.

.DESCRIPTION
  Uses pythonw.exe (no terminal) and Start-Process so PowerShell does not stay open.
  Hall: http://127.0.0.1:8765/

.EXAMPLE
  .\Start-DebateHall.ps1
  .\Start-DebateHall.ps1 -Port 9000
#>
[CmdletBinding()]
param(
    [int] $Port = 8765,
    [string] $HostName = "127.0.0.1",
    [switch] $NoAutostart
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$py = Join-Path $here "start_debate_hall.py"
if (-not (Test-Path -LiteralPath $py)) {
    Write-Error "start_debate_hall.py not found in $here"
}

$pythonExe = (Get-Command python -ErrorAction Stop).Source
$pythonDir = Split-Path $pythonExe -Parent
$pythonwExe = Join-Path $pythonDir "pythonw.exe"
if (-not (Test-Path -LiteralPath $pythonwExe)) {
    Write-Error "pythonw.exe not found next to python at: $pythonwExe (use a full python.org install)."
}

$argList = New-Object System.Collections.Generic.List[string]
$argList.Add($py)
$argList.Add("--port")
$argList.Add("$Port")
$argList.Add("--host")
$argList.Add($HostName)
if ($NoAutostart) {
    $argList.Add("--no-autostart")
}

Start-Process -FilePath $pythonwExe -ArgumentList $argList -WorkingDirectory $here
