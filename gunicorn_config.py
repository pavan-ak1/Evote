import multiprocessing

# Number of workers
workers = 1  # Reduced to 1 worker to minimize memory usage
worker_class = 'sync'  # Use sync worker class for better memory management
threads = 1  # Single thread per worker

# Timeouts
timeout = 120  # Increased timeout for model initialization
graceful_timeout = 30
keepalive = 2

# Worker settings
max_requests = 100  # Restart worker after 100 requests
max_requests_jitter = 20  # Add some randomness to prevent all workers from restarting at once

# Memory management
preload_app = True  # Preload the application to share memory between workers
worker_tmp_dir = "/dev/shm"  # Use shared memory for temporary files

# Logging
accesslog = "-"  # Log to stdout
errorlog = "-"   # Log to stdout
loglevel = "info"

# Bind address
bind = "0.0.0.0:5000" 