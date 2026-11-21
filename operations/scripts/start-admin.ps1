param()
$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$gameRoot=Join-Path $projectRoot 'games/heroes-of-ether'
$nodeExe=Join-Path $projectRoot 'operations/runtimes/node-v24.22.3-win-x64/node.exe'
$config=Join-Path $gameRoot 'data/admin-control.json'
if(!(Test-Path -LiteralPath $config)){throw 'Independent administration is not configured.'}
$port=(Get-Content -LiteralPath $config -Raw|ConvertFrom-Json).port
$listeners=@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
$existing=$false
$lockFile=Join-Path $gameRoot 'admin-control/control.lock'
if(Test-Path -LiteralPath $lockFile){
 $recordedProcessId=[int](Get-Content -LiteralPath $lockFile -Raw)
 $recorded=Get-CimInstance Win32_Process -Filter "ProcessId=$recordedProcessId"
 if($recorded){
  if([IO.Path]::GetFullPath($recorded.ExecutablePath) -ne $nodeExe -or $recorded.CommandLine -notmatch 'admin-control\.js"?\s*$'){throw 'Admin lock belongs to an unexpected process; nothing was stopped.'}
  $existing=$true
 }
}
if($listeners.Count){
 foreach($listener in $listeners){
  $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  if($listener.LocalAddress -ne '127.0.0.1' -or [IO.Path]::GetFullPath($proc.ExecutablePath) -ne $nodeExe -or $proc.CommandLine -notmatch 'admin-control\.js"?\s*$'){throw 'Admin port belongs to another process; nothing was stopped.'}
 }
}elseif(!$existing){
 $logs=Join-Path $env:LOCALAPPDATA 'HeroEther/admin-control'
 $null=New-Item -ItemType Directory -Path $logs -Force
 $env:PORT='3000';$env:HOST='127.0.0.1'
 $started=Start-Process -FilePath $nodeExe -ArgumentList 'admin-control.js' -WorkingDirectory $gameRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'stdout.log') -RedirectStandardError (Join-Path $logs 'stderr.log') -PassThru
 for($attempt=0;$attempt -lt 40;$attempt++){
  $started.Refresh();if($started.HasExited){throw 'Admin process stopped; inspect its protected local log.'}
  try{$null=Invoke-RestMethod "http://127.0.0.1:$port/api/admin/auth/status" -TimeoutSec 2;break}catch{Start-Sleep -Milliseconds 200}
 }
 if($attempt -eq 40){throw 'Admin service did not become ready.'}
}
& $nodeExe -e "fetch('http://127.0.0.1:$port/api/admin/auth/status',{signal:AbortSignal.timeout(3000)}).then(r=>{if(!r.ok)throw Error();}).catch(()=>process.exitCode=1)"
if($LASTEXITCODE -ne 0){throw 'Independent admin is not responding; existing processes were preserved.'}
Write-Output "Local admin: http://127.0.0.1:$port/admin.html"
