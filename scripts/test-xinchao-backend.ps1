$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backendRoot = Join-Path $repoRoot "tools\xinchao-cut\backend"
$runtimeVenv = if ($env:XINCHAO_AI_DIR) {
  Join-Path $env:XINCHAO_AI_DIR "venv"
} else {
  Join-Path $env:LOCALAPPDATA "XinChao-Cut\venv"
}
$qaVenv = if ($env:AINOVEL_XINCHAO_QA_VENV) {
  $env:AINOVEL_XINCHAO_QA_VENV
} else {
  Join-Path $env:LOCALAPPDATA "AI-Novel-Build\xinchao-qa-venv"
}

$python = Join-Path $runtimeVenv "Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
  $python = Join-Path $qaVenv "Scripts\python.exe"
}
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
  New-Item -ItemType Directory -Path (Split-Path $qaVenv) -Force | Out-Null
  & py -3.11 -m venv $qaVenv
  if ($LASTEXITCODE -ne 0) {
    throw "Không tạo được Python 3.11 QA venv tại $qaVenv"
  }
}

& $python -c "import fastapi, pytest, openpyxl, numpy, PIL"
if ($LASTEXITCODE -ne 0) {
  & $python -m pip install `
    -r (Join-Path $backendRoot "requirements-core.txt") `
    -r (Join-Path $backendRoot "requirements-dev.txt") `
    "numpy==1.26.4" `
    "Pillow"
  if ($LASTEXITCODE -ne 0) {
    throw "Không cài được dependency QA backend XinChao-Cut"
  }
}

Push-Location (Join-Path $repoRoot "tools\xinchao-cut")
try {
  & $python -m pytest backend -q
  if ($LASTEXITCODE -ne 0) {
    throw "XinChao-Cut backend pytest failed"
  }
} finally {
  Pop-Location
}
