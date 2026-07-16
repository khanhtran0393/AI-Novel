@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AI Novel - Dang mo...

REM Tránh ELECTRON_RUN_AS_NODE (IDE/agent) → Electron mất API app
set ELECTRON_RUN_AS_NODE=
set ELECTRON_NO_ATTACH_CONSOLE=1

REM [1] Dọn cổng ẩn (không giữ cửa sổ node)
if exist "scratch\clean_startup.js" (
  node scratch\clean_startup.js >nul 2>&1
)

REM [2] Electron trực tiếp — KHÔNG qua "npm run" (npm = cửa sổ Node.js)
set "ELECTRON_EXE=%~dp0node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON_EXE%" (
  echo [!] Khong tim thay electron.exe
  echo     Chay: npm install
  echo.
  pause
  exit /b 1
)

REM start = bat thoát ngay, không giữ console Node/npm
start "" "%ELECTRON_EXE%" "%~dp0."

exit /b 0
