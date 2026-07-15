@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AI Novel - Auto setup Google Flow

echo.
echo  === AI Novel Flow Auto Setup ===
echo  1) Tim Chrome + extension
echo  2) Goi bootstrap (can app/Next dang chay o port 3000)
echo.

set PORT=%AI_NOVEL_PORT%
if "%PORT%"=="" set PORT=3000

echo [..] Kiem tra server http://127.0.0.1:%PORT% ...
curl -s -o nul -w "%%{http_code}" "http://127.0.0.1:%PORT%/api/health/runtime" > "%TEMP%\ainovel_health.txt" 2>nul
set /p CODE=<"%TEMP%\ainovel_health.txt"
if not "%CODE%"=="200" (
  echo [!] App chua chay. Dang thu khoi dong desktop...
  if exist "Khoi_Dong_App.bat" (
    start "" "Khoi_Dong_App.bat"
    echo [..] Cho 20s de Next san sang...
    timeout /t 20 /nobreak >nul
  ) else (
    echo [!] Chay app truoc ^(npm run dev / Khoi_Dong_App.bat^) roi chay lai file nay.
    pause
    exit /b 1
  )
)

echo [..] POST /api/flow/bootstrap ...
curl -s -X POST "http://127.0.0.1:%PORT%/api/flow/bootstrap" ^
  -H "Content-Type: application/json" ^
  -d "{\"forceChrome\":true,\"waitExtensionMs\":25000}"
echo.
echo.
echo  Xong. Neu Chrome mo tab Flow: dang nhap Google ^(neu can^).
echo  Token se tu capture — quay lai app gen anh/video.
echo.
pause
