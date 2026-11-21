$ErrorActionPreference = 'Stop'
$sourceRoot = 'C:\Users\semen\.codex\generated_images\01a14abe-e850-7ca1-be9b-f32a856dbaba'
$targetRoot = 'C:\Users\semen\Documents\ChatGPT\Прессеты'
$null = New-Item -ItemType Directory -Path $targetRoot -Force
$images = @(Get-ChildItem -LiteralPath $sourceRoot -File -Recurse | Where-Object { $_.Extension -in '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif' })
$copied = 0
$records = foreach ($file in $images) {
  $sourceHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
  $targetFile = Join-Path $targetRoot $file.Name
  if ((Test-Path -LiteralPath $targetFile) -and (Get-FileHash -LiteralPath $targetFile -Algorithm SHA256).Hash -ne $sourceHash) {
    $targetFile = Join-Path $targetRoot ($file.BaseName + '-' + $sourceHash.Substring(0, 12).ToLowerInvariant() + $file.Extension)
  }
  if (-not (Test-Path -LiteralPath $targetFile)) {
    Copy-Item -LiteralPath $file.FullName -Destination $targetFile
    $copied++
  }
  $targetHash = (Get-FileHash -LiteralPath $targetFile -Algorithm SHA256).Hash
  if ($targetHash -ne $sourceHash) { throw ('Copy verification failed: ' + $file.Name) }
  [pscustomobject]@{ File = [IO.Path]::GetFileName($targetFile); Source = $file.FullName; Bytes = $file.Length; SHA256 = $sourceHash }
}
$records | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $targetRoot 'images-manifest.json') -Encoding utf8
[pscustomobject]@{ Images = $images.Count; Copied = $copied; Verified = @($records).Count; Destination = $targetRoot } | ConvertTo-Json
