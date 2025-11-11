#!/bin/bash

echo "========================================"
echo "Installing Dependencies for DDoS Tool"
echo "========================================"
echo ""

echo "Checking Node.js installation..."
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed!"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

echo "Node.js found!"
node --version
echo ""

echo "Installing npm packages..."
echo ""

npm install

if [ $? -eq 0 ]; then
    echo ""
    echo "========================================"
    echo "Installation completed successfully!"
    echo "========================================"
    echo ""
    echo "You can now run: node serang.js"
else
    echo ""
    echo "========================================"
    echo "Installation failed!"
    echo "========================================"
fi

