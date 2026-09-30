@echo off
REM Rebuild the web app after pulling new code from GitHub.
cd /d "%~dp0"
.venv\Scripts\python.exe -m pip install -q -r requirements.txt
pushd web
call ..\.venv\Scripts
pm.exe install --no-fund --no-audit
call ..\.venv\Scripts
pm.exe run build
popd
echo Done. Start the app with run.bat
pause
