param([Parameter(Mandatory=$true)][string]$ArchivePath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$publicRoot=Join-Path $projectRoot 'public/assets/progression'
$designRoot=Join-Path $projectRoot 'design/progression-assets-v1'
$archive=[IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ArchivePath).Path)
$count=0
try {
  foreach($entry in $archive.Entries) {
    $relative=$entry.FullName -replace '^sferorumiya-progression-assets-v1/',''
    if ($relative -match '/warhead_cake\.webp$') {continue} # Ошибочная картинка, исключена владельцем.
    $root=$null
    if ($relative -match '^webp/(64|128|256)/(achievements|boosters|leagues|league_medals|rank_chests|rank_trophies)/[a-z_]+\.webp$') {$root=$publicRoot}
    elseif ($relative -match '^(assets|manifest_boosters_achievements|manifest_leagues|manifest_ranks)\.json$|^overview_(boosters|achievements|leagues|ranks)\.png$') {$root=$designRoot}
    if (!$root) {continue}
    $target=[IO.Path]::GetFullPath((Join-Path $root $relative))
    if (!$target.StartsWith([IO.Path]::GetFullPath($root)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {throw 'Unsafe archive path'}
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$true)
    $count++
  }
} finally {$archive.Dispose()}
Write-Output "Imported $count files. Original artwork is unchanged; runtime uses supplied lossless WebP."
