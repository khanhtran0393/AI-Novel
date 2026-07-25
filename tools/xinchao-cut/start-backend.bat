@echo off
setlocal
set "ROOT=%~dp0"
set "BACKEND=%~dp0backend"
set "PYTHON=%LOCALAPPDATA%\XinChao-Cut\venv\Scripts\python.exe"
if not exist "%PYTHON%" set "PYTHON=%BACKEND%\.venv\Scripts\python.exe"

if not exist "%PYTHON%" (
  echo [ERROR] Thieu moi truong Python backend.
  echo Vui long chay setup.bat truoc de khoi tao moi truong Python.
  echo.
  pause
  exit /b 1
)

set "HF_HUB_DISABLE_XET=1"
set "HF_HUB_DISABLE_SYMLINKS=1"
cd /d "%BACKEND%"
"%PYTHON%" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --no-use-colors

