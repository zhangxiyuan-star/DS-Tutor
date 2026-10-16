@echo off
chcp 65001 >nul
REM ============================================================
REM 数据结构陪学 Agent —— Windows exe 打包脚本
REM 前置：pip install pyinstaller pywebview
REM ============================================================

cd /d %~dp0

echo [1/2] 开始打包（首次约 1-3 分钟）...
pyinstaller --noconfirm --clean ^
  --name DSTutor ^
  --windowed ^
  --add-data "web;web" ^
  app.py

if errorlevel 1 (
  echo.
  echo [失败] 打包未成功，请查看上方日志。
  pause
  exit /b 1
)

echo.
echo [2/2] 打包完成！
echo 可执行文件： %~dp0dist\DSTutor\DSTutor.exe
echo.
pause
