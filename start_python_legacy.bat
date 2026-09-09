@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul
title DLSS 5 Visual Enhancer - Legacy Python UI
cls
set "PYTHONNOUSERSITE=1"
set "PYTHONDONTWRITEBYTECODE=1"
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"
set "GRADIO_ANALYTICS_ENABLED=False"
"%~dp0bin\python-3.13.15-embed-amd64\python.exe" "%~dp0app.py"
if errorlevel 1 pause
