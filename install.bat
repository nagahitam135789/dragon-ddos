@echo off
echo ========================================
echo Installing Dependencies for DDoS Tool
echo ========================================
echo.

echo Checking Node.js installation...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo Node.js found!
node --version
echo.

echo Installing npm packages...
echo.

npm install

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo Installation completed successfully!
    echo ========================================
    echo.
    echo You can now run: node serang.js
) else (
    echo.
    echo ========================================
    echo Installation failed!
    echo ========================================
)

echo.
pause

