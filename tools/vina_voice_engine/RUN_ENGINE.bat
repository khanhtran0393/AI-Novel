@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === AI Novel · VinaVoice Independent Engine (port 8765) ===
echo Khong can Vina-Voice.exe. Clone: XTTS neu cai TTS, else Edge fallback.
echo.
where python >nul 2>&1
if errorlevel 1 (
  where py >nul 2>&1
  if errorlevel 1 (
    echo [LOI] Khong tim thay python. Cai Python 3.10+ va them PATH.
    pause
    exit /b 1
  )
  set PY=py -3
) else (
  set PY=python
)

echo [1/2] Cai edge-tts (minimal)...
%PY% -m pip install -q -r requirements.txt
echo [2/2] Khoi dong engine...
echo Health: http://127.0.0.1:8765/health
echo.
%PY% engine_server.py
pause
