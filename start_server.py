import os
import subprocess
import sys
import time
import socket

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(('0.0.0.0', port))
            return False
        except socket.error:
            return True

def start_server():
    # Get port from environment variable or use default
    port = int(os.environ.get('PORT', 5000))
    
    # Check if port is available
    if is_port_in_use(port):
        print(f"Port {port} is already in use. Trying to find an available port...")
        for p in range(port, port + 10):
            if not is_port_in_use(p):
                port = p
                print(f"Found available port: {port}")
                break
        else:
            print("Could not find an available port")
            sys.exit(1)
    
    # Set the port in environment
    os.environ['PORT'] = str(port)
    
    # Start the server using gunicorn
    try:
        cmd = [
            'gunicorn',
            '--config', 'gunicorn_config.py',
            '--bind', f'0.0.0.0:{port}',
            'face_verification_server:app'
        ]
        
        print(f"Starting server on port {port}...")
        subprocess.run(cmd)
    except Exception as e:
        print(f"Error starting server: {e}")
        sys.exit(1)

if __name__ == '__main__':
    start_server() 