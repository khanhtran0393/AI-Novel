param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,
  [int]$Port = 32300,
  [switch]$SkipSignature,
  [switch]$SkipCloudTrial,
  [string]$PaidProToken = '',
  [string]$PaidProLicenseId = ''
)

$ErrorActionPreference = 'Stop'
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$publisher = [string]$env:WIN_CSC_PUBLISHER_NAME
$expectedThumbprint = ([string]$env:WIN_CSC_CERTIFICATE_SHA1 -replace '[^A-Fa-f0-9]', '').ToUpperInvariant()

function Assert-Authenticode([string]$Path) {
  if ($SkipSignature) { return }
  if ([string]::IsNullOrWhiteSpace($publisher)) {
    throw 'WIN_CSC_PUBLISHER_NAME is required'
  }
  if ($expectedThumbprint -notmatch '^[A-F0-9]{40}$') {
    throw 'WIN_CSC_CERTIFICATE_SHA1 must contain 40 hexadecimal characters'
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ([string]$signature.Status -ne 'Valid') {
    throw "Invalid Authenticode signature for ${Path}: $($signature.Status)"
  }
  $actualPublisher = $signature.SignerCertificate.GetNameInfo(
    [System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName,
    $false
  )
  if ($actualPublisher -cne $publisher) {
    throw "Publisher mismatch: expected '$publisher', got '$actualPublisher'"
  }
  $actualThumbprint = ([string]$signature.SignerCertificate.Thumbprint -replace '\s', '').ToUpperInvariant()
  if ($actualThumbprint -cne $expectedThumbprint) {
    throw "Certificate thumbprint mismatch: expected $expectedThumbprint, got $actualThumbprint"
  }
  if ($null -eq $signature.TimeStamperCertificate) {
    throw "Authenticode signature is not timestamped: $Path"
  }
}

function Invoke-JsonApi {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Uri,
    [object]$Body = $null,
    [hashtable]$Headers = @{}
  )
  $params = @{
    Method = $Method
    Uri = $Uri
    Headers = $Headers
    TimeoutSec = 30
    UseBasicParsing = $true
  }
  if ($null -ne $Body) {
    $params.ContentType = 'application/json'
    $params.Body = ($Body | ConvertTo-Json -Depth 8 -Compress)
  }
  $status = 0
  $content = ''
  try {
    $response = Invoke-WebRequest @params
    $status = [int]$response.StatusCode
    $content = [string]$response.Content
  } catch {
    $response = $_.Exception.Response
    if ($null -eq $response) { throw }
    $status = [int]$response.StatusCode
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      $content = [string]$_.ErrorDetails.Message
    } elseif ($response.Content) {
      $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    } else {
      $reader = New-Object IO.StreamReader($response.GetResponseStream())
      try { $content = $reader.ReadToEnd() } finally { $reader.Dispose() }
    }
  }
  $json = $null
  if (-not [string]::IsNullOrWhiteSpace($content)) {
    try { $json = $content | ConvertFrom-Json } catch { $json = $null }
  }
  return [pscustomobject]@{ Status = $status; Json = $json; Content = $content }
}

Assert-Authenticode -Path $installer

$qaRoot = Join-Path ([IO.Path]::GetTempPath()) ("ainovel-installed-smoke-" + [guid]::NewGuid().ToString('N'))
$installDir = Join-Path $qaRoot 'install'
$profileDir = Join-Path $qaRoot 'profile'
New-Item -ItemType Directory -Path $qaRoot, $profileDir | Out-Null

$appProcesses = @()
$installedExe = Join-Path $installDir 'AI Novel & Script Generator.exe'
$uninstalled = $false

