@echo off
setlocal EnableExtensions
title XinChao-Cut - All-In-One Launcher

set "ROOT=%~dp0"
cd /d "%ROOT%"

set "BACKEND_PY=%LOCALAPPDATA%\XinChao-Cut\venv\Scripts\python.exe"
if not exist "%BACKEND_PY%" set "BACKEND_PY=%ROOT%backend\.venv\Scripts\python.exe"

echo ========================================================
echo   XinChao-Cut - Trinh Khoi Dong Tat-Ca-Trong-Mot (1 Click)
echo ========================================================
echo.

set "NPM_CMD="
for /f "delims=" %%I in ('where npm.cmd 2^>nul') do if not defined NPM_CMD set "NPM_CMD=%%I"
if defined NPM_CMD goto CHECK_ENV

echo [ERROR] Khong tim thay Node.js / npm trong he thong!
echo Vui long cai dat Node.js 22 LTS tai: https://nodejs.org/
echo.
pause
exit /b 1

:CHECK_ENV
if exist "%BACKEND_PY%" goto START_APP

echo [THONG BAO] Phat hien lan dau chay hoac thieu moi truong Python.
echo He thong se tu dong chay Setup khoi tao (moi truong Python + Thu vien NPM)...
echo.
call "%ROOT%setup.bat"
if errorlevel 1 goto SETUP_FAILED

set "BACKEND_PY=%LOCALAPPDATA%\XinChao-Cut\venv\Scripts\python.exe"
if not exist "%BACKEND_PY%" set "BACKEND_PY=%ROOT%backend\.venv\Scripts\python.exe"
goto START_APP

:SETUP_FAILED
echo.
echo [ERROR] Qua trinh Setup gap loi. Vui long KIEM TRA LOG o tren.
echo.
pause
exit /b 1

:START_APP
set "HF_HUB_DISABLE_XET=1"
set "HF_HUB_DISABLE_SYMLINKS=1"
set "VITE_BACKEND_URL=http://127.0.0.1:8000"
set "XINCHAO_EXTERNAL_BACKEND=1"

echo [1/2] Dang khoi tao Backend staging...
call "%NPM_CMD%" run backend:stage
if errorlevel 1 goto STAGE_FAILED

echo [2/2] Dang khoi dong Backend Python (Uvicorn 127.0.0.1:8000)...
start "XinChao-Cut Backend" /D "%ROOT%backend" "%BACKEND_PY%" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --no-use-colors

set "CARGO_CMD="
for /f "delims=" %%I in ('where cargo.exe 2^>nul') do if not defined CARGO_CMD set "CARGO_CMD=%%I"

if defined CARGO_CMD goto ASK_MODE

echo.
echo [THONG BAO] May hien tai chua cai Rust (cargo.exe) de bien dich Desktop App.
echo Dang tu dong khoi dong Giao dien Web tren Trinh Duyet (http://localhost:5173)...
echo.
start http://localhost:5173
call "%NPM_CMD%" run dev
goto END

:ASK_MODE
echo.
echo ========================================================
echo   Backend da khoi dong thanh cong!
echo   [1] Chay ung dung Desktop (Tauri App)
echo   [2] Chay ung dung Web (Trinh duyet http://localhost:5173)
echo ========================================================
echo.
set /p MODE="Chon che do khoi dong (1 hoac 2, Mac dinh: 1): "

if "%MODE%"=="2" goto RUN_WEB
goto RUN_DESKTOP

:RUN_WEB
echo.
echo Dang mo giao dien Web Server... (http://localhost:5173)
start http://localhost:5173
call "%NPM_CMD%" run dev
goto END

:RUN_DESKTOP
echo.
echo Dang mo giao dien Desktop App...
call "%NPM_CMD%" run tauri dev
goto END

:STAGE_FAILED
echo [ERROR] Staging backend failed.
pause
exit /b 1

:END
pause
