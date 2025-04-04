#!/bin/bash

# Exit on error
set -e

echo "Starting build process..."

# Install Python dependencies
echo "Installing Python dependencies..."
pip install -r requirements.txt

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

echo "Build completed successfully" 