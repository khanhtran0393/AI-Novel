param(
  [Parameter(Mandatory = $true)]
  [string]$BaselineInstallerPath,
  [Parameter(Mandatory = $true)]
  [string]$CandidateExePath,
  [Parameter(Mandatory = $true)]
  [string]$UpdateFeedUrl,
  [int]$Port = 32301
)

$ErrorActionPreference = 'Stop'
$baselineInstaller = (Resolve-Path -LiteralPath $BaselineInstallerPath).Path
$candidateExe = (Resolve-Path -LiteralPath $CandidateExePath).Path
$publisher = [string]$env:WIN_CSC_PUBLISHER_NAME
$expectedThumbprint = ([string]$env:WIN_CSC_CERTIFICATE_SHA1 -replace '[^A-Fa-f0-9]', '').ToUpperInvariant()

if (-not $UpdateFeedUrl.StartsWith('https://', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'UpdateFeedUrl must use HTTPS'
}
if ([string]::IsNullOrWhiteSpace($publisher)) {
  throw 'WIN_CSC_PUBLISHER_NAME is required'
}
if ($expectedThumbprint -notmatch '^[A-F0-9]{40}$') {
  throw 'WIN_CSC_CERTIFICATE_SHA1 must contain 40 hexadecimal characters'
}

function Assert-Authenticode([string]$Path) {
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

function Stop-InstalledProcesses([string]$InstallDir) {
  $processes = @(Get-Process | Where-Object {
    try {
      $_.Path -and ([IO.Path]::GetFullPath($_.Path).StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase))
    } catch {
      $false
    }
  })
  if ($processes.Count -gt 0) {
    $processes | Stop-Process -Force
  }
}

Assert-Authenticode -Path $baselineInstaller
Assert-Authenticode -Path $candidateExe
$candidateHash = (Get-FileHash -LiteralPath $candidateExe -Algorithm SHA512).Hash

$qaRoot = Join-Path ([IO.Path]::GetTempPath()) ("ainovel-updater-smoke-" + [guid]::NewGuid().ToString('N'))
$installDir = Join-Path $qaRoot 'install'
$profileDir = Join-Path $qaRoot 'profile'
New-Item -ItemType Directory -Path $qaRoot, $profileDir | Out-Null
$installedExe = Join-Path $installDir 'AI Novel & Script Generator.exe'

$savedEnv = @{
  AI_NOVEL_PORT = $env:AI_NOVEL_PORT
  AINOVEL_UPDATE_FEED_URL = $env:AINOVEL_UPDATE_FEED_URL
  AINOVEL_UPDATE_CHECK_ON_LAUNCH = $env:AINOVEL_UPDATE_CHECK_ON_LAUNCH
  AINOVEL_UPDATE_QA_AUTORUN = $env:AINOVEL_UPDATE_QA_AUTORUN
}

try {
  $install = Start-Process -FilePath $baselineInstaller -ArgumentList @('/S', "/D=$installDir") -WindowStyle Hidden -Wait -PassThru
  if ($install.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $installedExe)) {
    throw "Baseline NSIS installation failed with exit code $($install.ExitCode)"
  }
  Assert-Authenticode -Path $installedExe
  $baselineHash = (Get-FileHash -LiteralPath $installedExe -Algorithm SHA512).Hash
  if ($baselineHash -ceq $candidateHash) {
    throw 'Baseline executable is byte-identical to the candidate; updater test needs a lower version'
  }

  $env:AI_NOVEL_PORT = [string]$Port
  $env:AINOVEL_UPDATE_FEED_URL = $UpdateFeedUrl.TrimEnd('/')
  $env:AINOVEL_UPDATE_CHECK_ON_LAUNCH = '1'
  $env:AINOVEL_UPDATE_QA_AUTORUN = '1'
  Start-Process -FilePath $installedExe -ArgumentList "--user-data-dir=`"$profileDir`"" -WindowStyle Hidden | Out-Null

  $baseUrl = "http://127.0.0.1:$Port"
  $health = $null
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
      $health = Invoke-RestMethod -Uri "$baseUrl/api/health/runtime" -TimeoutSec 3
      break
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  if ($null -eq $health -or $health.healthy -ne $true) {
    throw 'Baseline installed app did not become healthy before update'
  }

  $updated = $false
  for ($attempt = 0; $attempt -lt 180; $attempt++) {
    if (Test-Path -LiteralPath $installedExe) {
      try {
        $installedHash = (Get-FileHash -LiteralPath $installedExe -Algorithm SHA512).Hash
        if ($installedHash -ceq $candidateHash) {
          $updated = $true
          break
        }
      } catch {
        # Installer may be replacing the executable; retry until the deadline.
      }
    }
    Start-Sleep -Seconds 1
  }
  if (-not $updated) {
    throw 'Signed updater did not replace the baseline executable within 180 seconds'
  }

  Stop-InstalledProcesses -InstallDir $installDir
  Start-Sleep -Milliseconds 750
  Assert-Authenticode -Path $installedExe

  $env:AINOVEL_UPDATE_CHECK_ON_LAUNCH = '0'
  $env:AINOVEL_UPDATE_QA_AUTORUN = '0'
  Start-Process -FilePath $installedExe -ArgumentList "--user-data-dir=`"$profileDir`"" -WindowStyle Hidden | Out-Null
  $updatedHealth = $null
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
      $updatedHealth = Invoke-RestMethod -Uri "$baseUrl/api/health/runtime" -TimeoutSec 3
      break
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  if ($null -eq $updatedHealth -or $updatedHealth.healthy -ne $true -or [int]$updatedHealth.fail -ne 0) {
    throw 'Updated installed app did not become healthy'
  }
  Start-Sleep -Seconds 2
  $visibleWindows = @(Get-Process | Where-Object {
    try {
      $_.Path -and ([IO.Path]::GetFullPath($_.Path).StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase)) -and $_.MainWindowHandle -ne 0
    } catch {
      $false
    }
  }).Count
  if ($visibleWindows -lt 1) {
    throw 'Updated app did not expose a visible window'
  }

  Stop-InstalledProcesses -InstallDir $installDir
  Start-Sleep -Milliseconds 750
  $uninstaller = Get-ChildItem -LiteralPath $installDir -File -Filter 'Uninstall*.exe' | Select-Object -First 1
  if ($null -eq $uninstaller) {
    throw "NSIS uninstaller not found in $installDir"
  }
  $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
  if ($uninstall.ExitCode -ne 0) {
    throw "NSIS uninstall failed with exit code $($uninstall.ExitCode)"
  }
  for ($attempt = 0; $attempt -lt 20 -and (Test-Path -LiteralPath $installedExe); $attempt++) {
    Start-Sleep -Milliseconds 500
  }
  if (Test-Path -LiteralPath $installedExe) {
    throw 'Updated app uninstall left the executable behind'
  }

  [pscustomobject]@{
    ok = $true
    feedUrl = $UpdateFeedUrl
    baselineHash = $baselineHash
    candidateHash = $candidateHash
    updatedHashMatched = $updated
    runtimeOk = $updatedHealth.ok
    runtimeWarn = $updatedHealth.warn
    runtimeFail = $updatedHealth.fail
    visibleWindows = $visibleWindows
    uninstalled = $true
  } | ConvertTo-Json -Compress
} finally {
  Stop-InstalledProcesses -InstallDir $installDir
  $env:AI_NOVEL_PORT = $savedEnv.AI_NOVEL_PORT
  $env:AINOVEL_UPDATE_FEED_URL = $savedEnv.AINOVEL_UPDATE_FEED_URL
  $env:AINOVEL_UPDATE_CHECK_ON_LAUNCH = $savedEnv.AINOVEL_UPDATE_CHECK_ON_LAUNCH
  $env:AINOVEL_UPDATE_QA_AUTORUN = $savedEnv.AINOVEL_UPDATE_QA_AUTORUN
}
