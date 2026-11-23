@echo off
chcp 65001 >nul
title Series and Movies for My Love - Convertir peliculas
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Instalando Node.js...
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  echo.
  echo Cierra esta ventana y vuelve a abrir CONVERTIR_TODAS.bat
  pause
  exit /b
)
where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo Instalando FFmpeg...
  winget install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
  echo.
  echo Cierra esta ventana y vuelve a abrir CONVERTIR_TODAS.bat
  pause
  exit /b
)

echo Elige el modo:
echo   1 = Maxima calidad (lento, recomendado)
echo   2 = Rapido (para probar)
set /p MODO="Opcion [1]: "
set EXTRA=
if "%MODO%"=="2" set EXTRA=--rapido

rem Evita que Windows se suspenda mientras convierte
powercfg /change standby-timeout-ac 0 >nul 2>nul

node "%~dp0convertir-todas.mjs" "%~dp0.." %EXTRA%

powercfg /change standby-timeout-ac 30 >nul 2>nul
pause
