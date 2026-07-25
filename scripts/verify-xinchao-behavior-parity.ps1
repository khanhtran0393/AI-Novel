param(
  [string]$ReferenceRoot = "D:\repo\XinChao-Cut-main",
  [string]$PackagedRoot = "",
  [string]$PackRoot = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$evidenceDir = Join-Path $repoRoot "scratch\xinchao-parity"
New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null

if (-not $PackagedRoot) {
  $PackagedRoot = Join-Path $repoRoot "dist-xinchao-parity-qa\win-unpacked\resources\tools\xinchao-cut"
}
$ReferenceRoot = (Resolve-Path -LiteralPath $ReferenceRoot).Path
$PackagedRoot = (Resolve-Path -LiteralPath $PackagedRoot).Path

if (-not $PackRoot) {
  $packEvidencePath = Join-Path $evidenceDir "real-media-pack.json"
  if (-not (Test-Path -LiteralPath $packEvidencePath -PathType Leaf)) {
    throw "Missing real-media evidence. Run: npx tsx scripts/prepare-xinchao-real-media-parity.mts"
  }
  $PackRoot = (
    Get-Content -Raw -Encoding utf8 -LiteralPath $packEvidencePath |
      ConvertFrom-Json
  ).packRoot
}
$PackRoot = (Resolve-Path -LiteralPath $PackRoot).Path

$realMediaEvidence = Get-Content -Raw -Encoding utf8 -LiteralPath (Join-Path $evidenceDir "real-media-pack.json") |
  ConvertFrom-Json
$realVideo = Join-Path $repoRoot $realMediaEvidence.sourceMedia.video.path
$pythonExe = Join-Path $env:LOCALAPPDATA "XinChao-Cut\venv\Scripts\python.exe"
$packagedExe = Join-Path $PackagedRoot "XinChao-Cut.exe"
$referenceDist = Join-Path $ReferenceRoot "dist"
$packagedDist = Join-Path $PackagedRoot "dist"

foreach ($required in @(
  $pythonExe,
  $packagedExe,
  (Join-Path $ReferenceRoot "backend\app\main.py"),
  (Join-Path $referenceDist "index.html"),
  (Join-Path $packagedDist "index.html"),
  (Join-Path $PackRoot "ainovel-xinchao-pack.json"),
  $realVideo
)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Required parity input is missing: $required"
  }
}

