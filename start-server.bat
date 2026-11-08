@echo off
cd /d "%~dp0"
echo Serving VTM Role Recorder at http://127.0.0.1:8000
echo Press Ctrl+C to stop the server.
py -m http.server 8000 --bind 127.0.0.1
pause
