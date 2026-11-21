# Разрешает доступ к игре из локальной подсети; запуск от администратора.
$ErrorActionPreference = 'Stop'
$ruleName = 'Killex-Local-Players-3000'
$nodeProgram = (Get-Command node -ErrorAction Stop).Source
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $isAdmin) { throw 'Настройка брандмауэра требует запуска PowerShell от администратора.' }
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
New-Item -ItemType Directory -Path (Join-Path $projectRoot 'data') -Force | Out-Null
Start-Transcript -Path (Join-Path $projectRoot 'data/local-network-setup.log') -Append | Out-Null
$existingRule = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
if ($existingRule) {
    Set-NetFirewallRule -Name $ruleName -Enabled True -Direction Inbound -Action Allow -Profile Any
    $existingRule | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort 3000
    $existingRule | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress LocalSubnet
    $existingRule | Get-NetFirewallApplicationFilter | Set-NetFirewallApplicationFilter -Program $nodeProgram
} else {
    New-NetFirewallRule -Name $ruleName -DisplayName 'Герои Эфира — игроки в локальной сети' `
        -Direction Inbound -Action Allow -Enabled True -Profile Any `
        -Protocol TCP -LocalPort 3000 -RemoteAddress LocalSubnet -Program $nodeProgram | Out-Null
}
Write-Output 'Доступ к Сферорумии на TCP 3000 разрешён из локальной подсети.'
Stop-Transcript | Out-Null
