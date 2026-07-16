@echo off
chcp 65001 >nul
cd /d "%~dp0\.."
set VINA_PROVIDER=cpu
set VINA_FORCE_CPU=1
set PYTHONUTF8=1
set AINOVEL_BASE=http://127.0.0.1:3000
set VINA_PROBE_HARD_MS=150000
title AI Novel Zero-Shot cum 5 LOOP

echo ============================================
echo  Loop: moi vong = 5 giong, roi thoat process
echo  Progress: scratch\vina-batch-progress.json
echo  Log:      scratch\vina-batch-probe.log
echo ============================================

:wait
curl -s -o nul -m 3 "%AINOVEL_BASE%/api/vina-voice/status"
if errorlevel 1 (
  echo waiting server...
  timeout /t 3 /nobreak >nul
  goto wait
)

set ROUND=0
:loop
set /a ROUND+=1
echo.
echo ===== ROUND %ROUND% %date% %time% =====
node scripts\probe-vina-one-batch.mjs --batch-size=5
set EC=%ERRORLEVEL%

REM check remaining via node
node -e "const p=require('./scratch/vina-batch-progress.json');const fs=require('fs');const cat=76;const pass=Object.keys(p.pass||{}).length;const fail=Object.keys(p.fail||{}).length;console.log('STATUS pass='+pass+' fail='+fail);if(pass>=76){process.exit(10)}if(pass+fail>=76&&fail>0){process.exit(11)}process.exit(0);"
if %ERRORLEVEL%==10 (
  echo.
  echo ====== ALL 76 PASS ======
  goto end
)
if %ERRORLEVEL%==11 (
  echo.
  echo ====== DONE WITH FAILS ======
  goto end
)

REM safety cap 30 rounds (150 voices)
if %ROUND% GEQ 30 goto end

timeout /t 2 /nobreak >nul
goto loop

:end
echo.
echo Final progress:
type scratch\vina-batch-progress.json | more
if exist tmp-vina-batch-summary.json type tmp-vina-batch-summary.json
echo.
pause
