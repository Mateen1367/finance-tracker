@echo off
title My Money
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo First run: setting things up. This takes a few minutes...
  python -m venv .venv
  .venv\Scripts\python.exe -m pip install -q -r requirements.txt
)
if not exist web\dist\index.html (
  echo Building the app...
  set "PATH=%~dp0.venv\Scripts;%PATH%"
  pushd web
  call ..\.venv\Scripts\npm.exe install --no-fund --no-audit
  call ..\.venv\Scripts\npm.exe run build
  popd
)
echo.
echo  My Money is running at http://localhost:8501
echo  Keep this window open while you use the app. Close it to stop.
echo.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8501"
.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8501 --log-level warning
