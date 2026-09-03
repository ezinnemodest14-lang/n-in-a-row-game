@echo off
setlocal
rem ============================================================
rem  N-in-a-Row - portable launcher
rem  Works on any Windows machine. No Node.js install required.
rem  (Node runtime must be in runtime\node.exe - see scripts/bundle.cmd)
rem ============================================================
set "BASEDIR=%~dp0"
set "DATABASE_URL=file:/%BASEDIR:\=/%db/custom.db"
set "PORT=3000"
set "HOSTNAME=0.0.0.0"

echo ============================================
echo   N-in-a-Row Game Server
echo   Database: %DATABASE_URL%
echo   Opening http://localhost:%PORT% ...
echo ============================================

start "" http://localhost:%PORT%
"%BASEDIR%runtime\node.exe" "%BASEDIR%server.js"
pause
