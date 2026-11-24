@echo off
title Dockside Voice Server
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.local\bin;%PATH%"
uv run --script server.py
echo.
echo The voice server stopped. Send Claude a photo of this window if that was unexpected.
pause
