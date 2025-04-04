#!/bin/bash

# Exit on error
set -e

echo "Starting build process..."

# Install Python dependencies with optimization
echo "Installing Python dependencies..."
pip install --no-cache-dir -r requirements.txt

# Create necessary directories
echo "Creating required directories..."
mkdir -p deepface_weights/.deepface/weights

# Copy model file
echo "Copying model file..."
if [ -f "facenet_keras.h5" ]; then
    cp facenet_keras.h5 deepface_weights/.deepface/weights/
else
    echo "Warning: facenet_keras.h5 not found!"
fi

# Clean up
echo "Cleaning up..."
find /usr/local/lib/python* -type d -name "tests" -exec rm -rf {} +
find /usr/local/lib/python* -type d -name "__pycache__" -exec rm -rf {} +
find /usr/local/lib/python* -type f -name "*.pyc" -delete
find /usr/local/lib/python* -type f -name "*.pyo" -delete
find /usr/local/lib/python* -type f -name "*.pyd" -delete
rm -rf /root/.cache/pip

echo "Build completed successfully" 