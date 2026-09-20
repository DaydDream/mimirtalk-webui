@echo off
setlocal EnableExtensions
chcp 65001 >nul
title MimirTalk WebUI

set "ROOT=%~dp0"
set "PYTHON="
set "PYARGS="

if not "%~1"=="" (
  set "PORT=%~1"
) else (
  set "PORT=8765"
)
echo %PORT%| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 (
  call :fail "端口无效：%PORT%。请使用数字，例如 8765。"
  goto :eof
)

rem 优先使用仓库内置的 portable 运行时（若存在）
if exist "%ROOT%python-runtime\python.exe" (
  set "PYTHON=%ROOT%python-runtime\python.exe"
) else (
  where python >nul 2>nul
  if not errorlevel 1 (
    set "PYTHON=python"
  ) else (
    where py >nul 2>nul
    if not errorlevel 1 (
      set "PYTHON=py"
      set "PYARGS=-3"
    )
  )
)
if not defined PYTHON (
  call :fail "未找到 Python 3。请安装 Python 3.12+，或从 Releases 下载内置运行时的发布包。"
  goto :eof
)

netstat -ano -p TCP | findstr /r /c:"LISTENING" | findstr /r /c:":%PORT% " >nul
if not errorlevel 1 (
  call :fail "端口 %PORT% 已被占用。请关闭占用程序，或执行：启动WebUI.cmd 8766"
  goto :eof
)

"%PYTHON%" %PYARGS% -c "import PIL" >nul 2>nul
if errorlevel 1 (
  echo [SETUP] 正在安装依赖 Pillow ...
  "%PYTHON%" %PYARGS% -m pip install --disable-pip-version-check --quiet Pillow
  "%PYTHON%" %PYARGS% -c "import PIL" >nul 2>nul
  if errorlevel 1 (
    call :fail "Pillow 安装失败。请手动执行：%PYTHON% %PYARGS% -m pip install Pillow"
    goto :eof
  )
)

echo.
echo   MimirTalk WebUI
echo   URL:   http://127.0.0.1:%PORT%/
echo   Stop:  press Ctrl+C in this window
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:%PORT%/'"
"%PYTHON%" %PYARGS% "%ROOT%webui\backend\app.py" --host 127.0.0.1 --port %PORT%
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
  call :fail "服务异常退出，退出码 %RC%。"
) else (
  echo.
  echo [OK] 服务已停止。
)
goto :eof

:fail
echo.
echo [ERROR] %~1
echo.
echo 换端口启动：%~nx0 8766
echo.
pause
exit /b 1
