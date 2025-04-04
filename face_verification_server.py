import os
os.environ['CUDA_VISIBLE_DEVICES'] = '-1'  # Disable GPU
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'  # Reduce TensorFlow logging
os.environ['TF_FORCE_GPU_ALLOW_GROWTH'] = 'true'  # Prevent TensorFlow from allocating all GPU memory

# Import TensorFlow before other imports
import tensorflow as tf
tf.config.set_visible_devices([], 'GPU')  # Ensure GPU is disabled
tf.config.threading.set_inter_op_parallelism_threads(1)  # Limit thread usage
tf.config.threading.set_intra_op_parallelism_threads(1)

# Set memory growth for TensorFlow
gpus = tf.config.list_physical_devices('GPU')
if gpus:
    try:
        for gpu in gpus:
            tf.config.experimental.set_memory_growth(gpu, True)
    except RuntimeError as e:
        print(e)

from flask import Flask, request, jsonify
from flask_cors import CORS
from deepface import DeepFace
import numpy as np
import base64
import cv2
import os
from datetime import datetime
import requests
import json
from io import BytesIO
from PIL import Image
import io
import time
import gc  # Garbage collection
import psutil  # Process and system utilities
import threading
from queue import Queue
import logging
from concurrent.futures import ThreadPoolExecutor
import tempfile

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create temp directory
temp_dir = os.path.join(os.getcwd(), 'temp')
if not os.path.exists(temp_dir):
    os.makedirs(temp_dir)
    logger.info(f"Created temp directory: {temp_dir}")

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# Backend API configuration
BACKEND_URL = os.environ.get('BACKEND_URL', 'http://localhost:3000')
BACKEND_API_KEY = os.environ.get('BACKEND_API_KEY', 'your-api-key')

# Global variables for memory management
request_queue = Queue(maxsize=1)  # Limit concurrent requests
models_initialized = False
model_lock = threading.Lock()
executor = ThreadPoolExecutor(max_workers=1)  # Single worker thread pool

# Set DeepFace model directory to a writable location
DEEPFACE_DIR = os.path.join(os.getcwd(), '.deepface')
os.makedirs(DEEPFACE_DIR, exist_ok=True)
os.environ['DEEPFACE_HOME'] = DEEPFACE_DIR
logger.info(f"DeepFace directory set to: {DEEPFACE_DIR}")

def manage_memory():
    """Aggressive memory management"""
    gc.collect()
    gc.set_threshold(100, 5, 5)  # More aggressive garbage collection
    
    # Check memory usage
    process = psutil.Process(os.getpid())
    memory_usage = process.memory_info().rss / 1024 / 1024  # Convert to MB
    if memory_usage > 200:  # If memory usage exceeds 200MB
        logger.warning(f"High memory usage detected: {memory_usage:.2f}MB")
        gc.collect()  # Force garbage collection

def initialize_models():
    """Initialize DeepFace models with a minimal test image"""
    try:
        # Create a minimal test image
        test_image = np.zeros((16, 16, 3), dtype=np.uint8)
        # Test DeepFace with minimal configuration
        DeepFace.verify(test_image, test_image, model_name='Facenet', detector_backend='skip')
        logger.info("DeepFace models initialized successfully")
        return True
    except Exception as e:
        logger.error(f"Error initializing DeepFace models: {str(e)}")
        return False

def process_request(func):
    """Decorator to handle request queuing and memory management"""
    def wrapped(*args, **kwargs):
        try:
            # Wait for queue slot
            request_queue.put(True, timeout=30)  # 30 second timeout
            
            # Initialize models if needed
            if not models_initialized and not initialize_models():
                return jsonify({
                    'success': False,
                    'message': 'Service is initializing, please try again in a few seconds'
                }), 503
            
            # Process request in thread pool
            future = executor.submit(func, *args, **kwargs)
            result = future.result(timeout=30)  # 30 second timeout
            
            return result
        except Exception as e:
            logger.error(f"Request processing error: {str(e)}")
            return jsonify({
                'success': False,
                'message': str(e)
            }), 500
        finally:
            try:
                request_queue.get_nowait()  # Release queue slot
            except:
                pass
            manage_memory()
    wrapped.__name__ = func.__name__  # Preserve the original function name
    return wrapped

