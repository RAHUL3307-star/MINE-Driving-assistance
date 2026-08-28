@echo off
title OREGUARD Bridge Server
echo ========================================================
echo   OREGUARD MINE VEHICLE - BRIDGE SERVER
echo ========================================================
echo.
echo Starting server at http://localhost:5173/index.html ...
start http://localhost:5173/index.html
node server.js
pause
