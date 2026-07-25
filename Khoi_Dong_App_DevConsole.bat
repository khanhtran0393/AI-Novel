@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AI Novel - Dev Console
echo ===================================================
echo   DEV MODE - keep this window for logs
echo   Daily use: Khoi_Dong_App.bat or Silent.vbs
echo ===================================================
echo.

set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_NO_ATTACH_CONSOLE="

if not exist "package.json" (
  echo [!] Missing package.json in %CD%
  pause
  exit /b 1
)

node -e "const p=require('./package.json'); if(p.name!=='ai-novel-script-generator'||!p.scripts||!p.scripts['dev:desktop']){console.error('[!] Wrong package.json (name='+(p.name||'?')+'). Restore: git checkout HEAD -- package.json'); process.exit(2);} console.log('[ok] package:', p.name, '|', p.scripts['dev:desktop']);"
if errorlevel 1 (
  echo.
  echo [!] package.json is not AI Novel or missing script dev:desktop.
  echo     Restore: git checkout HEAD -- package.json
  echo     Then run this bat again.
  echo.
  pause
  exit /b 2
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [!] Missing electron.exe - run: npm install
  pause
  exit /b 1
)

if not exist "node_modules\next" (
  echo [!] Missing next - run: npm install
  pause
  exit /b 1
)

if exist "scratch\clean_startup.js" (
  echo [.] Cleaning ports...
  node scratch\clean_startup.js
)

echo [.] Starting Electron + Next (dev:desktop)...
echo.

call npm run dev:desktop
set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
  echo.
  echo [!] npm run dev:desktop failed code: %EXITCODE%
  echo [.] Trying electron.exe directly...
  set "ELECTRON_NO_ATTACH_CONSOLE="
  "node_modules\electron\dist\electron.exe" .
  set "EXITCODE=%ERRORLEVEL%"
)

if not "%EXITCODE%"=="0" (
  echo [!] Exit code: %EXITCODE%
  pause
)
exit /b %EXITCODE%