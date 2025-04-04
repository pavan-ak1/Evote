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
    python3-dev \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Create necessary directories
echo "Creating required directories..."
mkdir -p deepface_weights/.deepface/weights
mkdir -p temp

# Install Python dependencies
echo "Installing Python dependencies..."
pip install --no-cache-dir -r requirements.txt

# Set proper permissions
echo "Setting permissions..."
chmod +x start.sh

# Make sure the script exits with success
echo "Build completed successfully"
exit 0 