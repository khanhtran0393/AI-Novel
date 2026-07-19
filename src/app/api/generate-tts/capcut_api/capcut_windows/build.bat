@echo off
:: build.bat — Compile cronet_helper.dll (MSVC cl.exe)
setlocal

set SRC=%~dp0cronet_helper_dll.cpp
set OUT=%~dp0cronet_helper.dll

where cl.exe >nul 2>&1
if %errorlevel% equ 0 goto :build

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" goto :missing_vc
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSROOT=%%i"
if not defined VSROOT goto :missing_vc
set "VCVARS=%VSROOT%\VC\Auxiliary\Build\vcvarsall.bat"
if not exist "%VCVARS%" goto :missing_vc
echo [*] Initializing MSVC env...
call "%VCVARS%" x64 >nul
goto :build

:missing_vc
echo [-] Visual Studio C++ Build Tools were not found via vswhere.exe.
exit /b 1

:build
echo [*] Compiling %SRC%
cl.exe /O2 /std:c++17 /EHsc /MD /LD "%SRC%" /Fe:"%OUT%" /link Advapi32.lib /INCREMENTAL:NO

if %errorlevel% neq 0 (
    echo [-] Build FAILED.
    exit /b %errorlevel%
)
echo [+] Build succeeded: %OUT%
endlocal
