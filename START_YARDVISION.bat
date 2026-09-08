@echo off
cd /d "%~dp0"
echo Installing/checking dependencies...
call npm install
echo.
echo Starting YardVision AI v8 STAGING BUILD on port 3018...
echo Browser: http://localhost:3018
echo.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3018"
call npm start
pause
