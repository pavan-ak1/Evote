import os

# Basic configuration
workers = 1
worker_class = 'sync'
threads = 1

# Timeouts
timeout = 120
graceful_timeout = 30

# Worker settings
max_requests = 5
max_requests_jitter = 1

# Memory management
preload_app = False
worker_tmp_dir = "/tmp"

# Logging
accesslog = "-"
errorlog = "-"
loglevel = "info"

# Bind address
bind = "0.0.0.0:" + str(os.environ.get('PORT', '5000'))

# Worker class settings
worker_connections = 50  # Reduced connections to minimize memory usage

# Memory limits
worker_max_memory = 100 * 1024 * 1024  # 100MB in bytes
worker_max_memory_percent = 70  # 70% of available memory 