param([switch]$Open)
$ErrorActionPreference = 'Stop'
$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$key = Join-Path $env:USERPROFILE '.ssh\heroether-sweb-admin'
$hostsFile = Join-Path $PSScriptRoot 'known_hosts'
$runtime = Join-Path $env:LOCALAPPDATA 'HeroEther\vps-admin'
$nodeExe=Join-Path (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path 'operations/runtimes/node-v24.22.3-win-x64/node.exe'
if (-not (Test-Path -LiteralPath $key)) { throw 'Missing dedicated VPS admin SSH key.' }
$listeners = @(Get-NetTCPConnection -LocalPort 3102 -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count) {
    foreach ($listener in $listeners) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
        if ($listener.LocalAddress -ne '127.0.0.1' -or $proc.Name -ne 'ssh.exe' -or
            $proc.CommandLine -notlike '*heroether-admin-tunnel@195.208.123.221*' -or
            ($proc.CommandLine -notlike '*127.0.0.1:3102:127.0.0.1:3000*' -and $proc.CommandLine -notlike '*127.0.0.1:3102:127.0.0.1:3103*')) {
            throw 'Port 3102 belongs to another program. No process was stopped.'
        }
    }
    # One-time migration of this exact restricted tunnel; no game process is stopped.
    foreach ($listener in $listeners) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
        if ($proc.CommandLine -like '*127.0.0.1:3102:127.0.0.1:3000*') {
            Stop-Process -Id $listener.OwningProcess
            Wait-Process -Id $listener.OwningProcess -Timeout 5 -ErrorAction SilentlyContinue
        }
    }
    $listeners = @(Get-NetTCPConnection -LocalPort 3102 -State Listen -ErrorAction SilentlyContinue)
}
$known = @(Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" | Where-Object { $_.ExecutablePath -eq $ssh -and $_.CommandLine -like '*heroether-admin-tunnel@195.208.123.221*' })
foreach($proc in $known){if($proc.CommandLine -like '*127.0.0.1:3102:127.0.0.1:3000*'){Stop-Process -Id $proc.ProcessId}}
$matching = @($known | Where-Object { $_.CommandLine -like '*127.0.0.1:3102:127.0.0.1:3103*' })
if (-not $listeners.Count -and -not $matching.Count) {
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    $errorLog = Join-Path $runtime 'ssh-error.log'
    $outputLog = Join-Path $runtime 'ssh-output.log'
    $arguments = @('-N', '-T', '-i', ('"' + $key + '"'), '-o', 'BatchMode=yes',
        '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
        '-o', ('"UserKnownHostsFile=' + $hostsFile + '"'), '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
        '-L', '127.0.0.1:3102:127.0.0.1:3103', 'heroether-admin-tunnel@195.208.123.221')
    $child = Start-Process -FilePath $ssh -ArgumentList $arguments -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $outputLog -RedirectStandardError $errorLog
    $ready = $false
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
        $child.Refresh()
        if ($child.HasExited) { throw "SSH stopped. Check $errorLog" }
        try {
            & $nodeExe -e "fetch('http://127.0.0.1:3102/api/admin/auth/status',{signal:AbortSignal.timeout(2000)}).then(r=>{if(!r.ok)throw Error();}).catch(()=>process.exitCode=1)"
            if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        } catch {}
        Start-Sleep -Milliseconds 200
    }
    if (-not $ready) { $child.Kill(); throw 'VPS tunnel did not become ready.' }
}
Write-Output 'VPS admin: http://127.0.0.1:3102/admin.html'
if ($Open) { Start-Process 'http://127.0.0.1:3102/admin.html' }
