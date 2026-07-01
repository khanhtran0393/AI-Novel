@echo off
title "AI Novel & Script Generator - Bootstrapper"
color 0e

echo ======================================================================
echo           AI NOVEL AND SCRIPT GENERATOR - BOOTSTRAPPER
echo ======================================================================
echo.
echo [+] Dang kiem tra thu vien node_modules...
if not exist node_modules (
    echo [!] Thu vien chua duoc cai dat. Dang tien hanh cai dat...
    call npm install
) else (
    echo [+] Thu vien da san sang.
)

echo.
echo [+] Dang khoi dong Next.js Local Dev Server...
echo [+] Vui long truy cap vao duong dan: http://localhost:3000
echo ======================================================================
echo.

start http://localhost:3000
call npm run dev

pause
