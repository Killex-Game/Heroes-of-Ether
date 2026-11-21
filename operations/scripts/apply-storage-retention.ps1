param(
  [Parameter(Mandatory=$true)][string]$Plan,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')).TrimEnd('\')
$allowedRoots = @(
  'backups', 'artifacts',
  'games/heroes-of-ether/backups',
  'games/heroes-of-ether/data/backups',
  'games/heroes-of-ether/data/recovery-backups',
  'games/heroes-of-ether/artifacts'
)
function Assert-InWorkspace([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  if (!$full.StartsWith($workspace + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Path outside workspace: $full"
  }
  $cursor = $full
  while ($cursor -and $cursor -ne $workspace) {
    $item = Get-Item -LiteralPath $cursor -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Link rejected: $cursor" }
    $cursor = Split-Path -Parent $cursor
  }
  return $full
}
$planPath = Assert-InWorkspace ([IO.Path]::GetFullPath($Plan))
$document = Get-Content -LiteralPath $planPath -Raw -Encoding utf8 | ConvertFrom-Json
$cutoff = if ($document.createdAt -is [DateTime]) {
  $document.createdAt.ToUniversalTime()
} else {
  [DateTimeOffset]::Parse($document.createdAt, [Globalization.CultureInfo]::InvariantCulture).UtcDateTime
}
$targets = @($document.decisions | Where-Object action -eq 'delete')
$keepers = @($document.decisions | Where-Object action -eq 'keep')
$resolved = @()
$seen = @{}
foreach ($entry in $targets) {
  if ($allowedRoots -notcontains $entry.root) { throw "Unapproved storage: $($entry.root)" }
  $root = Assert-InWorkspace (Join-Path $workspace $entry.root)
  $target = Assert-InWorkspace (Join-Path $workspace $entry.path)
  if ((Split-Path -Parent $target) -ne $root) { throw "Only direct storage children allowed: $target" }
  if ($seen.ContainsKey($target)) { throw "Duplicate target: $target" }
  $seen[$target] = $true
  if ($planPath.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Plan cannot delete itself' }
  foreach ($keep in $keepers) {
    $keepPath = [IO.Path]::GetFullPath((Join-Path $workspace $keep.path))
    if ($keepPath -eq $target -or $keepPath.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) {
      throw "Protected target: $target"
    }
  }
  $resolved += [pscustomobject]@{ path=$target; relative=$entry.path; root=$entry.root }
}
# Inspect every tree before any deletion. Never follow junctions or symbolic links.
if (-not ('RetentionTree' -as [type])) {
  Add-Type @'
using System;
using System.IO;
using System.Collections.Generic;
public static class RetentionTree {
  public static long[] Inspect(string path, DateTime cutoff) {
    var pending = new Stack<FileSystemInfo>();
    pending.Push(Directory.Exists(path) ? (FileSystemInfo)new DirectoryInfo(path) : new FileInfo(path));
    long bytes = 0, files = 0;
    while (pending.Count != 0) {
      var item = pending.Pop();
      if ((item.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Link rejected: " + item.FullName);
      if (item.LastWriteTimeUtc > cutoff) throw new IOException("Changed after plan: " + item.FullName);
      var dir = item as DirectoryInfo;
      if (dir != null) {
        foreach (var child in dir.EnumerateFileSystemInfos()) pending.Push(child);
      } else { bytes += ((FileInfo)item).Length; files++; }
    }
    return new long[] { bytes, files };
  }
}
'@
}
$verified = @()
foreach ($entry in $resolved) {
  $sizes = [RetentionTree]::Inspect($entry.path, $cutoff)
  [long]$bytes = $sizes[0]
  [long]$files = $sizes[1]
  $verified += [pscustomobject]@{ path=$entry.path; relative=$entry.relative; root=$entry.root; bytes=$bytes; files=$files }
}
$total = ($verified | Measure-Object -Property bytes -Sum).Sum
Write-Output ("Verified {0} targets, {1:N2} GiB. Apply={2}" -f $verified.Count, ($total/1GB), $Apply)
if (!$Apply) { return }
$reportDir = Split-Path -Parent $planPath
$logPath = Join-Path $reportDir 'deleted.ndjson'
if (Test-Path -LiteralPath $logPath) { throw 'Deletion log already exists; create a fresh reviewed plan' }
$completed = 0
foreach ($entry in $verified) {
  $checked = Assert-InWorkspace $entry.path
  Remove-Item -LiteralPath $checked -Recurse -Force
  if (Test-Path -LiteralPath $checked) { throw "Deletion incomplete: $checked" }
  [pscustomobject]@{ path=$entry.relative; bytes=$entry.bytes; files=$entry.files; at=[DateTimeOffset]::UtcNow.ToString('o') } |
    ConvertTo-Json -Compress | Add-Content -LiteralPath $logPath -Encoding utf8
  $completed++
  if ($completed % 50 -eq 0) { Write-Output "Removed $completed / $($verified.Count) storage entries" }
}
[pscustomobject]@{
  completedAt=[DateTimeOffset]::UtcNow.ToString('o'); deletedEntries=$completed;
  deletedBytes=$total; deletedFiles=($verified | Measure-Object -Property files -Sum).Sum;
  retained=$keepers.path
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $reportDir 'cleanup-result.json') -Encoding utf8
Write-Output 'Cleanup completed.'
