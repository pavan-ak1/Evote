#!/bin/bash

# Exit on error
set -e

echo "Starting build process..."

# Install system dependencies
echo "Installing system dependencies..."
apt-get update && apt-get install -y \
    build-essential \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
echo "Installing Python dependencies..."
pip install --no-cache-dir -r requirements.txt

# Make sure the script exits with success
echo "Build completed successfully"
exit 0 