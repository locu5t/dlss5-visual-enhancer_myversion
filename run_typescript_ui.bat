@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul
title DLSS 5 Visual Enhancer - TypeScript UI
cls

set "PYTHONNOUSERSITE=1"
set "PYTHONDONTWRITEBYTECODE=1"
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"
set "GRADIO_ANALYTICS_ENABLED=False"
if not defined DLSS5_FAST_PREVIEW_NVENC set "DLSS5_FAST_PREVIEW_NVENC=1"
if not defined DLSS5_CUDA_DECODE set "DLSS5_CUDA_DECODE=auto"

set "PYTHON_EXE=%~dp0bin\python-3.13.15-embed-amd64\python.exe"
set "TS_INDEX=%~dp0dlss5-visual-enhancer_myversion_typescript\dist\index.html"
if not exist "%PYTHON_EXE%" (
    echo ERROR: The portable Python/native runtime is missing.
    echo Run install_clean_4090.bat for a clean portable installation.
    pause
    exit /b 1
)
if not exist "%TS_INDEX%" (
    echo ERROR: The TypeScript UI has not been built.
    echo.
    echo Run:
    echo   install_typescript_ui.bat
    echo.
    pause
    exit /b 1
)

echo Starting DLSS 5 TypeScript UI...
echo Local address: http://127.0.0.1:8765/
echo Press Ctrl+C in this window to stop the UI backend.
echo.
"%PYTHON_EXE%" -m src.typescript_api.server --host 127.0.0.1 --port 8765
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
    echo.
    echo ================================================================
    echo TypeScript UI backend exited with code %RC%.
    echo ================================================================
    if exist "%~dp0logs\typescript_ui.log" type "%~dp0logs\typescript_ui.log"
    echo.
    pause
)
exit /b %RC%