$runtimeFiles = @(
  (Join-Path $repoRoot "main.js"),
  (Join-Path $repoRoot "electron\xinchaoRuntimeHost.cjs"),
  (Join-Path $repoRoot "src\app\workspace\features\project\CapCutExportButton.tsx"),
  (Join-Path $repoRoot "src\app\workspace\hooks\useCapCutExport.ts"),
  (Join-Path $repoRoot "src\app\workspace\modules\capCutModule.ts")
)
$runtimeText = ($runtimeFiles | ForEach-Object {
  Get-Content -Raw -LiteralPath $_
}) -join "`n"
foreach ($forbidden in @(
  "AINOVEL_XINCHAO_DIR",
  "payload?.xinchaoRoot",
  "D:\repo\XinChao-Cut-main"
)) {
  if ($runtimeText.IndexOf($forbidden, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
    throw "Runtime seam contains forbidden external-root token: $forbidden"
  }
}

$packagedItem = Get-Item -LiteralPath $PackagedRoot
if ($packagedItem.LinkType) {
  throw "Packaged runtime root must not be a link/junction: $PackagedRoot"
}
$nativeBytes = [System.IO.File]::ReadAllBytes($packagedExe)
if ($nativeBytes.Length -le 1MB -or $nativeBytes[0] -ne 0x4D -or $nativeBytes[1] -ne 0x5A) {
  throw "Packaged native runtime is not a valid PE executable: $packagedExe"
}

function Get-DistMap([string]$Root) {
  $map = @{}
  Get-ChildItem -LiteralPath $Root -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($Root.Length).TrimStart("\")
    $map[$relative] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
  }
  return $map
}

$referenceDistMap = Get-DistMap $referenceDist
$packagedDistMap = Get-DistMap $packagedDist
$distKeys = @($referenceDistMap.Keys + $packagedDistMap.Keys | Sort-Object -Unique)
$distDifferences = @($distKeys | Where-Object {
  $referenceDistMap[$_] -ne $packagedDistMap[$_]
})
$compiledBridgeFound = $false
Get-ChildItem -LiteralPath $packagedDist -Recurse -File -Filter "*.js" | ForEach-Object {
  if ((Get-Content -LiteralPath $_.FullName -Raw).Contains("take_ainovel_pack")) {
    $compiledBridgeFound = $true
  }
}
if (-not $compiledBridgeFound) {
  throw "Packaged frontend is missing the compiled AI Novel pack bridge"
}

$vendorOutput = & node (Join-Path $repoRoot "scripts\verify-xinchao-vendor.mjs")
if ($LASTEXITCODE -ne 0) {
  throw "Vendored source parity verification failed"
}
$vendorSummaryLine = @($vendorOutput | Where-Object { $_ -like "{*" })[0]
$vendorSummary = $vendorSummaryLine | ConvertFrom-Json
if (-not $vendorSummary.ok -or $vendorSummary.unexpectedDrift -ne 0) {
  throw "Vendored source contains unexpected drift"
}

function Get-Contract($OpenApi) {
  $operations = [System.Collections.Generic.List[string]]::new()
  foreach ($pathProperty in $OpenApi.paths.PSObject.Properties) {
    foreach ($methodProperty in $pathProperty.Value.PSObject.Properties) {
      if ($methodProperty.Name -in @("get", "post", "put", "patch", "delete")) {
        $operations.Add("$($methodProperty.Name.ToUpperInvariant()) $($pathProperty.Name)")
      }
    }
  }
  $schemas = @($OpenApi.components.schemas.PSObject.Properties.Name | Sort-Object)
  return [pscustomobject]@{
    operations = @($operations | Sort-Object)
    schemas = $schemas
  }
}

function Invoke-RealMediaProbe([string]$SourcePath) {
  $output = & curl.exe -sS --fail-with-body -X POST `
    -F "sourcePath=$SourcePath" `
    "http://127.0.0.1:8000/media/probe"
  if ($LASTEXITCODE -ne 0) {
    throw "Real media probe failed: $output"
  }
  return ($output | ConvertFrom-Json)
}

function Wait-Health([System.Diagnostics.Process]$Process, [datetime]$Deadline) {
  $health = $null
  do {
    Start-Sleep -Milliseconds 400
    $Process.Refresh()
    if ($Process.HasExited) {
      throw "Runtime exited during startup (exit=$($Process.ExitCode))"
    }
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:8000/health" -TimeoutSec 2
    } catch {
      $health = $null
    }
  } while (-not $health -and (Get-Date) -lt $Deadline)
  if (-not $health) {
    throw "Runtime health timeout"
  }
  return $health
}

function Wait-PortFree([int]$Port, [datetime]$Deadline) {
  while (
    (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) -and
    (Get-Date) -lt $Deadline
  ) {
    Start-Sleep -Milliseconds 250
  }
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $Port did not become free before the deadline"
  }
}

function Capture-ReferenceBackend {
  if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) {
    throw "Port 8000 is occupied before reference capture"
  }
  $stdout = Join-Path $evidenceDir "reference-backend.stdout.log"
  $stderr = Join-Path $evidenceDir "reference-backend.stderr.log"
  $oldNoBytecode = $env:PYTHONDONTWRITEBYTECODE
  $env:PYTHONDONTWRITEBYTECODE = "1"
  $process = $null
  try {
    $process = Start-Process -FilePath $pythonExe `
      -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000") `
      -WorkingDirectory (Join-Path $ReferenceRoot "backend") `
      -RedirectStandardOutput $stdout `
      -RedirectStandardError $stderr `
      -WindowStyle Hidden `
      -PassThru
    $health = Wait-Health $process (Get-Date).AddSeconds(30)
    $openApi = Invoke-RestMethod "http://127.0.0.1:8000/openapi.json" -TimeoutSec 10
    $probe = Invoke-RealMediaProbe $realVideo
    return [pscustomobject]@{
      pid = $process.Id
      health = $health
      contract = Get-Contract $openApi
      probe = $probe
    }
  } finally {
    if ($process -and -not $process.HasExited) {
      Stop-Process -Id $process.Id -Force
      $process.WaitForExit(5000)
    }
    $env:PYTHONDONTWRITEBYTECODE = $oldNoBytecode
  }
}

