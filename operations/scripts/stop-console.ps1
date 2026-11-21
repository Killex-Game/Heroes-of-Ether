param([int]$GameProcessId)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GameConsoleControl {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint id);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint type, uint group);
}
'@
[GameConsoleControl]::FreeConsole() | Out-Null
if (![GameConsoleControl]::AttachConsole([uint32]$GameProcessId)) { exit 2 }
[GameConsoleControl]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null
if (![GameConsoleControl]::GenerateConsoleCtrlEvent(0, 0)) { exit 3 }
Start-Sleep -Milliseconds 500
[GameConsoleControl]::FreeConsole() | Out-Null
