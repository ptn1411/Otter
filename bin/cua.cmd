@echo off
setlocal enabledelayedexpansion

:: Tim file thuc thi cua-driver.exe
set "CUA_BIN="

if exist "%~dp0..\tools\cua\cua-driver.exe" (
    set "CUA_BIN=%~dp0..\tools\cua\cua-driver.exe"
) else if exist "%~dp0tools\cua\cua-driver.exe" (
    set "CUA_BIN=%~dp0tools\cua\cua-driver.exe"
) else if exist "%LOCALAPPDATA%\Otter\tools\cua\cua-driver.exe" (
    set "CUA_BIN=%LOCALAPPDATA%\Otter\tools\cua\cua-driver.exe"
) else if exist "%USERPROFILE%\.cua-driver\packages\current\cua-driver.exe" (
    set "CUA_BIN=%USERPROFILE%\.cua-driver\packages\current\cua-driver.exe"
)

if defined CUA_BIN (
    "%CUA_BIN%" %*
    exit /b %errorlevel%
)

:: Fallback toi otter cua
where otter >nul 2>nul
if %errorlevel% equ 0 (
    otter cua %*
    exit /b %errorlevel%
)

echo [!] Khong tim thay cua-driver.exe hoac otter.exe tren he thong.
exit /b 1
