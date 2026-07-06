@echo off
title AI Novel ^& Script Generator - Desktop App
echo ===================================================
echo   KHOI DONG HE THONG AI NOVEL (ELECTRON DESKTOP)
echo ===================================================
echo.
echo Dang quet va giai phong cac cong/tien trinh chay ngam...
node scratch/clean_startup.js
echo.
echo Dang tien hanh khoi dong may chu Next.js va Electron...
echo Vui long cho trong giay lat!
echo.
npm run dev:desktop
pause
