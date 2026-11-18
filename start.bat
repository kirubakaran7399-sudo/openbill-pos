@echo off
title The Retro Cafeteria - Billing POS Terminal
cd /d "%~dp0"
echo ========================================================
echo   Starting The Retro Cafeteria Billing POS Software...
echo ========================================================
python server.py
pause
