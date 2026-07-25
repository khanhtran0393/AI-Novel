param(
  [string]$EditorRoot = "",
  [string]$EvidencePath = "",
  [int]$TimeoutSeconds = 75
)

$ErrorActionPreference = "Stop"
$appRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
if (-not $EditorRoot) {
  $EditorRoot = Join-Path $appRoot "tools\xinchao-cut"
}
if (-not $EvidencePath) {
  $EvidencePath = Join-Path $appRoot "scratch\xinchao-parity\real-media-pack.json"
}

$resolvedEditor = (Resolve-Path -LiteralPath $EditorRoot).Path
$exe = (Resolve-Path -LiteralPath (Join-Path $resolvedEditor "XinChao-Cut.exe")).Path
$evidence = Get-Content -LiteralPath $EvidencePath -Raw -Encoding UTF8 | ConvertFrom-Json
$packRoot = (Resolve-Path -LiteralPath ([string]$evidence.packRoot)).Path
$receiptPath = Join-Path $packRoot "ainovel-xinchao-import-receipt.json"
if (Test-Path -LiteralPath $receiptPath) {
  throw "Pack already has an import receipt; use a freshly prepared real-media pack: $receiptPath"
}

$existing = Get-Process -Name "XinChao-Cut" -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -eq $exe } |
  Select-Object -First 1
$launched = Start-Process `
  -FilePath $exe `
  -ArgumentList @("--ainovel-pack", ('"{0}"' -f $packRoot)) `
  -WorkingDirectory $resolvedEditor `
  -PassThru
$runtimeProcess = if ($existing) { $existing } else { $launched }

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while (-not (Test-Path -LiteralPath $receiptPath) -and (Get-Date) -lt $deadline) {
  if ($runtimeProcess.HasExited) {
    throw "XinChao-Cut exited before importing the pack (exit=$($runtimeProcess.ExitCode))"
  }
  Start-Sleep -Milliseconds 250
  $runtimeProcess.Refresh()
}
if (-not (Test-Path -LiteralPath $receiptPath)) {
  throw "Timed out waiting for runtime import receipt: $receiptPath"
}

$receipt = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
$runtimeProcess.Refresh()
$hashRows = @(
  $receipt.media | ForEach-Object {
    $item = $_
    $mediaPath = [string]$item.path
    if ($mediaPath.StartsWith("\\?\")) {
      $mediaPath = $mediaPath.Substring(4)
    }
    $mediaPath = [System.IO.Path]::GetFullPath($mediaPath)
    if (-not (Test-Path -LiteralPath $mediaPath -PathType Leaf)) {
      throw "Runtime receipt media does not exist: $mediaPath"
    }
    if (-not $mediaPath.StartsWith($packRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Runtime receipt points outside the prepared pack: $mediaPath"
    }
    $actual = (Get-FileHash -LiteralPath $mediaPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $expected = @($evidence.copied | Where-Object { $_.key -eq $item.key })[0]
    [pscustomobject]@{
      key = $item.key
      kind = $item.kind
      bytes = (Get-Item -LiteralPath $mediaPath).Length
      sha256 = $actual
      expectedSha256 = $expected.sha256
      exact = $actual -eq $expected.sha256
    }
  }
)

$result = [pscustomobject]@{
  ok = (
    $receipt.source -eq "xinchao-cut-runtime" -and
    $receipt.mediaCount -eq $evidence.copied.Count -and
    $receipt.clipCount -eq $evidence.copied.Count -and
    @($hashRows | Where-Object { -not $_.exact }).Count -eq 0
  )
  exe = $exe
  launchMode = if ($existing) { "single-instance-forward" } else { "fresh-process" }
  pid = $runtimeProcess.Id
  windowTitle = $runtimeProcess.MainWindowTitle
  responding = $runtimeProcess.Responding
  packRoot = $packRoot
  receiptPath = $receiptPath
  projectId = $receipt.projectId
  projectName = $receipt.projectName
  aspect = $receipt.aspect
  mediaCount = $receipt.mediaCount
  clipCount = $receipt.clipCount
  media = $hashRows
}

$result | ConvertTo-Json -Depth 8
if (-not $result.ok) {
  throw "Runtime receipt or media hashes did not match the real prepared pack"
}
Write-Output "RUNTIME_OK xinchao-auto-import-real-project-media"
