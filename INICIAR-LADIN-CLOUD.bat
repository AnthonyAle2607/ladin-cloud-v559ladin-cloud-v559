@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
  if errorlevel 1 (
    echo ERROR instalando dependencias.
    pause
    exit /b 1
  )
)
echo.
echo Iniciando Ladin Cloud...
call npm start
pause
