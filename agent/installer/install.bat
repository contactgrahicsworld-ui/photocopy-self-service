@echo off
setlocal EnableDelayedExpansion
title Smart Photocopy - Print Agent Installer
color 0A

echo ============================================================
echo    SMART PHOTOCOPY - PRINT AGENT INSTALLER (Windows)
echo ============================================================
echo.

:: -- 1. Location ------------------------------------------------
set "INSTALLDIR=%ProgramFiles%\Smart Photocopy Agent"
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [i] No admin rights - installing to your user folder instead.
    set "INSTALLDIR=%LOCALAPPDATA%\Smart Photocopy Agent"
)
echo [1/6] Install folder: %INSTALLDIR%
if not exist "%INSTALLDIR%" mkdir "%INSTALLDIR%" || (echo [X] Cannot create folder & pause & exit /b 1)

:: -- 2. Copy agent ----------------------------------------------
echo [2/6] Copying agent...
copy /y "%~dp0SmartPhotocopyAgent.exe" "%INSTALLDIR%\SmartPhotocopyAgent.exe" >nul || (echo [X] Copy failed - run this .bat from the extracted folder & pause & exit /b 1)

:: -- 3. SumatraPDF (printing engine) ----------------------------
echo [3/6] Setting up SumatraPDF (printing engine)...
if exist "%INSTALLDIR%\SumatraPDF.exe" (
    echo       Already present, skipping.
) else (
    powershell -NoProfile -Command "try { [Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -Uri 'https://www.sumatrapdfreader.org/dl/rel/3.6.1/SumatraPDF-3.6.1-64.zip' -OutFile \"$env:TEMP\sumatra.zip\" -UseBasicParsing; Expand-Archive -Path \"$env:TEMP\sumatra.zip\" -DestinationPath \"$env:TEMP\sumatra\" -Force } catch { exit 1 }"
    if exist "%TEMP%\sumatra\SumatraPDF-3.6.1-64.exe" (
        echo       Installing SumatraPDF silently...
        "%TEMP%\sumatra\SumatraPDF-3.6.1-64.exe" -s -d "%INSTALLDIR%" >nul 2>&1
        if not exist "%INSTALLDIR%\SumatraPDF.exe" (
            "%TEMP%\sumatra\SumatraPDF-3.6.1-64.exe" /S /D=%INSTALLDIR% >nul 2>&1
        )
    )
    if not exist "%INSTALLDIR%\SumatraPDF.exe" (
        echo.
        echo [!] SumatraPDF auto-install did not finish. Please install it once manually:
        echo     https://www.sumatrapdfreader.org/download-free-pdf-viewer
        echo     (it is free, 10 MB, next-next-finish). The agent will find it automatically.
        echo.
    ) else (
        echo       SumatraPDF installed.
    )
)

:: -- 4. Pairing -------------------------------------------------
echo [4/6] Pairing with your shop...
set "PAIRCODE=%~1"
if "%PAIRCODE%"=="" (
    echo       Get a pairing code: Shop Dashboard - Printers and devices - Add device
    set /p PAIRCODE="      Paste the pairing code here: "
)
if "%PAIRCODE%"=="" (echo [X] No pairing code entered. Run install.bat again or: SmartPhotocopyAgent.exe --pair CODE & pause & exit /b 1)
cd /d "%INSTALLDIR%"
SmartPhotocopyAgent.exe --pair %PAIRCODE%
if %errorlevel% neq 0 (echo [X] Pairing failed. Check the code and your internet. & pause & exit /b 1)

:: -- 5. Auto-start ----------------------------------------------
echo [5/6] Setting up auto-start at logon...
schtasks /Create /F /SC ONLOGON /TN "SmartPhotocopyAgent" /TR "\"%INSTALLDIR%\SmartPhotocopyAgent.exe\"" >nul 2>&1
if %errorlevel% equ 0 (echo       Scheduled task created.) else (echo [!] Could not create scheduled task - start the agent manually after reboot.)

:: -- 6. Start ---------------------------------------------------
echo [6/6] Starting agent...
start "" "%INSTALLDIR%\SmartPhotocopyAgent.exe"
echo.
echo ============================================================
echo    DONE! The agent is running.
echo.
echo    Test it: place a small order from your shop QR page,
echo    verify the UTR in your dashboard, and watch the print
echo    come out. Keep this PC switched on during shop hours.
echo.
echo    Files: %INSTALLDIR%
echo    Logs:  %INSTALLDIR%\agent.log
echo    Remove any time with uninstall.bat
echo ============================================================
echo.
pause
