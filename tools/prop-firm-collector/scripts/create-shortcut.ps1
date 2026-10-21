# Creates a "FundedFlow Collector" shortcut that opens the desktop window (no console window).
# Run from tools\prop-firm-collector after `uv sync`:   .\scripts\create-shortcut.ps1
# Use -Destination to put it somewhere other than your Desktop.
param(
    [string]$Destination = [Environment]::GetFolderPath("Desktop")
)
$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $PSScriptRoot
$target = Join-Path $project ".venv\Scripts\collector-gui.exe"
if (-not (Test-Path $target)) {
    Write-Error "Not found: $target. Run 'uv sync' in $project first."
}
$link = Join-Path $Destination "FundedFlow Collector.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $project
$shortcut.Description = "FundedFlow prop-firm collector (unverified evidence only)"
$shortcut.Save()
Write-Output "Created $link"
