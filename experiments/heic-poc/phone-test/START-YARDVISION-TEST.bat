@echo off
title YardVision S25 Local HEIC Photo Test
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to host the local photo test.
  echo Your regular YardVision development PC may already have it installed.
  echo Install Node.js from https://nodejs.org/ if needed.
  pause
  exit /b 1
)
node server.cjs
echo Test server stopped.
pause
