@echo off
chcp 65001 >nul
title AI Novel - Probe Nao Zero-Shot (cum 5)
cd /d "%~dp0\.."

set VINA_PROVIDER=cpu
set VINA_FORCE_CPU=1
set PYTHONUTF8=1
set AINOVEL_BASE=http://127.0.0.1:3000

echo ============================================
echo  Nao Zero-Shot: probe theo cum 5 giọng
echo  Progress: scratch\vina-batch-progress.json
echo  Log:      scratch\vina-batch-probe.log
echo  Base:     %AINOVEL_BASE%
echo ============================================
echo.

REM Wait for Next if needed
:wait_server
curl -s -o nul -m 3 "%AINOVEL_BASE%/api/vina-voice/status"
if errorlevel 1 (
  echo [wait] Server chua san sang tai %AINOVEL_BASE% ...
  timeout /t 3 /nobreak >nul
  goto wait_server
)
echo [ok] Server online
echo.

REM %1 = optional flags, e.g. --force  or  --only-fails
set EXTRA=%*
if "%EXTRA%"=="" set EXTRA=
echo Flags: %EXTRA%
echo.

node scripts\probe-vina-batches.mjs --batch-size=5 --retries=1 %EXTRA%
set EXITCODE=%ERRORLEVEL%

echo.
echo ============================================
echo  Exit code: %EXITCODE%
echo  Xem: scratch\vina-batch-progress.json
echo       scratch\vina-batch-probe.log
echo       tmp-vina-batch-summary.json
echo ============================================
echo.
pause
exit /b %EXITCODE%
