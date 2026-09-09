@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul
title DLSS 5 Visual Enhancer - RTX 4090 TypeScript UI
cls

set "PYTHONNOUSERSITE=1"
set "PYTHONDONTWRITEBYTECODE=1"
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"
set "GRADIO_ANALYTICS_ENABLED=False"
if not defined DLSS5_NVENC_PRESET set "DLSS5_NVENC_PRESET=p5"
if not defined DLSS5_FAST_PREVIEW_NVENC set "DLSS5_FAST_PREVIEW_NVENC=1"
if not defined DLSS5_CUDA_DECODE set "DLSS5_CUDA_DECODE=auto"

set "PYTHON_EXE=%~dp0bin\python-3.13.15-embed-amd64\python.exe"
if not exist "%PYTHON_EXE%" (
    echo ERROR: The portable runtime is missing.
    echo Run install_clean_4090.bat for a clean installation.
    pause
    exit /b 1
)

rem Explicit profile commands remain available:
rem   start_4090.bat --diagnose
rem   start_4090.bat --restore
rem   start_4090.bat --apply --best-settings
if not "%~1"=="" (
    "%PYTHON_EXE%" "%~dp0tools\rtx4090_profile.py" %*
    set "RC=%ERRORLEVEL%"
    if not "%RC%"=="0" pause
    exit /b %RC%
)

echo Applying RTX 4090 balanced-performance settings...
"%PYTHON_EXE%" "%~dp0tools\rtx4090_profile.py" --apply --best-settings
if errorlevel 1 (
    echo.
    echo RTX 4090 profile application failed.
    pause
    exit /b 1
)

echo.
echo Launching the TypeScript primary UI with RTX 4090 settings...
call "%~dp0run_typescript_ui.bat"
exit /b %ERRORLEVEL%
