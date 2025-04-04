import os
import multiprocessing
import logging
import socket

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(('0.0.0.0', port))
            return False
        except socket.error:
            return True

# Get port from environment variable with validation
try:
    port = int(os.environ.get('PORT', '5000'))
    if port < 1 or port > 65535:
        raise ValueError(f"Invalid port number: {port}")
    
    # Check if port is available
    if is_port_in_use(port):
        logger.warning(f"Port {port} is already in use. Trying to find an available port...")
        for p in range(port, port + 10):
            if not is_port_in_use(p):
                port = p
                logger.info(f"Found available port: {port}")
                break
        else:
            raise RuntimeError("Could not find an available port")
    
    logger.info(f"Using port: {port}")
except Exception as e:
    logger.error(f"Error with PORT environment variable: {str(e)}")
    port = 5000  # Fallback to default port
    logger.info(f"Falling back to default port: {port}")

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

# Bind address with validation
try:
    bind = f"0.0.0.0:{port}"
    logger.info(f"Binding to: {bind}")
except Exception as e:
    logger.error(f"Error setting bind address: {str(e)}")
    bind = "0.0.0.0:5000"  # Fallback to default
    logger.info(f"Falling back to default bind address: {bind}")

# Worker class settings
worker_connections = 50  # Reduced connections to minimize memory usage

# Memory limits
worker_max_memory = 100 * 1024 * 1024  # 100MB in bytes
worker_max_memory_percent = 70  # 70% of available memory 