@echo off
chcp 65001 >nul
title ApplyPilot - local server
cd /d "%~dp0server"
where node >nul 2>nul || (
  echo Node.js was not found. Install it from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies - first run only...
  call npm install --no-audit --no-fund || (
    echo npm install failed.
    pause
    exit /b 1
  )
)
node src\index.js
pause
