import os
import multiprocessing

# Number of workers
workers = 1  # Single worker to minimize memory usage

# Worker class
worker_class = 'sync'  # Using sync workers for better memory management

# Timeouts
timeout = 120  # 2 minutes
graceful_timeout = 30  # 30 seconds

# Memory management
max_requests = 5  # Restart workers after 5 requests
max_requests_jitter = 1  # Add some randomness to prevent all workers from restarting at once

# Disable preload to reduce memory usage
preload_app = False

# Set worker temporary directory
worker_tmp_dir = "/tmp"

# Maximum worker lifetime
max_worker_lifetime = 600  # 10 minutes

# Worker connections
worker_connections = 20  # Reduced from default

# Memory limits
worker_max_memory = 50 * 1024 * 1024  # 50MB
worker_max_memory_percent = 50  # 50% of available memory

# Logging
accesslog = "-"
errorlog = "-"
loglevel = "info"

# Bind address - use the PORT environment variable or default to 5000
bind = f"0.0.0.0:{os.environ.get('PORT', '5000')}"

# Worker class settings
worker_connections = 50  # Reduced connections to minimize memory usage

# Memory limits
worker_max_memory = 100 * 1024 * 1024  # 100MB in bytes
worker_max_memory_percent = 70  # 70% of available memory 