function Capture-PackagedRuntime {
  Wait-PortFree 8000 (Get-Date).AddSeconds(10)
  $startedAt = Get-Date
  $oldNoBytecode = $env:PYTHONDONTWRITEBYTECODE
  $env:PYTHONDONTWRITEBYTECODE = "1"
  $native = $null
  $backendPid = $null
  try {
    $native = Start-Process -FilePath $packagedExe `
      -ArgumentList @("--ainovel-pack", ('"{0}"' -f $PackRoot)) `
      -WorkingDirectory $PackagedRoot `
      -PassThru
    $health = Wait-Health $native (Get-Date).AddSeconds(30)
    $windowDeadline = (Get-Date).AddSeconds(15)
    do {
      Start-Sleep -Milliseconds 300
      $native.Refresh()
    } while ($native.MainWindowHandle -eq 0 -and (Get-Date) -lt $windowDeadline)
    if ($native.MainWindowHandle -eq 0 -or -not $native.Responding) {
      throw "Packaged native window did not become responsive"
    }

    $listener = Get-NetTCPConnection -LocalPort 8000 -State Listen
    $backendPid = $listener.OwningProcess
    $backend = Get-CimInstance Win32_Process -Filter "ProcessId=$backendPid"
    if (
      $backend.CreationDate -lt $startedAt -or
      $backend.Name -ne "python.exe" -or
      $backend.CommandLine -notmatch "uvicorn app\.main:app.+127\.0\.0\.1.+8000"
    ) {
      throw "Port 8000 is not owned by the packaged XinChao-Cut runtime"
    }

    $openApi = Invoke-RestMethod "http://127.0.0.1:8000/openapi.json" -TimeoutSec 10
    $probe = Invoke-RealMediaProbe $realVideo
    $receiptPath = Join-Path $PackRoot "ainovel-xinchao-import-receipt.json"
    $receiptDeadline = (Get-Date).AddSeconds(45)
    while (-not (Test-Path -LiteralPath $receiptPath) -and (Get-Date) -lt $receiptDeadline) {
      Start-Sleep -Milliseconds 250
    }
    if (-not (Test-Path -LiteralPath $receiptPath)) {
      throw "Packaged runtime did not persist the AI Novel project/timeline receipt"
    }
    $receipt = Get-Content -LiteralPath $receiptPath -Raw -Encoding utf8 | ConvertFrom-Json
    if (
      $receipt.source -ne "xinchao-cut-runtime" -or
      $receipt.mediaCount -le 0 -or
      $receipt.clipCount -ne $receipt.mediaCount
    ) {
      throw "Packaged runtime import receipt is invalid"
    }
    return [pscustomobject]@{
      pid = $native.Id
      windowTitle = $native.MainWindowTitle
      responding = $native.Responding
      backendPid = $backendPid
      health = $health
      contract = Get-Contract $openApi
      probe = $probe
      receipt = $receipt
    }
  } finally {
    if ($native -and -not $native.HasExited) {
      [void]$native.CloseMainWindow()
      if (-not $native.WaitForExit(10000)) {
        Stop-Process -Id $native.Id -Force
      }
    }
    $listener = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
    if ($listener -and $backendPid -and $listener.OwningProcess -eq $backendPid) {
      $backend = Get-CimInstance Win32_Process -Filter "ProcessId=$backendPid"
      if (
        $backend.CreationDate -ge $startedAt -and
        $backend.Name -eq "python.exe" -and
        $backend.CommandLine -match "uvicorn app\.main:app.+127\.0\.0\.1.+8000"
      ) {
        Stop-Process -Id $backendPid -Force
      }
    }
    $env:PYTHONDONTWRITEBYTECODE = $oldNoBytecode
  }
}

$reference = Capture-ReferenceBackend
$packaged = Capture-PackagedRuntime

$operationDiff = @(Compare-Object $reference.contract.operations $packaged.contract.operations)
$schemaDiff = @(Compare-Object $reference.contract.schemas $packaged.contract.schemas)
if ($operationDiff.Count -gt 0 -or $schemaDiff.Count -gt 0) {
  throw "Backend OpenAPI parity failed (operations=$($operationDiff.Count), schemas=$($schemaDiff.Count))"
}

foreach ($field in @("status", "service", "version")) {
  if ($reference.health.$field -ne $packaged.health.$field) {
    throw "Health parity failed for $field"
  }
}
foreach ($capability in $reference.health.capabilities.PSObject.Properties.Name) {
  if ($reference.health.capabilities.$capability -ne $packaged.health.capabilities.$capability) {
    throw "Capability parity failed for $capability"
  }
}

$referenceProbeJson = $reference.probe | ConvertTo-Json -Depth 20 -Compress
$packagedProbeJson = $packaged.probe | ConvertTo-Json -Depth 20 -Compress
if ($referenceProbeJson -ne $packagedProbeJson) {
  throw "Real-media probe differs between reference and packaged runtime"
}

$uiComponentCount = @(
  Get-ChildItem (Join-Path $ReferenceRoot "src\components") -Recurse -File -Filter "*.tsx"
).Count
$engineModuleCount = @(
  Get-ChildItem (Join-Path $ReferenceRoot "src\engine") -Recurse -File -Include "*.ts", "*.tsx"
).Count
$frontendTestCount = @(
  Get-ChildItem (Join-Path $ReferenceRoot "src") -Recurse -File |
    Where-Object { $_.Name -match "\.test\.(ts|tsx)$" }
).Count

$summary = [ordered]@{
  ok = $true
  runtimeRoot = $PackagedRoot
  runtimeIsLink = [bool]$packagedItem.LinkType
  rendererExternalRootRejected = $true
  realMedia = [ordered]@{
    video = $realMediaEvidence.sourceMedia.video.path
    packRoot = $PackRoot
    probeExactMatch = $true
    copiedHashesExact = $true
  }
  frontend = [ordered]@{
    distFiles = $distKeys.Count
    referenceBuildHashDifferences = $distDifferences.Count
    compiledBridgeFound = $compiledBridgeFound
    upstreamExactSourceFiles = $vendorSummary.upstreamExactFiles
    intentionalChanged = $vendorSummary.intentionalChanged
    intentionalAdded = $vendorSummary.intentionalAdded
    unexpectedSourceDrift = $vendorSummary.unexpectedDrift
    uiComponents = $uiComponentCount
    engineModules = $engineModuleCount
    testFiles = $frontendTestCount
  }
  backend = [ordered]@{
    version = $packaged.health.version
    operations = $packaged.contract.operations.Count
    schemas = $packaged.contract.schemas.Count
    openApiDifferences = $operationDiff.Count + $schemaDiff.Count
    capabilities = $packaged.health.capabilities
  }
  native = [ordered]@{
    exe = $packagedExe
    bytes = (Get-Item -LiteralPath $packagedExe).Length
    windowTitle = $packaged.windowTitle
    responding = $packaged.responding
    backendPid = $packaged.backendPid
    importedProjectId = $packaged.receipt.projectId
    importedMedia = $packaged.receipt.mediaCount
    importedClips = $packaged.receipt.clipCount
  }
}

$summaryPath = Join-Path $evidenceDir "behavior-parity.json"
$summary | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $summaryPath -Encoding utf8
$summary | ConvertTo-Json -Depth 20 -Compress
Write-Output "PARITY_OK xinchao-reference-vs-packaged-real-media"
