@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AI Novel - Starting...

REM Avoid ELECTRON_RUN_AS_NODE (IDE/agent) breaking Electron
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_NO_ATTACH_CONSOLE=1"

if exist "scratch\clean_startup.js" (
  node scratch\clean_startup.js >nul 2>&1
)

set "ELECTRON_EXE=%~dp0node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON_EXE%" (
  echo [!] Missing electron.exe
  echo     Run: npm install
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0package.json" (
  echo [!] Missing package.json
  pause
  exit /b 1
)

node -e "const p=require('./package.json'); if(p.name!=='ai-novel-script-generator'){console.error('[!] Wrong package.json name='+p.name); process.exit(2);}" 2>nul
if errorlevel 1 (
  echo [!] package.json is not AI Novel. Restore: git checkout HEAD -- package.json
  pause
  exit /b 2
)

REM start = bat exits, no leftover npm console
start "" "%ELECTRON_EXE%" "%~dp0."
exit /b 0