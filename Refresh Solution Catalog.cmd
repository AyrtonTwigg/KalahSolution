@echo off
setlocal
cd /d "%~dp0"
set "PYTHON_EXE=%LocalAppData%\Programs\Python\Python311\python.exe"
if exist "%PYTHON_EXE%" (
    "%PYTHON_EXE%" -B rebuild_catalog.py
) else (
    py -3.11 -B rebuild_catalog.py
)
pause
