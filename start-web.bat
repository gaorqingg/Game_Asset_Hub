@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
set "HOST=0.0.0.0"
set "OPEN_HOST=127.0.0.1"
set "START_PORT=5173"
set "END_PORT=5199"
set "PORT="

cd /d "%ROOT%"

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Please install Node.js and make sure npm is available in PATH.
  pause
  exit /b 1
)

echo Looking for an available port from %START_PORT% to %END_PORT%...
for /l %%P in (%START_PORT%,1,%END_PORT%) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$port=%%P; if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { exit 1 } exit 0" >nul 2>nul
  if not errorlevel 1 (
    set "PORT=%%P"
    goto :PORT_FOUND
  )
)

echo [ERROR] No available port found in %START_PORT%-%END_PORT%.
pause
exit /b 1

:PORT_FOUND
set "URL=http://%OPEN_HOST%:%PORT%/"
set "LISTEN_URL=http://%HOST%:%PORT%/"
echo Starting Game Asset Hub at %LISTEN_URL%
echo Local browser URL: %URL%
start "Game Asset Hub - %PORT%" /D "%ROOT%" cmd /k "set HOST=%HOST%&& set PORT=%PORT%&& npm run dev"

echo Waiting for service health check...
set /a ATTEMPTS=0

:WAIT_HEALTH
set /a ATTEMPTS+=1
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri '%URL%api/health' -TimeoutSec 2; if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { exit 0 } } catch {} exit 1" >nul 2>nul
if not errorlevel 1 goto :OPEN_BROWSER

if %ATTEMPTS% GEQ 60 (
  echo [ERROR] Service did not become ready within 60 seconds.
  echo Please check the Game Asset Hub service window for details.
  pause
  exit /b 1
)

timeout /t 1 /nobreak >nul
goto :WAIT_HEALTH

:OPEN_BROWSER
echo Service is ready. Opening browser...
start "" "%URL%"
exit /b 0
