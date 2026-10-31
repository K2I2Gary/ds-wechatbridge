@echo off
chcp 65001 >nul 2>nul
cd /d "%~dp0"
title DSH - WeChat bridge

rem ---- 用 whale-girl 自带的 Python（依赖全在里面，不用另装）----
rem 把下面的路径改成你机器上 whale-girl 目录的实际位置
set "WG=%~dp0..\whale-runtime"
set "PY=%WG%\runtime\python\python.exe"

if not exist "%PY%" (
  echo.
  echo   [!] 找不到 whale-girl 的 Python：
  echo       %PY%
  echo.
  echo   把本文件里的 WG= 那行改成 whale-girl 目录的实际路径，
  echo   同时把 bridge\config.json 里的 whale_root 改成一样的。
  echo.
  pause
  exit /b 1
)

rem 代理会挡住本机 127.0.0.1 的请求，清掉
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "ALL_PROXY="
set "http_proxy="
set "https_proxy="
set "all_proxy="

echo.
echo   ==========================================
echo     DSH - WeChat bridge
echo   ==========================================
echo.
echo   Need: 微信 4.x 已登录
echo   Need: DSH 已启动，并且装了 dsh-wechat-bridge 插件
echo.
echo   Press Ctrl+C to stop.
echo.
echo   ------------------------ log ------------------------

"%PY%" "%~dp0bridge\wechat_bridge.py"

echo.
echo Bridge exited with code %ERRORLEVEL%.
echo Log: %~dp0bridge\bridge.log
pause >nul
