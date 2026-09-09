@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul
title DLSS 5 Visual Enhancer - Clean RTX 4090 + TypeScript Installer
cls

echo DLSS 5 Visual Enhancer - Clean RTX 4090 + TypeScript Installer
echo.
echo This downloads and SHA-256 verifies the v7.0 native portable runtime,
echo overlays this repository, applies the RTX 4090 best profile, installs and
echo builds the TypeScript/React primary UI, then verifies the final layout.
echo.
echo The previous portable install is not moved until the complete staged build
echo succeeds. Existing installs are preserved as timestamped backups.
echo.

where powershell.exe >nul 2>nul
if errorlevel 1 (
    echo ERROR: Windows PowerShell is required.
    pause
    exit /b 1
)

set "INSTALLER=%~dp0tools\install_clean_4090.ps1"
if not exist "%INSTALLER%" (
    echo ERROR: Missing installer helper: "%INSTALLER%"
    pause
    exit /b 1
)

rem Use %%~dp0. rather than a quoted path ending directly in backslash; this
rem avoids the Windows PowerShell trailing-backslash/quote parsing edge case.
set "SOURCE_ROOT=%~dp0."

rem Double-click = install to sibling DLSS5_4090_PORTABLE and launch TypeScript UI.
rem Advanced examples:
rem   install_clean_4090.bat -InstallDir "E:\Apps\DLSS5_4090"
rem   install_clean_4090.bat -InstallDir "E:\Apps\DLSS5_4090" -Launch
rem   install_clean_4090.bat -KeepDownload
if "%~1"=="" (
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER%" -SourceRoot "%SOURCE_ROOT%" -Launch
) else (
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER%" -SourceRoot "%SOURCE_ROOT%" %*
)

set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
    echo.
    echo Installation failed with exit code %RC%.
    pause
)
exit /b %RC%
