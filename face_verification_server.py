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
import traceback

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Create temp directory
temp_dir = os.path.join(os.getcwd(), 'temp')
if not os.path.exists(temp_dir):
    os.makedirs(temp_dir)
    logger.info(f"Created temp directory: {temp_dir}")

app = Flask(__name__)
# Configure CORS with specific origins
CORS(app, resources={
    r"/*": {
        "origins": [
            "http://localhost:3000",
            "https://voter-verify-26-new.onrender.com",
            "https://voter-verify-face-ofgu.onrender.com",
            "https://voter-verify-backend-ry3f.onrender.com"
        ],
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"],
        "supports_credentials": True,
        "max_age": 3600,
        "expose_headers": ["Content-Type", "Authorization"]
    }
})

# Backend API configuration with better error handling
BACKEND_URL = os.environ.get('BACKEND_URL', 'https://voter-verify-backend-ry3f.onrender.com')
BACKEND_API_KEY = os.environ.get('BACKEND_API_KEY', 'your-api-key')

# Global variables for memory management
request_queue = Queue(maxsize=1)  # Limit concurrent requests
models_initialized = False
model_lock = threading.Lock()
executor = ThreadPoolExecutor(max_workers=1)  # Single worker thread pool

# Set DeepFace model directory to a writable location
DEEPFACE_DIR = os.path.join(os.getcwd(), 'deepface_weights')
os.makedirs(DEEPFACE_DIR, exist_ok=True)
os.makedirs(os.path.join(DEEPFACE_DIR, '.deepface', 'weights'), exist_ok=True)
os.environ['DEEPFACE_HOME'] = DEEPFACE_DIR
logger.info(f"DeepFace directory set to: {DEEPFACE_DIR}")

def manage_memory():
    """Aggressive memory management"""
    try:
        # Force garbage collection
        gc.collect()
        gc.set_threshold(100, 5, 5)  # More aggressive garbage collection
        
        # Check memory usage
        process = psutil.Process(os.getpid())
        memory_usage = process.memory_info().rss / 1024 / 1024  # Convert to MB
        
        if memory_usage > 200:  # If memory usage exceeds 200MB
            logger.warning(f"High memory usage detected: {memory_usage:.2f}MB")
            
            # Force garbage collection
            gc.collect()
            
            # Clear TensorFlow session
            tf.keras.backend.clear_session()
            
            # Clear any cached models
            if 'model' in globals():
                del globals()['model']
            
            # Clear any large variables
            for var in list(globals().keys()):
                if var.startswith('') or var in ['builtins', 'file', 'name_']:
                    continue
                if isinstance(globals()[var], (np.ndarray, tf.Tensor)):
                    del globals()[var]
            
            # Force garbage collection again
            gc.collect()
            
            # Log memory after cleanup
            memory_after = process.memory_info().rss / 1024 / 1024
            logger.info(f"Memory after cleanup: {memory_after:.2f}MB")
            
    except Exception as e:
        logger.error(f"Error in memory management: {str(e)}")

def initialize_models():
    """Initialize DeepFace models with a minimal test image"""
    try:
        # Create a minimal test image
        test_image = np.zeros((16, 16, 3), dtype=np.uint8)
        
        # Ensure directories exist
        weights_dir = os.path.join(DEEPFACE_DIR, '.deepface', 'weights')
        os.makedirs(weights_dir, exist_ok=True)
        
        # Test DeepFace with minimal configuration
        result = DeepFace.verify(test_image, test_image, 
                               model_name='Facenet',
                               detector_backend='skip',
                               enforce_detection=False)
        
        logger.info("DeepFace models initialized successfully")
        return True
    except Exception as e:
        logger.error(f"Error initializing DeepFace models: {str(e)}")
        logger.error(f"Current working directory: {os.getcwd()}")
        logger.error(f"DeepFace directory: {DEEPFACE_DIR}")
        logger.error(f"Weights directory: {os.path.join(DEEPFACE_DIR, '.deepface', 'weights')}")
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
            # Clear any large variables
            for var in list(locals().keys()):
                if var.startswith('_') or var in ['self', 'args', 'kwargs']:
                    continue
                if isinstance(locals()[var], (np.ndarray, tf.Tensor)):
                    del locals()[var]
            gc.collect()
    wrapped._name_ = func._name_  # Preserve the original function name
    return wrapped

@app.route('/', methods=['GET'])
def root_health_check():
    return jsonify({
        'status': 'healthy',
        'message': 'Service is running'
    }), 200

@app.route('/health', methods=['GET'])
def health_check():
    try:
        # Check if models are initialized
        if not models_initialized:
            return jsonify({
                'status': 'error',
                'message': 'Face verification models not initialized',
                'error': 'models_not_initialized'
            }), 503

        # Check memory usage
        memory = psutil.virtual_memory()
        memory_status = {
            'total': memory.total,
            'available': memory.available,
            'percent': memory.percent
        }

        # Check if temp directory is writable
        try:
            test_file = os.path.join(temp_dir, 'test.txt')
            with open(test_file, 'w') as f:
                f.write('test')
            os.remove(test_file)
        except Exception as e:
            logger.error(f"Temp directory not writable: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': 'Temp directory not writable',
                'error': 'temp_dir_not_writable'
            }), 503

        return jsonify({
            'status': 'healthy',
            'memory': memory_status,
            'models_initialized': models_initialized,
            'timestamp': datetime.now().isoformat()
        }), 200
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': str(e),
            'error': 'health_check_failed'
        }), 500

