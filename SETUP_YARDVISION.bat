@echo off
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
start notepad .env
echo.
echo YardVision AI v8 local test setup
echo Add your OpenAI API key.
echo Keep PORT=3018 and APP_BASE_URL=http://localhost:3018 locally.
echo PostgreSQL, R2/S3, Resend and Stripe can be added for staging.
pause
