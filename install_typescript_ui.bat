@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul
title DLSS 5 Visual Enhancer - Install TypeScript UI
cls

echo ================================================================
echo DLSS 5 Visual Enhancer - TypeScript UI Installer
echo ================================================================
echo.
echo This installs/builds the React TypeScript interface and keeps all npm
echo cache/tooling under this application folder. It does not replace the
echo NVIDIA native runtime or download model weights.
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install_typescript_ui.ps1" -SourceRoot "%~dp0." -Launch
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
    echo.
    echo TypeScript UI installation failed with exit code %RC%.
    pause
)
exit /b %RC%
