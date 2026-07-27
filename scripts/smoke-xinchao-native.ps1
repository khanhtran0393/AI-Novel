param(
  [string]$PackRoot = "",
  [string]$EditorRoot = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$editorRoot = if ($EditorRoot) {
  (Resolve-Path -LiteralPath $EditorRoot).Path
} else {
  Join-Path $repoRoot "tools\xinchao-cut"
}
$nativeExe = Join-Path $editorRoot "XinChao-Cut.exe"
$testStartedAt = Get-Date

if (-not (Test-Path -LiteralPath $nativeExe -PathType Leaf)) {
  throw "Missing native runtime: $nativeExe"
}
if ((Get-Item -LiteralPath $nativeExe).Length -le 1000000) {
  throw "Native runtime is unexpectedly small: $nativeExe"
}
if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) {
  throw "Port 8000 is already occupied; native smoke will not disturb that process."
}

if (-not $PackRoot) {
  $latestPack = Get-ChildItem (Join-Path $repoRoot "exports\integrations\xinchao-cut") `
    -Directory -ErrorAction Stop |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $latestPack) {
    throw "No XinChao-Cut pack exists. Run npm run smoke:xinchao first."
  }
  $PackRoot = $latestPack.FullName
}
$PackRoot = (Resolve-Path -LiteralPath $PackRoot).Path
$manifestPath = Join-Path $PackRoot "ainovel-xinchao-pack.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Pack manifest is missing: $manifestPath"
}

$native = $null
$backendPid = $null
try {
  $native = Start-Process -FilePath $nativeExe `
    -ArgumentList @("--ainovel-pack", "`"$PackRoot`"") `
    -WorkingDirectory $editorRoot `
    -PassThru

  $deadline = (Get-Date).AddSeconds(30)
  $health = $null
  do {
    Start-Sleep -Milliseconds 500
    $native.Refresh()
    if ($native.HasExited) {
      throw "XinChao-Cut exited during native startup (exit $($native.ExitCode))."
    }
    if ($native.MainWindowHandle -ne 0) {
      try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 2
      } catch {
        $health = $null
      }
    }
  } while (
    ($native.MainWindowHandle -eq 0 -or -not $health) -and
    (Get-Date) -lt $deadline
  )

  if ($native.MainWindowHandle -eq 0) {
    throw "XinChao-Cut native window did not appear."
  }
  if (-not $health -or $health.status -ne "ok") {
    throw "XinChao-Cut backend did not reach status=ok."
  }
  $receiptPath = Join-Path $PackRoot "ainovel-xinchao-import-receipt.json"
  $receiptDeadline = (Get-Date).AddSeconds(30)
  while (
    -not (Test-Path -LiteralPath $receiptPath -PathType Leaf) -and
    (Get-Date) -lt $receiptDeadline
  ) {
    Start-Sleep -Milliseconds 250
    $native.Refresh()
    if ($native.HasExited) {
      throw "XinChao-Cut exited before writing the import receipt."
    }
  }
  if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) {
    throw "XinChao-Cut did not write the real-media import receipt: $receiptPath"
  }
  $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  if ($receipt.mediaCount -le 0 -or $receipt.clipCount -le 0) {
    throw "XinChao-Cut receipt has invalid media/clip counts."
  }
  if (($receipt.replacedCount + $receipt.insertedCount) -ne $receipt.clipCount) {
    throw "XinChao-Cut receipt does not account for all reservation upserts."
  }
  if ($receipt.verifiedSlotCount -ne $receipt.clipCount) {
    throw "XinChao-Cut did not persist exact start/duration for every reservation slot."
  }

  $listener = Get-NetTCPConnection -LocalPort 8000 -State Listen
  $backendPid = $listener.OwningProcess
  $backend = Get-CimInstance Win32_Process -Filter "ProcessId=$backendPid"
  if (
    $backend.Name -ne "python.exe" -or
    $backend.CommandLine -notmatch "uvicorn app\.main:app.+127\.0\.0\.1.+8000"
  ) {
    throw "Port 8000 is not owned by the XinChao-Cut backend."
  }

  [pscustomobject]@{
    ok = $true
    nativePid = $native.Id
    windowTitle = $native.MainWindowTitle
    responding = $native.Responding
    backendPid = $backendPid
    backendStatus = $health.status
    version = $health.version
    export = $health.capabilities.export
    packRoot = $PackRoot
    receiptPath = $receiptPath
    projectId = $receipt.projectId
    mediaCount = $receipt.mediaCount
    clipCount = $receipt.clipCount
    replacedCount = $receipt.replacedCount
    insertedCount = $receipt.insertedCount
    verifiedSlotCount = $receipt.verifiedSlotCount
  } | ConvertTo-Json -Compress
  Write-Output "SMOKE_OK xinchao-native-desktop"
} finally {
  if ($native -and -not $native.HasExited) {
    $native.Refresh()
    if ($native.Path -eq $nativeExe) {
      [void]$native.CloseMainWindow()
      if (-not $native.WaitForExit(10000)) {
        Stop-Process -Id $native.Id -Force
      }
    }
  }

  $listener = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
  if ($listener) {
    $backend = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    if (
      $backend.CreationDate -ge $testStartedAt -and
      $backend.Name -eq "python.exe" -and
      $backend.CommandLine -match "uvicorn app\.main:app.+127\.0\.0\.1.+8000"
    ) {
      Stop-Process -Id $listener.OwningProcess -Force
    }
  }
}
