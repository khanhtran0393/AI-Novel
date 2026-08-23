@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Nova Studio (AI Novel) - Starting...

REM Avoid ELECTRON_RUN_AS_NODE (IDE/agent) breaking Electron
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_NO_ATTACH_CONSOLE=1"

set "ELECTRON_EXE=%~dp0node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON_EXE%" (
  echo [!] Missing electron.exe
  echo     Run: npm install
  echo.
  pause
  exit /b 1
)

REM Runtime noi bo Nova Studio (GUI + logic) — doc lap, khong phu thuoc D:\Nova Studio
if not exist "%~dp0nova\main.js" (
  echo [!] Missing nova\main.js — Nova Studio runtime
  pause
  exit /b 1
)

REM start = bat exits, no leftover console
start "" "%ELECTRON_EXE%" "%~dp0nova"
exit /b 0

