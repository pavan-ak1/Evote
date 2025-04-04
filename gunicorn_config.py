import multiprocessing
import os

# Number of workers
workers = 1  # Single worker to minimize memory usage
worker_class = 'sync'  # Use sync worker class for better memory management
threads = 1  # Single thread per worker

# Timeouts
timeout = 600  # Increased timeout for model initialization
graceful_timeout = 120
keepalive = 2

# Worker settings
max_requests = 20  # Restart worker more frequently
max_requests_jitter = 5  # Add some randomness to prevent all workers from restarting at once

# Memory management
preload_app = False  # Disable preloading to prevent memory issues
worker_tmp_dir = "/tmp"  # Use regular tmp directory instead of shared memory
max_worker_lifetime = 1800  # Restart worker every 30 minutes

# Process naming
proc_name = 'face_verification'

# Logging
accesslog = "-"  # Log to stdout
errorlog = "-"   # Log to stdout
loglevel = "info"

# Bind address
bind = "0.0.0.0:" + str(os.environ.get('PORT', '5000'))

# Worker class settings
worker_connections = 100  # Reduced connections to minimize memory usage

# Memory limits
worker_max_memory = 150 * 1024 * 1024  # 150MB in bytes
worker_max_memory_percent = 80  # 80% of available memory 