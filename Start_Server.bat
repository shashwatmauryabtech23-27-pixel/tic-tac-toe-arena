@echo off
title TicTacToe Tournament Server
color 0A
echo ============================================================
echo  TIC-TAC-TOE LAN TOURNAMENT SERVER
echo ============================================================
echo.
echo [1/3] Checking Node.js installation...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js from: https://nodejs.org/
    echo.
    pause
    exit
)
echo OK: Node.js is installed
echo.

echo [2/3] Finding your IP address...
echo Your IP addresses:
ipconfig | findstr /i "IPv4"
echo.

echo [3/3] Starting game server...
echo.
echo ============================================================
echo  SERVER IS RUNNING!
echo ============================================================
echo.
echo Players can connect using:
echo http://YOUR_IP:3000
echo.
echo Press Ctrl+C to stop the server
echo ============================================================
echo.
node server.js
pause