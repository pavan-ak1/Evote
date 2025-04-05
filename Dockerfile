# Build stage
FROM python:3.11-slim as builder

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    libopenblas-dev \
    liblapack-dev \
    libjpeg-dev \
    libpng-dev \
    libtiff-dev \
    libavcodec-dev \
    libavformat-dev \
    libswscale-dev \
    libv4l-dev \
    libxvidcore-dev \
    libx264-dev \
    libgtk-3-dev \
    libatlas-base-dev \
    gfortran \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first to leverage Docker cache
COPY requirements.txt .

# Install Python dependencies with specific versions
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
    tensorflow==2.15.0 \
    deepface==0.0.79 \
    opencv-python-headless==4.8.1.78 \
    numpy==1.24.3 \
    pillow==10.0.0 \
    psutil==5.9.8 \
    flask==2.3.3 \
    flask-cors==4.0.0 \
    gunicorn==21.2.0

# Final stage
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install only runtime dependencies
RUN apt-get update && apt-get install -y \
    libopenblas0 \
    liblapack3 \
    libjpeg62-turbo \
    libpng16-16 \
    libtiff6 \
    libavcodec59 \
    libavformat59 \
    libswscale6 \
    libv4l-0 \
    libxvidcore4 \
    libx264-164 \
    libgtk-3-0 \
    libatlas3-base \
    curl \
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Copy Python packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages/ /usr/local/lib/python3.11/site-packages/
COPY --from=builder /usr/local/bin/ /usr/local/bin/

# Create necessary directories
RUN mkdir -p /app/deepface_weights/.deepface/weights /app/temp

# Copy application code
COPY . .

# Set environment variables
ENV PORT=5001
ENV PYTHONUNBUFFERED=1
ENV DEEPFACE_HOME=/app/deepface_weights
ENV CUDA_VISIBLE_DEVICES=-1
ENV TF_CPP_MIN_LOG_LEVEL=2
ENV TF_FORCE_GPU_ALLOW_GROWTH=true

# Create startup script with optimized Gunicorn settings
RUN echo '#!/bin/bash\n\
echo "Starting server on port $PORT..."\n\
gunicorn --bind 0.0.0.0:$PORT \
    --workers 1 \
    --threads 4 \
    --timeout 120 \
    --max-requests 1000 \
    --max-requests-jitter 50 \
    --worker-class gthread \
    --log-level info \
    face_verification_server:app\n\
' > /app/start.sh && chmod +x /app/start.sh

# Expose the port
EXPOSE 5001

# Add healthcheck with better timeout and retry settings
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:5001/health || exit 1

# Command to run the application
CMD ["/app/start.sh"] 