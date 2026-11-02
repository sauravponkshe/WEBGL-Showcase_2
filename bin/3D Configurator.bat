@echo off
title Configurator
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_wce_start_server.ps1"
pause
