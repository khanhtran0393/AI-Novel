# Smoke Free/enforce on electron-builder win-unpacked (unsigned QA).
param(
  [string]$UnpackedDir = "dist-qa-unsigned\win-unpacked",
  [int]$Port = 32400,
  [string]$PaidProToken = '',
  [string]$PaidProLicenseId = ''
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$unpacked = Join-Path $root $UnpackedDir
$exe = Join-Path $unpacked 'Ai Novel.exe'
if (-not (Test-Path -LiteralPath $exe)) {
  $exe = Join-Path $unpacked 'AI Novel & Script Generator.exe'
}
if (-not (Test-Path -LiteralPath $exe)) {
  throw "Missing unpacked exe: $exe"
}

$profileDir = Join-Path ([IO.Path]::GetTempPath()) ("ainovel-unpacked-smoke-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $profileDir | Out-Null

# Public customer commercial defaults only
$commercialDir = Join-Path $profileDir 'ai-novel-script-generator'
# Electron userData path override via --user-data-dir
$env:AI_NOVEL_PORT = [string]$Port
$env:AINOVEL_UPDATE_CHECK_ON_LAUNCH = '0'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

$app = $null
try {
  $app = Start-Process -FilePath $exe -ArgumentList "--user-data-dir=`"$profileDir`"" -PassThru -WindowStyle Hidden
  $base = "http://127.0.0.1:$Port"
  $health = $null
  $last = $null
  for ($i = 0; $i -lt 90; $i++) {
    try {
      $health = Invoke-RestMethod -Uri "$base/api/health/runtime" -TimeoutSec 3
      break
    } catch {
      $last = $_.Exception.Message
      Start-Sleep -Seconds 2
    }
  }
  if ($null -eq $health) { throw "Health timeout: $last" }

  $commercial = Invoke-RestMethod -Uri "$base/api/commercial/status" -TimeoutSec 15
  if ($commercial.entitlement.mode -ne 'enforce') {
    throw "Expected enforce mode, got $($commercial.entitlement.mode)"
  }
  if ($commercial.tier -ne 'free') {
    throw "Fresh install expected free, got $($commercial.tier)"
  }

  $status = 0
  try {
    $null = Invoke-WebRequest -Method POST -Uri "$base/api/generate-video" -ContentType 'application/json' -Body '{}' -UseBasicParsing -TimeoutSec 20
    $status = 200
  } catch {
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    else { throw }
  }
  if ($status -ne 403) {
    throw "Free must 403 video route, got HTTP $status"
  }

  $paidProChecked = $false
  $paidProCloudHeartbeat = $false
  if (-not [string]::IsNullOrWhiteSpace($PaidProToken)) {
    if ([string]::IsNullOrWhiteSpace($PaidProLicenseId)) {
      throw 'PaidProLicenseId is required with PaidProToken for cloud-authority smoke'
    }
    $activationBody = @{
      token = $PaidProToken
      hwid = [string]$commercial.hwid
    } | ConvertTo-Json -Compress
    $activated = Invoke-RestMethod `
      -Method POST `
      -Uri "$base/api/entitlement/activate" `
      -ContentType 'application/json' `
      -Body $activationBody `
      -TimeoutSec 30
    if (
      $activated.ok -ne $true -or
      $activated.claims.plan -ne 'pro' -or
      $activated.claims.is_pro -ne $true -or
      $activated.claims.is_trial -eq $true
    ) {
      throw 'Paid Pro activation did not return non-Trial Pro claims'
    }
    $headers = @{ 'x-ainovel-entitlement' = $PaidProToken }
    $proStatus = Invoke-RestMethod -Uri "$base/api/commercial/status" -Headers $headers -TimeoutSec 15
    if ($proStatus.tier -ne 'pro' -or $proStatus.claims.plan -ne 'pro') {
      throw 'Paid Pro token did not produce PRO commercial status'
    }
    $heartbeatBody = @{
      token = $PaidProToken
      hwid = [string]$commercial.hwid
    } | ConvertTo-Json -Compress
    $heartbeat = Invoke-RestMethod `
      -Method POST `
      -Uri "$base/api/cloud/license/verify" `
      -ContentType 'application/json' `
      -Body $heartbeatBody `
      -TimeoutSec 30
    if (
      $heartbeat.valid -ne $true -or
      $heartbeat.cloud.checked -ne $true -or
      $heartbeat.cloud.authority -ne 'supabase' -or
      [string]$heartbeat.cloud.licenseId -ne $PaidProLicenseId
    ) {
      throw 'Paid Pro cloud heartbeat did not confirm the exact Supabase row'
    }
    $paidProCloudHeartbeat = $true
    $proGateStatus = 0
    try {
      $null = Invoke-WebRequest -Method POST -Uri "$base/api/generate-video" -Headers $headers -ContentType 'application/json' -Body '{}' -UseBasicParsing -TimeoutSec 20
      $proGateStatus = 200
    } catch {
      if ($_.Exception.Response) { $proGateStatus = [int]$_.Exception.Response.StatusCode }
      else { throw }
    }
    if ($proGateStatus -eq 403) {
      throw 'Paid Pro token did not unlock the Pro video route'
    }
    $paidProChecked = $true
  }

  $visibleWindows = @(
    Get-Process | Where-Object {
      try {
        $_.Path -and
        $_.Path.StartsWith($unpacked, [StringComparison]::OrdinalIgnoreCase) -and
        $_.MainWindowHandle -ne 0
      } catch { $false }
    }
  ).Count
  if ($visibleWindows -lt 1) {
    throw 'Packaged app is healthy but did not create a visible desktop window.'
  }

  # Local Pro token for this machine HWID (seller keys from env if available)
  $hwid = [string]$commercial.entitlement.hwid
  if ([string]::IsNullOrWhiteSpace($hwid)) { $hwid = [string]$commercial.hwid }

  $result = [ordered]@{
    ok = $true
    health = $health.healthy
    mode = $commercial.entitlement.mode
    ready = $commercial.entitlement.readyForCommercial
    tier = $commercial.tier
    hwid = $hwid
    freeVideoGate = 403
    paidProChecked = $paidProChecked
    paidProCloudHeartbeat = $paidProCloudHeartbeat
    publicKeyConfigured = $commercial.entitlement.publicKeyConfigured
    visibleWindows = $visibleWindows
    unpacked = $unpacked
  }
  $result | ConvertTo-Json -Depth 4
  Write-Host 'PASS smoke-unpacked-desktop'
}
finally {
  if ($app -and -not $app.HasExited) {
    try { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  Get-Process | Where-Object {
    try { $_.Path -and $_.Path.StartsWith($unpacked, [StringComparison]::OrdinalIgnoreCase) } catch { $false }
  } | ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {} }
  Start-Sleep -Seconds 1
  try { Remove-Item -Recurse -Force $profileDir -ErrorAction SilentlyContinue } catch {}
}
