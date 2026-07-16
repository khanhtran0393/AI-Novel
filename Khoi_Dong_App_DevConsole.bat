@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AI Novel - Dev Console (log Node/Electron)
echo ===================================================
echo   CHE DO DEV — giu cua so de xem log
echo   Dung hang ngay: Khoi_Dong_App.bat hoac Silent.vbs
echo ===================================================
echo.
set ELECTRON_RUN_AS_NODE=
set ELECTRON_NO_ATTACH_CONSOLE=

if exist "scratch\clean_startup.js" (
  node scratch\clean_startup.js
)

call npm run dev:desktop
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo [!] Thoat ma loi: %EXITCODE%
  pause
)
exit /b %EXITCODE%