@app.route('/', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'message': 'Service is running'
    }), 200

@app.route('/verify', methods=['POST'])
def verify_face():
    try:
        manage_memory()  # Check memory before processing
        
        data = request.get_json()
        if not data or 'faceImage' not in data:
            return jsonify({
                'success': False,
                'message': 'Missing required field: faceImage'
            }), 400

        # Process image in memory
        image_data = data['faceImage'].split(',')[1] if ',' in data['faceImage'] else data['faceImage']
        nparr = np.frombuffer(base64.b64decode(image_data), np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        # Convert BGR to RGB
        rgb_img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        
        try:
            # Verify face using DeepFace with optimized settings
            result = DeepFace.verify(
                rgb_img, 
                rgb_img, 
                model_name='Facenet',
                detector_backend='skip',  # Skip face detection for self-comparison
                enforce_detection=False,  # Don't enforce face detection
                distance_metric='cosine'  # Use cosine distance for better performance
            )
            
            return jsonify({
                'success': True,
                'verified': result['verified'],
                'distance': float(result['distance']),
                'threshold': float(result['threshold'])
            })
        except Exception as e:
            if "No face detected" in str(e):
                return jsonify({
                    'success': False,
                    'message': 'No face detected in the image'
                }), 400
            raise e
            
    except Exception as e:
        logger.error(f"Verification error: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'Error verifying face: {str(e)}'
        }), 500

@app.route('/register', methods=['POST'])
@process_request
def register_face():
    try:
        data = request.get_json()
        if not data or 'userId' not in data or 'faceImage' not in data:
            return jsonify({
                'success': False,
                'message': 'Missing required fields: userId and faceImage'
            }), 400

        # Process image in memory
        image_data = data['faceImage'].split(',')[1] if ',' in data['faceImage'] else data['faceImage']
        nparr = np.frombuffer(base64.b64decode(image_data), np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        # Verify face
        try:
            DeepFace.verify(img, img, model_name='Facenet')
        except Exception as e:
            return jsonify({
                'success': False,
                'message': f'Face verification failed: {str(e)}'
            }), 400

        return jsonify({
            'success': True,
            'message': 'Face registered successfully'
        })
    except Exception as e:
        print(f"Registration error: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'Error registering face: {str(e)}'
        }), 500

