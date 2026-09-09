@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul
title DLSS 5 Visual Enhancer - RTX 4090 Legacy Python UI
set "PYTHON_EXE=%~dp0bin\python-3.13.15-embed-amd64\python.exe"
if not defined DLSS5_NVENC_PRESET set "DLSS5_NVENC_PRESET=p5"
if not defined DLSS5_FAST_PREVIEW_NVENC set "DLSS5_FAST_PREVIEW_NVENC=1"
if not defined DLSS5_CUDA_DECODE set "DLSS5_CUDA_DECODE=auto"
"%PYTHON_EXE%" "%~dp0tools\rtx4090_profile.py" --apply --best-settings
if errorlevel 1 pause & exit /b 1
call "%~dp0start_python_legacy.bat"
exit /b %ERRORLEVEL%
