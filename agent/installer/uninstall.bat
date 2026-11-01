@echo off
title Smart Photocopy - Print Agent Uninstaller
echo Stopping agent...
taskkill /f /im SmartPhotocopyAgent.exe >nul 2>&1
schtasks /Delete /F /TN "SmartPhotocopyAgent" >nul 2>&1
set "INSTALLDIR=%ProgramFiles%\Smart Photocopy Agent"
if not exist "%INSTALLDIR%\SmartPhotocopyAgent.exe" set "INSTALLDIR=%LOCALAPPDATA%\Smart Photocopy Agent"
if exist "%INSTALLDIR%" (
    echo Removing %INSTALLDIR% ...
    rd /s /q "%INSTALLDIR%"
)
echo.
echo Smart Photocopy Agent removed.
echo (Shop Dashboard - Printers and devices: delete the device entry too.)
pause