try {
  $installerProcess = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installDir") -WindowStyle Hidden -Wait -PassThru
  if ($installerProcess.ExitCode -ne 0) {
    throw "NSIS installer exited with code $($installerProcess.ExitCode)"
  }
  if (-not (Test-Path -LiteralPath $installedExe)) {
    throw "Installed executable not found: $installedExe"
  }
  Assert-Authenticode -Path $installedExe

  $env:AI_NOVEL_PORT = [string]$Port
  $env:AINOVEL_UPDATE_CHECK_ON_LAUNCH = '0'
  $app = Start-Process -FilePath $installedExe -ArgumentList "--user-data-dir=`"$profileDir`"" -WindowStyle Hidden -PassThru
  $baseUrl = "http://127.0.0.1:$Port"
  $health = $null
  $lastError = $null
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
      $health = Invoke-RestMethod -Uri "$baseUrl/api/health/runtime" -TimeoutSec 3
      break
    } catch {
      $lastError = $_.Exception.Message
      Start-Sleep -Seconds 1
    }
  }
  if ($null -eq $health) {
    throw "Installed runtime health unavailable: $lastError"
  }
  $commercial = Invoke-RestMethod -Uri "$baseUrl/api/commercial/status" -TimeoutSec 10
  if ($commercial.tier -ne 'free' -or $commercial.tokenValid -ne $false) {
    throw "Fresh isolated install is not Free: tier=$($commercial.tier) tokenValid=$($commercial.tokenValid)"
  }
  $freeGate = Invoke-JsonApi -Method POST -Uri "$baseUrl/api/generate-video" -Body @{}
  if ($freeGate.Status -ne 403) {
    throw "Free install did not reject Pro video route: HTTP $($freeGate.Status)"
  }

  $trialChecked = $false
  $trialCreated = $null
  $trialReused = $null
  if (-not $SkipCloudTrial) {
    $trialStart = Invoke-JsonApi -Method POST -Uri "$baseUrl/api/entitlement/trial" -Body @{ hwid = $commercial.hwid }
    if ($trialStart.Status -ne 200 -or $trialStart.Json.ok -ne $true -or [string]::IsNullOrWhiteSpace([string]$trialStart.Json.token)) {
      throw "Cloud Trial issuance failed: HTTP $($trialStart.Status) $($trialStart.Content)"
    }
    $trialToken = [string]$trialStart.Json.token
    $trialCreated = [bool]$trialStart.Json.created
    $trialRepeat = Invoke-JsonApi -Method POST -Uri "$baseUrl/api/entitlement/trial" -Body @{ hwid = $commercial.hwid }
    if ($trialRepeat.Status -ne 200 -or $trialRepeat.Json.ok -ne $true -or $trialRepeat.Json.created -ne $false) {
      throw "Cloud Trial one-per-HWID reuse check failed: HTTP $($trialRepeat.Status)"
    }
    $trialReused = $true
    $trialHeaders = @{ 'x-ainovel-entitlement' = $trialToken }
    $trialVerify = Invoke-JsonApi -Method POST -Uri "$baseUrl/api/entitlement/verify" -Body @{ token = $trialToken }
    if ($trialVerify.Status -ne 200 -or $trialVerify.Json.valid -ne $true -or $trialVerify.Json.claims.hwidBound -ne $true) {
      throw 'Installed verifier rejected the real cloud Trial token'
    }
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $exp = [int64]$trialVerify.Json.claims.exp
    if ($exp -le $now -or $exp -gt ($now + 4 * 86400)) {
      throw "Trial expiry is outside the expected active window: exp=$exp now=$now"
    }
    $trialStatus = Invoke-JsonApi -Method GET -Uri "$baseUrl/api/commercial/status" -Headers $trialHeaders
    if ($trialStatus.Status -ne 200 -or $trialStatus.Json.tier -ne 'trial' -or $trialStatus.Json.claims.plan -ne 'trial') {
      throw 'Installed commercial status did not distinguish Trial from paid Pro'
    }
    $trialGate = Invoke-JsonApi -Method POST -Uri "$baseUrl/api/generate-video" -Body @{} -Headers $trialHeaders
    if ($trialGate.Status -eq 403) {
      throw 'Trial token did not unlock the Pro-equivalent video gate'
    }

    $parts = $trialToken.Split('.')
    if ($parts.Count -ne 4 -or [string]::IsNullOrWhiteSpace($parts[3])) {
      throw 'Trial token format is invalid'
    }
    $parts[3] = ($(if ($parts[3].StartsWith('A')) { 'B' } else { 'A' })) + $parts[3].Substring(1)
    $tamperedToken = [string]::Join('.', $parts)
    $tamperedVerify = Invoke-JsonApi -Method POST -Uri "$baseUrl/api/entitlement/verify" -Body @{ token = $tamperedToken }
    if ($tamperedVerify.Status -ne 401 -or $tamperedVerify.Json.valid -ne $false) {
      throw 'Installed verifier accepted a tampered Trial token'
    }
    $tamperedGate = Invoke-JsonApi -Method POST -Uri "$baseUrl/api/generate-video" -Body @{} -Headers @{ 'x-ainovel-entitlement' = $tamperedToken }
    if ($tamperedGate.Status -ne 403) {
      throw "Tampered token did not fail closed on Pro route: HTTP $($tamperedGate.Status)"
    }
    $trialChecked = $true
  }

  $paidProChecked = $false
  $paidProCloudHeartbeat = $false
  if (-not [string]::IsNullOrWhiteSpace($PaidProToken)) {
    if ([string]::IsNullOrWhiteSpace($PaidProLicenseId)) {
      throw 'PaidProLicenseId is required with PaidProToken for cloud-authority smoke'
    }
    $proActivate = Invoke-JsonApi -Method POST -Uri "$baseUrl/api/entitlement/activate" -Body @{
      token = $PaidProToken
      hwid = $commercial.hwid
    }
    if ($proActivate.Status -ne 200 -or $proActivate.Json.ok -ne $true) {
      throw "Paid Pro activation failed: HTTP $($proActivate.Status) $($proActivate.Content)"
    }
    if (
      $proActivate.Json.claims.plan -ne 'pro' -or
      $proActivate.Json.claims.is_pro -ne $true -or
      $proActivate.Json.claims.is_trial -eq $true
    ) {
      throw 'Paid Pro activation claims are not a non-Trial Pro entitlement'
    }
    $proVerify = Invoke-JsonApi -Method POST -Uri "$baseUrl/api/entitlement/verify" -Body @{
      token = $PaidProToken
    }
    if (
      $proVerify.Status -ne 200 -or
      $proVerify.Json.valid -ne $true -or
      $proVerify.Json.claims.plan -ne 'pro' -or
      $proVerify.Json.claims.is_trial -eq $true
    ) {
      throw 'Installed verifier rejected the paid Pro token'
    }
    $proHeartbeat = Invoke-JsonApi -Method POST -Uri "$baseUrl/api/cloud/license/verify" -Body @{
      token = $PaidProToken
      hwid = $commercial.hwid
    }
    if (
      $proHeartbeat.Status -ne 200 -or
      $proHeartbeat.Json.valid -ne $true -or
      $proHeartbeat.Json.cloud.checked -ne $true -or
      $proHeartbeat.Json.cloud.authority -ne 'supabase' -or
      [string]$proHeartbeat.Json.cloud.licenseId -ne $PaidProLicenseId
    ) {
      throw "Paid Pro cloud heartbeat failed: HTTP $($proHeartbeat.Status) $($proHeartbeat.Content)"
    }
    $paidProCloudHeartbeat = $true
    $proHeaders = @{ 'x-ainovel-entitlement' = $PaidProToken }
    $proStatus = Invoke-JsonApi -Method GET -Uri "$baseUrl/api/commercial/status" -Headers $proHeaders
    if ($proStatus.Status -ne 200 -or $proStatus.Json.tier -ne 'pro' -or $proStatus.Json.claims.plan -ne 'pro') {
      throw 'Installed commercial status did not report paid Pro'
    }
    $proGate = Invoke-JsonApi -Method POST -Uri "$baseUrl/api/generate-video" -Body @{} -Headers $proHeaders
    if ($proGate.Status -eq 403) {
      throw 'Paid Pro token did not unlock the Pro video gate'
    }
    $paidProChecked = $true
  }
  Start-Sleep -Seconds 2

  $appProcesses = @(Get-Process | Where-Object {
    try {
      $_.Path -and ([IO.Path]::GetFullPath($_.Path).StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase))
    } catch {
      $false
    }
  })
  $visibleWindows = @($appProcesses | Where-Object { $_.MainWindowHandle -ne 0 }).Count
  if ($health.healthy -ne $true -or [int]$health.fail -ne 0) {
    throw "Installed runtime unhealthy: fail=$($health.fail)"
  }
  if ($commercial.entitlement.mode -ne 'enforce' -or $commercial.entitlement.readyForCommercial -ne $true) {
    throw 'Installed commercial entitlement is not enforce/ready'
  }
  if ($commercial.update.configured -ne $true) {
    throw 'Installed update feed is not configured'
  }
  if ($visibleWindows -lt 1) {
    throw 'Installed app did not expose a visible window'
  }

  $appProcesses | Stop-Process -Force
  Start-Sleep -Milliseconds 750

  $uninstaller = Get-ChildItem -LiteralPath $installDir -File -Filter 'Uninstall*.exe' | Select-Object -First 1
  if ($null -eq $uninstaller) {
    throw "NSIS uninstaller not found in $installDir"
  }
  $uninstallProcess = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
  if ($uninstallProcess.ExitCode -ne 0) {
    throw "NSIS uninstaller exited with code $($uninstallProcess.ExitCode)"
  }
  for ($attempt = 0; $attempt -lt 20 -and (Test-Path -LiteralPath $installedExe); $attempt++) {
    Start-Sleep -Milliseconds 500
  }
  $uninstalled = -not (Test-Path -LiteralPath $installedExe)
  if (-not $uninstalled) {
    throw 'Uninstall completed but the installed executable still exists'
  }

  [pscustomobject]@{
    ok = $true
    installer = $installer
    installDir = $installDir
    healthy = $health.healthy
    runtimeOk = $health.ok
    runtimeWarn = $health.warn
    runtimeFail = $health.fail
    visibleWindows = $visibleWindows
    entitlementMode = $commercial.entitlement.mode
    readyForCommercial = $commercial.entitlement.readyForCommercial
    updateConfigured = $commercial.update.configured
    freeTierVerified = $true
    freeProRouteStatus = $freeGate.Status
    cloudTrialChecked = $trialChecked
    trialCreated = $trialCreated
    trialReused = $trialReused
    paidProChecked = $paidProChecked
    paidProCloudHeartbeat = $paidProCloudHeartbeat
    uninstalled = $uninstalled
  } | ConvertTo-Json -Compress
} finally {
  $remaining = @(Get-Process | Where-Object {
    try {
      $_.Path -and ([IO.Path]::GetFullPath($_.Path).StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase))
    } catch {
      $false
    }
  })
  if ($remaining.Count -gt 0) {
    $remaining | Stop-Process -Force
  }
}
