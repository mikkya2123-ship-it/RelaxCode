@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Snitch
echo Запускаю Snitch...
node src\cli.mjs serve --open %*
if errorlevel 1 (
  echo.
  echo Не удалось запустить. Проверьте, что установлен Node.js 20+ и команда node доступна.
  pause
)