@app.route('/verify', methods=['POST'])
def verify_face():
    try:
        manage_memory()  # Check memory before processing
        
        # Log the incoming request
        logger.info("Received verification request")
        
        # Log request headers
        logger.info(f"Request headers: {dict(request.headers)}")
        
        # Check content type
        if request.content_type != 'application/json':
            logger.error(f"Invalid content type: {request.content_type}")
            return jsonify({
                'success': False,
                'message': 'Invalid content type. Expected application/json',
                'error': 'invalid_content_type'
            }), 400
        
        data = request.get_json()
        if not data:
            logger.error("No JSON data received in request")
            return jsonify({
                'success': False,
                'message': 'No data received in request',
                'error': 'missing_data'
            }), 400
            
        # Log the received data structure
        logger.info(f"Received data keys: {list(data.keys())}")
        
        # Check for image fields
        if 'image1' not in data or 'image2' not in data:
            logger.error("Missing required image fields")
            logger.error(f"Available fields: {list(data.keys())}")
            return jsonify({
                'success': False,
                'message': 'Missing required fields: image1 and image2',
                'error': 'missing_images',
                'received_fields': list(data.keys())
            }), 400

        # Process both images with memory optimization
        try:
            # Process first image
            image1_data = data['image1'].split(',')[1] if ',' in data['image1'] else data['image1']
            nparr1 = np.frombuffer(base64.b64decode(image1_data), np.uint8)
            img1 = cv2.imdecode(nparr1, cv2.IMREAD_COLOR)
            
            # Clear memory after processing first image
            del image1_data, nparr1
            gc.collect()
            
            # Process second image
            image2_data = data['image2'].split(',')[1] if ',' in data['image2'] else data['image2']
            nparr2 = np.frombuffer(base64.b64decode(image2_data), np.uint8)
            img2 = cv2.imdecode(nparr2, cv2.IMREAD_COLOR)
            
            # Clear memory after processing second image
            del image2_data, nparr2
            gc.collect()
            
            if img1 is None or img2 is None:
                logger.error("Failed to decode one or both images")
                return jsonify({
                    'success': False,
                    'message': 'Failed to decode images',
                    'error': 'image_decode_failed'
                }), 400
                
            # Convert BGR to RGB
            rgb_img1 = cv2.cvtColor(img1, cv2.COLOR_BGR2RGB)
            rgb_img2 = cv2.cvtColor(img2, cv2.COLOR_BGR2RGB)
            
            # Clear original images
            del img1, img2
            gc.collect()
            
            # Verify faces using DeepFace with optimized settings
            result = DeepFace.verify(
                rgb_img1, 
                rgb_img2, 
                model_name='Facenet',
                detector_backend='skip',  # Skip face detection for self-comparison
                enforce_detection=False,  # Don't enforce face detection
                distance_metric='cosine'  # Use cosine distance for better performance
            )
            
            # Clear processed images
            del rgb_img1, rgb_img2
            gc.collect()
            
            # Calculate match percentage
            distance = float(result['distance'])
            threshold = float(result['threshold'])
            match_percentage = max(0, min(100, (1 - (distance / threshold)) * 100))
            
            # Clear result dictionary
            del result
            gc.collect()
            
            return jsonify({
                'success': True,
                'verified': True if match_percentage >= 70 else False,  # 70% threshold for match
                'distance': distance,
                'threshold': threshold,
                'matchPercentage': match_percentage,
                'isMatch': True if match_percentage >= 70 else False
            })
        except Exception as e:
            logger.error(f"Image processing error: {str(e)}")
            if "No face detected" in str(e):
                return jsonify({
                    'success': False,
                    'message': 'No face detected in one or both images',
                    'error': 'no_face_detected',
                    'matchPercentage': 0,
                    'isMatch': False
                }), 400
            return jsonify({
                'success': False,
                'message': f'Error processing images: {str(e)}',
                'error': 'image_processing_error',
                'matchPercentage': 0,
                'isMatch': False
            }), 400
            
    except Exception as e:
        logger.error(f"Verification error: {str(e)}")
        logger.error(f"Request data: {str(data)}")
        return jsonify({
            'success': False,
            'message': f'Error verifying faces: {str(e)}',
            'error': 'verification_error',
            'matchPercentage': 0,
            'isMatch': False
        }), 500
    finally:
        # Final cleanup
        manage_memory()
        tf.keras.backend.clear_session()
        gc.collect()

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

# Initialize models at startup
try:
    # Initialize DeepFace models
    DeepFace.build_model("VGG-Face")
    DeepFace.build_model("Facenet")
    DeepFace.build_model("Facenet512")
    DeepFace.build_model("OpenFace")
    DeepFace.build_model("DeepFace")
    DeepFace.build_model("DeepID")
    DeepFace.build_model("ArcFace")
    DeepFace.build_model("Dlib")
    DeepFace.build_model("SFace")
    
    # Initialize face detector
    detector_backend = 'opencv'
    DeepFace.extract_faces(img_path = np.zeros([224, 224, 3]), target_size = (224, 224), detector_backend = detector_backend)
    
    logging.info("Models initialized successfully at startup")
except Exception as e:
    logging.error(f"Error initializing models: {str(e)}")
    raise

# Only run the Flask development server if this script is run directly
if __name__ == '__main__':
    # Get port from environment variable (Render will set this)
    port = int(os.environ.get('PORT', 10000))
    host = '0.0.0.0'  # Important for Docker - listen on all interfaces
    
    logging.info(f"Starting server on {host}:{port}...")
    logging.info(f"Environment variables:")
    logging.info(f"PORT: {port}")
    logging.info(f"PYTHON_SERVICE_URL: {os.environ.get('PYTHON_SERVICE_URL')}")
    logging.info(f"BACKEND_API_KEY: {os.environ.get('BACKEND_API_KEY')}")
    
    # Run the server with production settings
    app.run(
        host=host,
        port=port,
        debug=False,
        threaded=True,
        use_reloader=False
    )