@echo off
setlocal EnableExtensions
cd /d "%~dp0"
call "%~dp0run_typescript_ui.bat"
exit /b %ERRORLEVEL%
