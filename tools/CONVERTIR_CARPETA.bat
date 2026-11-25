@echo off
chcp 65001 >nul
title Series and Movies For My Love Aleshito - Convertir una carpeta
cd /d "%~dp0"

rem Uso: arrastra una carpeta con videos (pelicula o temporada de serie) encima de este archivo.
set "CARPETA=%~1"
if "%CARPETA%"=="" set /p CARPETA="Pega la ruta de la carpeta con los videos: "
set "CARPETA=%CARPETA:"=%"
if not exist "%CARPETA%\" (
  echo No existe la carpeta: %CARPETA%
  pause
  exit /b
)

where node >nul 2>nul || (echo Falta Node.js: winget install -e --id OpenJS.NodeJS.LTS & pause & exit /b)
where ffmpeg >nul 2>nul || (echo Falta FFmpeg: winget install -e --id Gyan.FFmpeg & pause & exit /b)

echo Carpeta: %CARPETA%
echo Salida:  %~dp0..\salida
echo.
echo Elige el modo:
echo   1 = Tarjeta de video / GPU  (RECOMENDADO)
echo   2 = Procesador, rapido
echo   3 = Procesador, maxima calidad (MUY lento)
set /p MODO="Opcion [1]: "
set EXTRA=--gpu auto
if "%MODO%"=="2" set EXTRA=--rapido
if "%MODO%"=="3" set EXTRA=

powercfg /change standby-timeout-ac 0 >nul 2>nul
node "%~dp0convertir-todas.mjs" "%CARPETA%" --salida "%~dp0..\salida" %EXTRA%
powercfg /change standby-timeout-ac 30 >nul 2>nul
pause