@app.route('/verify-voting', methods=['POST'])
def verify_voting():
    try:
        data = request.get_json()
        if not data or 'image' not in data or 'voterId' not in data:
            return jsonify({
                'success': False,
                'error': 'Image and voter ID are required'
            }), 400

        # Get voter's registered face from backend
        try:
            response = requests.get(
                f"{BACKEND_URL}/api/users/{data['voterId']}",
                headers={'Authorization': f'Bearer {BACKEND_API_KEY}'}
            )
            if response.status_code != 200:
                return jsonify({
                    'success': False,
                    'error': 'Failed to fetch voter data'
                }), 400

            voter_data = response.json()
            
            # Get the registered face image URL from Cloudinary
            registered_face_url = voter_data.get('faceImageUrl')
            if not registered_face_url:
                return jsonify({
                    'success': False,
                    'error': 'Registered face image not found'
                }), 400

            # Download the registered face image from Cloudinary
            registered_face_response = requests.get(registered_face_url)
            if registered_face_response.status_code != 200:
                return jsonify({
                    'success': False,
                    'error': 'Failed to fetch registered face image'
                }), 400

            # Save registered face image temporarily
            with open('temp_registered.jpg', 'wb') as f:
                f.write(registered_face_response.content)

            # Save current image temporarily
            current_image = base64_to_image(data['image'])
            current_image.save('temp_current.jpg')

            # Verify faces using DeepFace
            registered_face_encoding = DeepFace.encode(np.array(Image.open('temp_registered.jpg')))[0]
            current_face_encoding = DeepFace.encode(np.array(current_image))[0]
            face_distances = DeepFace.face_distance([registered_face_encoding], current_face_encoding)
            distance = float(face_distances[0])
            
            # Define threshold for face match (0.6 = 60%)
            threshold = 0.6
            
            # Calculate match percentage for display
            similarity = 1 - distance
            match_percentage = min(100, max(0, (similarity - threshold) * 100 / (1 - threshold)))
            
            # Only proceed with Cloudinary upload if match is above threshold
            if similarity > threshold:
                try:
                    # Convert current image to base64 for Cloudinary
                    _, buffer = cv2.imencode('.jpg', np.array(current_image))
                    img_str = base64.b64encode(buffer).decode('utf-8')
                    data_uri = f'data:image/jpeg;base64,{img_str}'

                    # Upload to Cloudinary
                    cloudinary_response = requests.post(
                        f'https://api.cloudinary.com/v1_1/{os.environ.get("CLOUDINARY_CLOUD_NAME")}/image/upload',
                        files={'file': data_uri},
                        data={
                            'api_key': os.environ.get('CLOUDINARY_API_KEY'),
                            'timestamp': int(datetime.now().timestamp()),
                            'folder': 'face-verification'
                        }
                    )

                    if cloudinary_response.status_code != 200:
                        return jsonify({
                            'success': False,
                            'error': 'Failed to upload verification image'
                        }), 500

                    cloudinary_data = cloudinary_response.json()
                    
                    return jsonify({
                        'success': True,
                        'message': 'Face identified successfully',
                        'matchPercentage': match_percentage,
                        'voter': voter_data,
                        'imageUrl': cloudinary_data['secure_url'],
                        'pythonService': 'primary'
                    })
                except Exception as e:
                    return jsonify({
                        'success': False,
                        'error': f'Failed to process verification: {str(e)}'
                    }), 500
            else:
                return jsonify({
                    'success': False,
                    'message': 'Face does not match registered face',
                    'matchPercentage': match_percentage,
                    'error': 'Face verification failed'
                }), 401

        except Exception as e:
            return jsonify({
                'success': False,
                'error': f'Failed to fetch voter data: {str(e)}'
            }), 500

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def download_image_from_url(url):
    try:
        print(f"Downloading image from URL: {url}")
        response = requests.get(url)
        if response.status_code == 200:
            image = Image.open(BytesIO(response.content))
            print(f"Successfully downloaded image, size: {image.size}")
            return image
        else:
            raise Exception(f"Failed to download image from URL: {response.status_code}")
    except Exception as e:
        print(f"Error downloading image: {str(e)}")
        raise Exception(f"Error downloading image: {str(e)}")

def base64_to_image(base64_string):
    try:
        print("Converting base64 to image")
        if ',' in base64_string:
            base64_string = base64_string.split(',')[1]
        
        image_data = base64.b64decode(base64_string)
        image = Image.open(BytesIO(image_data))
        
        # Convert RGBA to RGB if necessary
        if image.mode == 'RGBA':
            image = image.convert('RGB')
            
        print(f"Successfully converted base64 to image, size: {image.size}")
        return image
    except Exception as e:
        print(f"Error converting base64 to image: {str(e)}")
        raise Exception(f"Error converting base64 to image: {str(e)}")

def check_face_quality(image):
    # Convert PIL Image to numpy array
    image_np = np.array(image)
    
    # Convert to grayscale if needed
    if len(image_np.shape) == 3:
        gray = cv2.cvtColor(image_np, cv2.COLOR_RGB2GRAY)
    else:
        gray = image_np
    
    # Calculate brightness
    brightness = np.mean(gray)
    
    # Calculate contrast
    contrast = np.std(gray)
    
    # Calculate sharpness using Laplacian variance
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    sharpness = np.var(laplacian)
    
    # Define thresholds
    BRIGHTNESS_THRESHOLD = 40
    CONTRAST_THRESHOLD = 20
    SHARPNESS_THRESHOLD = 100
    
    if brightness < BRIGHTNESS_THRESHOLD:
        return False, "Image is too dark"
    if contrast < CONTRAST_THRESHOLD:
        return False, "Image has low contrast"
    if sharpness < SHARPNESS_THRESHOLD:
        return False, "Image is not sharp enough"
    
    return True, "Image quality is good"

# Initialize models when the application starts
if not initialize_models():
    logger.error("Failed to initialize models")
    exit(1)

# Only run the Flask development server if this script is run directly
if __name__ == '__main__':
    # Get port from environment variable
    port = int(os.environ.get('PORT', 5000))
    
    # Start the server
    logger.info(f"Starting server on port {port}...")
    app.run(host='0.0.0.0', port=port)
