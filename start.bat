@echo off
REM ============================================================
REM  Khoi dong AI Video Studio (Windows)
REM  TU DONG: kiem tra Node -> cai depend (neu thieu) -> mo AI Video Studio.
REM ============================================================
setlocal
cd /d "%~dp0"

echo ============================================================
echo   Khoi dong AI Video Studio
echo ============================================================
echo.

REM ---- Kiem tra Node.js ----
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [LOI] Chua cai Node.js.
  echo Tai va cai tu: https://nodejs.org/  ^(chon ban LTS^)
  echo Sau khi cai xong, chay lai file nay.
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo     Node: %%v

REM ---- Cai depend neu thieu ----
if not exist "node_modules\" (
  echo.
  echo Dang cai thu vien lan dau ^(cho vai phut^) ...
  call npm install
  if errorlevel 1 (
    echo.
    echo [LOI] Cai thu vien that bai. Kiem tra mang roi chay lai.
    pause
    exit /b 1
  )
)

echo.
echo Dang mo ung dung ...
call npm start
if errorlevel 1 (
  echo.
  echo [LOI] App dong kem ma loi. Xem log o cua so dong lenh phia tren.
  pause
)

exit /b 0