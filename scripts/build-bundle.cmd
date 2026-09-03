@echo off
setlocal enabledelayedexpansion
rem ============================================================
rem  build-bundle.cmd - builds the portable Windows bundle:
rem    1. npm run build  (next build + postbuild assembly)
rem    2. copies node.exe into the bundle
rem    3. zips everything into download\n-in-a-row-portable-win64.zip
rem  Usage: scripts\build-bundle.cmd [path\to\node.exe]
rem ============================================================
cd /d "%~dp0.."

set "NODE_SRC=%~1"
if "%NODE_SRC%"=="" (
  for /f "delims=" %%i in ('where node 2^>nul') do (
    if not defined NODE_SRC set "NODE_SRC=%%i"
  )
)
if "%NODE_SRC%"=="" (
  echo ERROR: node.exe not found. Pass its path: build-bundle.cmd C:\path\node.exe
  exit /b 1
)

echo [1/3] Building...
call npm run build || exit /b 1

echo [2/3] Bundling Node runtime from %NODE_SRC% ...
if not exist ".next\standalone\runtime" mkdir ".next\standalone\runtime"
copy /y "%NODE_SRC%" ".next\standalone\runtime\node.exe" >nul || exit /b 1

echo [3/3] Creating zip...
if not exist "download" mkdir "download"
powershell -NoProfile -Command "Compress-Archive -Path '.next\standalone\*' -DestinationPath 'download\n-in-a-row-portable-win64.zip' -Force"

echo.
echo DONE: download\n-in-a-row-portable-win64.zip
