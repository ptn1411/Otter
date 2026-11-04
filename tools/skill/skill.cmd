@echo off
setlocal
set SCRIPT_DIR=%~dp0
if exist "%SCRIPT_DIR%skill.exe" (
  "%SCRIPT_DIR%skill.exe" %*
) else (
  bun "%SCRIPT_DIR%skill.ts" %*
)


