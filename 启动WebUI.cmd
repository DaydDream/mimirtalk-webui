@echo off
setlocal EnableExtensions
title MimirTalk WebUI

set "ROOT=%~dp0"
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8765"

echo %PORT%| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 (
  echo.
  echo [ERROR] Invalid port: %PORT%
  echo         Use a number, for example 8765
  pause
  exit /b 1
)

echo.
echo   MimirTalk WebUI
echo   Starting on port %PORT% ...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%Start-WebUI.ps1" %PORT%
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
  echo.
  echo [ERROR] Startup failed with exit code %RC%.
  pause
)
exit /b %RC%
