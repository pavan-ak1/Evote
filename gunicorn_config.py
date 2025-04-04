import multiprocessing
import os

# Number of workers
workers = 1  # Single worker to minimize memory usage
worker_class = 'sync'  # Use sync worker class for better memory management
threads = 1  # Single thread per worker

# Timeouts
timeout = 300  # Increased timeout for model initialization
graceful_timeout = 60
keepalive = 2

# Worker settings
max_requests = 50  # Restart worker more frequently
max_requests_jitter = 10  # Add some randomness to prevent all workers from restarting at once

# Memory management
preload_app = False  # Disable preloading to prevent memory issues
worker_tmp_dir = "/tmp"  # Use regular tmp directory instead of shared memory
max_worker_lifetime = 3600  # Restart worker every hour

# Process naming
proc_name = 'face_verification'

# Logging
accesslog = "-"  # Log to stdout
errorlog = "-"   # Log to stdout
loglevel = "info"

# Bind address
bind = "0.0.0.0:" + str(os.environ.get('PORT', '5000'))

# Worker class settings
worker_connections = 1000 