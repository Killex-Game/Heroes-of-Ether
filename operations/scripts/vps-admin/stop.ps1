$ErrorActionPreference = 'Stop'
$listeners = @(Get-NetTCPConnection -LocalPort 3102 -State Listen -ErrorAction SilentlyContinue)
foreach ($listener in $listeners) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    if ($listener.LocalAddress -ne '127.0.0.1' -or $proc.Name -ne 'ssh.exe' -or
        $proc.CommandLine -notlike '*heroether-admin-tunnel@195.208.123.221*' -or
        ($proc.CommandLine -notlike '*127.0.0.1:3102:127.0.0.1:3000*' -and $proc.CommandLine -notlike '*127.0.0.1:3102:127.0.0.1:3103*')) {
        throw 'Port 3102 belongs to another program. No process was stopped.'
    }
    Stop-Process -Id $listener.OwningProcess
}
# Some Windows network providers do not enumerate forwarded listeners.
$ssh=Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" | Where-Object {
    $_.ExecutablePath -eq $ssh -and $_.CommandLine -like '*heroether-admin-tunnel@195.208.123.221*' -and
    ($_.CommandLine -like '*127.0.0.1:3102:127.0.0.1:3103*' -or $_.CommandLine -like '*127.0.0.1:3102:127.0.0.1:3000*')
} | ForEach-Object { Stop-Process -Id $_.ProcessId }
Write-Output 'VPS admin tunnel closed. The VPS game continues running.'
