# TASK-011(b) junction cases, scripted for Windows Sandbox. Runs inside the sandbox only.
# Usage (LogonCommand): powershell -ExecutionPolicy Bypass -File C:\FFKit\run-cases.ps1 -Build old|new
param([Parameter(Mandatory)][ValidateSet('old','new')][string]$Build)
$ErrorActionPreference = 'Continue'
$out = "C:\FFOut\$Build"
New-Item -ItemType Directory -Force $out | Out-Null
Start-Transcript -Path "$out\transcript.txt" -Force | Out-Null
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

function Shot($name) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $bmp.Save("$out\$name.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
function Exe { Join-Path $env:LOCALAPPDATA 'FundedFlow\fundedflow.exe' }
function Launch($case) {
  Get-Process fundedflow -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep 2
  $p = Start-Process (Exe) -PassThru
  Start-Sleep 20
  Shot $case
  $alive = -not $p.HasExited
  Get-Process fundedflow -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep 3
  return $alive
}
function Files($path) {
  if (Test-Path -LiteralPath $path) { (Get-ChildItem -LiteralPath $path -Force | ForEach-Object Name) -join ', ' } else { '(missing)' }
}
$results = @()
function Record($case, $setup, $links, $dataFolder, $alive, $files) {
  $script:results += [pscustomobject]@{ case=$case; setup=$setup; links=$links; dataFolder=$dataFolder; processAliveAfter20s=$alive; filesInDataFolder=$files }
}

# Environment
$os = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$wvKey = 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$wv = (Get-ItemProperty "HKLM:\$wvKey" -ErrorAction SilentlyContinue).pv
$exe = Get-ChildItem "C:\FFKit\$Build\*.exe" | Select-Object -First 1
[pscustomobject]@{
  build=$Build; user=(whoami); os="$($os.ProductName) $($os.DisplayVersion) $($os.CurrentBuild).$($os.UBR)"
  webview2Before=$wv; installer=$exe.Name; sha256=(Get-FileHash $exe.FullName -Algorithm SHA256).Hash.ToLower()
  appdataBefore=(Test-Path "$env:APPDATA\com.fundedflow.desktop"); devDataDir=$env:FUNDEDFLOW_DEV_DATA_DIR
} | ConvertTo-Json | Set-Content "$out\environment.json"

# Install silently (per-user NSIS)
$inst = Start-Process $exe.FullName -ArgumentList '/S' -PassThru -Wait
"installer exit: $($inst.ExitCode); exe present: $(Test-Path (Exe))" | Set-Content "$out\install.txt"

$app = Join-Path $env:APPDATA 'com.fundedflow.desktop'

# B1 standard profile
$alive = Launch 'B1-standard'
Record 'B1 standard profile' 'none' '-' $app $alive (Files $app)

# B3 app folder itself is a junction
Rename-Item $app 'com.fundedflow.desktop.b3-orig'
New-Item -ItemType Directory -Force 'C:\FFJunctionTarget\com.fundedflow.desktop' | Out-Null
New-Item -ItemType Junction -Path $app -Target 'C:\FFJunctionTarget\com.fundedflow.desktop' | Out-Null
$links = (cmd /c dir /AL $env:APPDATA) -join "`n"
$alive = Launch 'B3-app-folder-junction'
Record 'B3 app folder is junction' 'New-Item -ItemType Junction <APPDATA>\com.fundedflow.desktop -> C:\FFJunctionTarget\com.fundedflow.desktop' $links $app $alive ("link: " + (Files $app) + " | target: " + (Files 'C:\FFJunctionTarget\com.fundedflow.desktop'))
cmd /c rmdir $app | Out-Null
Rename-Item "$env:APPDATA\com.fundedflow.desktop.b3-orig" 'com.fundedflow.desktop'
$alive = Launch 'B3-undo-relaunch'
Record 'B3 undo -> relaunch' 'junction removed, original restored' '-' $app $alive (Files $app)

# B2 equivalent: Roaming AppData redirected to a path whose parent is a junction
# (Sandbox has one user, so the Roaming folder is redirected through the registry instead of moving another user's profile.)
New-Item -ItemType Directory -Force 'C:\FFRelocatedReal\Roaming' | Out-Null
New-Item -ItemType Junction -Path 'C:\FFRelocated' -Target 'C:\FFRelocatedReal' | Out-Null
$usf = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
$old = (Get-ItemProperty $usf).AppData
Set-ItemProperty $usf -Name AppData -Value 'C:\FFRelocated\Roaming' -Type ExpandString
$links = (cmd /c dir /AL C:\) -join "`n"
$alive = Launch 'B2-roaming-behind-junction'
Record 'B2 Roaming behind a junction (registry redirect)' 'C:\FFRelocated -> C:\FFRelocatedReal (junction); User Shell Folders\AppData = C:\FFRelocated\Roaming' $links 'C:\FFRelocated\Roaming\com.fundedflow.desktop' $alive ("via link: " + (Files 'C:\FFRelocated\Roaming\com.fundedflow.desktop') + " | real: " + (Files 'C:\FFRelocatedReal\Roaming\com.fundedflow.desktop'))
Set-ItemProperty $usf -Name AppData -Value $old -Type ExpandString

$results | ConvertTo-Json -Depth 3 | Set-Content "$out\results.json"
"done $(Get-Date -Format o)" | Set-Content "$out\done.txt"
Stop-Transcript | Out-Null
