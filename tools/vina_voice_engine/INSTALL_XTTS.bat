@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Cai Coqui XTTS (clone tembre that) ===
echo Can GPU NVIDIA + nhieu RAM/VRAM. Co the mat nhieu phut.
echo.
where python >nul 2>&1
if errorlevel 1 (
  set PY=py -3
) else (
  set PY=python
)
%PY% -m pip install -U pip
%PY% -m pip install "TTS" torch torchaudio --index-url https://download.pytorch.org/whl/cu121
if errorlevel 1 (
  echo Thu CPU torch...
  %PY% -m pip install "TTS" torch torchaudio
)
echo.
echo Xong. Chay RUN_ENGINE.bat roi kiem tra /health xtts_available=true
pause
