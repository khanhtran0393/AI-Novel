@echo off
chcp 65001 >nul
cd /d "%~dp0\.."

set VINA_PROVIDER=cpu
set VINA_FORCE_CPU=1
set PYTHONUTF8=1
set AINOVEL_BASE=http://127.0.0.1:3000
set VINA_PROBE_HARD_MS=150000

if not exist scratch mkdir scratch

echo [%date% %time%] DETACHED START > scratch\vina-detached.log
echo Progress: scratch\vina-batch-progress.json>> scratch\vina-detached.log
echo Batch log: scratch\vina-batch-probe.log>> scratch\vina-detached.log
echo.>> scratch\vina-detached.log

:wait
curl -s -o nul -m 3 "%AINOVEL_BASE%/api/vina-voice/status"
if errorlevel 1 (
  echo [%date% %time%] wait server...>> scratch\vina-detached.log
  timeout /t 5 /nobreak >nul
  goto wait
)

set ROUND=0
:loop
set /a ROUND+=1
echo [%date% %time%] ROUND %ROUND%>> scratch\vina-detached.log

node scripts\probe-vina-one-batch.mjs --batch-size=5 >> scratch\vina-detached.log 2>&1
set EC=%ERRORLEVEL%
echo [%date% %time%] ROUND %ROUND% exit=%EC%>> scratch\vina-detached.log

node -e "const p=require('./scratch/vina-batch-progress.json');const pass=Object.keys(p.pass||{}).length;const fail=Object.keys(p.fail||{}).length;console.log('STATUS pass='+pass+' fail='+fail);if(pass>=76)process.exit(10);if(pass+fail>=76)process.exit(11);process.exit(0);" >> scratch\vina-detached.log 2>&1
if %ERRORLEVEL%==10 (
  echo [%date% %time%] ALL 76 PASS>> scratch\vina-detached.log
  goto end
)
if %ERRORLEVEL%==11 (
  echo [%date% %time%] DONE WITH FAILS>> scratch\vina-detached.log
  goto end
)
if %ROUND% GEQ 30 (
  echo [%date% %time%] ROUND CAP>> scratch\vina-detached.log
  goto end
)
timeout /t 2 /nobreak >nul
goto loop

:end
node -e "const p=require('./scratch/vina-batch-progress.json');const fs=require('fs');const pass=Object.keys(p.pass||{}).length;const fails=Object.entries(p.fail||{});const s={totals:{catalog:76,pass,fail:fails.length},fails:fails.map(([k,v])=>({voice:k.replace('vina_voice::',''),error:v.error})),at:new Date().toISOString()};fs.writeFileSync('tmp-vina-batch-summary.json',JSON.stringify(s,null,2));console.log(JSON.stringify(s.totals));" >> scratch\vina-detached.log 2>&1
echo [%date% %time%] DETACHED END>> scratch\vina-detached.log
exit /b 0
