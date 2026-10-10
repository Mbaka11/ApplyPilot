@echo off
chcp 65001 >nul
title ApplyPilot - serveur local
cd /d "%~dp0server"
where node >nul 2>nul || (
  echo Node.js est introuvable. Installe-le depuis https://nodejs.org puis relance ce fichier.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installation des dependances, une seule fois...
  call npm install --no-audit --no-fund || (
    echo Echec de npm install.
    pause
    exit /b 1
  )
)
node src\index.js
pause
