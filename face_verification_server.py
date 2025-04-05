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
from flask_cors import CORS, cross_origin  # <-- Added cross_origin import
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
import queue
import concurrent.futures

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
# Configure CORS with specific settings
CORS(app, resources={
    r"/*": {
        "origins": ["*"],  # Allow all origins in development
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization", "Accept"],
        "supports_credentials": True,
        "max_age": 3600
    }
})

# Global OPTIONS handler
@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        response = jsonify({"status": "ok"})
        response.headers.add("Access-Control-Allow-Origin", "*")
        response.headers.add("Access-Control-Allow-Headers", "Content-Type,Authorization,Accept")
        response.headers.add("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        response.headers.add("Access-Control-Max-Age", "3600")
        return response

# Backend API configuration with better error handling
BACKEND_URL = os.environ.get('BACKEND_URL', 'https://voter-verify-backend-ry3f.onrender.com')
BACKEND_API_KEY = os.environ.get('BACKEND_API_KEY', 'your-api-key')

# Global variables for memory management
request_queue = Queue(maxsize=1)  # Limit concurrent requests
models_initialized = False  # Global variable for model initialization status
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
        
        # Initialize only the Facenet model for faster startup and lower memory usage
        DeepFace.build_model("Facenet")
        
        # Initialize face detector with minimal settings
        detector_backend = 'skip'  # Skip face detection for initialization
        DeepFace.extract_faces(img_path=test_image, target_size=(16, 16), detector_backend=detector_backend)
        
        logger.info("Models initialized successfully")
        return True
    except Exception as e:
        logger.error(f"Error initializing models: {str(e)}")
        return False

def process_request(func):
    """Decorator to handle request queuing and memory management"""
    def wrapped(*args, **kwargs):
        global models_initialized  # Add global declaration
        try:
            # Wait for queue slot with timeout
            try:
                request_queue.put(True, timeout=30)  # 30 second timeout
            except queue.Full:
                logger.error("Request queue is full")
                return jsonify({
                    'success': False,
                    'message': 'Server is busy. Please try again later.'
                }), 503
            
            # Initialize models if needed
            if not models_initialized:
                with model_lock:
                    if not models_initialized:
                        logger.info("Initializing models...")
                        if not initialize_models_at_startup():
                            return jsonify({
                                'success': False,
                                'message': 'Service is initializing, please try again in a few seconds'
                            }), 503
                        models_initialized = True
                        logger.info("Models initialized successfully")
            
            # Process request in thread pool with request context
            with app.app_context():
                future = executor.submit(func, *args, **kwargs)
                try:
                    result = future.result(timeout=30)  # 30 second timeout
                    return result
                except concurrent.futures.TimeoutError:
                    logger.error("Request processing timed out")
                    return jsonify({
                        'success': False,
                        'message': 'Request processing timed out'
                    }), 504
                
        except Exception as e:
            logger.error(f"Request processing error: {str(e)}")
            logger.error(traceback.format_exc())
            return jsonify({
                'success': False,
                'message': str(e)
            }), 500
        finally:
            try:
                request_queue.get_nowait()  # Release queue slot
            except queue.Empty:
                pass
            manage_memory()
            # Clear any large variables
            for var in list(locals().keys()):
                if var.startswith('_') or var in ['self', 'args', 'kwargs']:
                    continue
                if isinstance(locals()[var], (np.ndarray, tf.Tensor)):
                    del locals()[var]
            gc.collect()
    wrapped.__name__ = func.__name__  # Preserve the original function name
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
@process_request
def verify_face():
    try:
        manage_memory()  # Check memory before processing
        
        logger.info("Received verification request")
        
        if request.content_type != 'application/json':
            return jsonify({
                'success': False,
                'message': 'Invalid content type. Expected application/json'
            }), 400
        
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'message': 'No data received in request'
            }), 400
            
        if 'image1' not in data or 'image2' not in data:
            return jsonify({
                'success': False,
                'message': 'Missing required fields: image1 and image2'
            }), 400

        try:
            image1_data = data['image1'].split(',')[1] if ',' in data['image1'] else data['image1']
            nparr1 = np.frombuffer(base64.b64decode(image1_data), np.uint8)
            img1 = cv2.imdecode(nparr1, cv2.IMREAD_COLOR)
            
            del image1_data, nparr1
            gc.collect()
            
            image2_data = data['image2'].split(',')[1] if ',' in data['image2'] else data['image2']
            nparr2 = np.frombuffer(base64.b64decode(image2_data), np.uint8)
            img2 = cv2.imdecode(nparr2, cv2.IMREAD_COLOR)
            
            del image2_data, nparr2
            gc.collect()
            
            if img1 is None or img2 is None:
                return jsonify({
                    'success': False,
                    'message': 'Failed to decode images'
                }), 400
                
            rgb_img1 = cv2.cvtColor(img1, cv2.COLOR_BGR2RGB)
            rgb_img2 = cv2.cvtColor(img2, cv2.COLOR_BGR2RGB)
            
            del img1, img2
            gc.collect()
            
            result = DeepFace.verify(
                rgb_img1, 
                rgb_img2, 
                model_name='Facenet',
                detector_backend='skip',
                enforce_detection=False,
                distance_metric='cosine'
            )
            
            del rgb_img1, rgb_img2
            gc.collect()
            
            distance = float(result['distance'])
            threshold = float(result['threshold'])
            match_percentage = max(0, min(100, (1 - (distance / threshold)) * 100))
            
            del result
            gc.collect()
            
            return jsonify({
                'success': True,
                'verified': True if match_percentage >= 70 else False,
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
                    'matchPercentage': 0,
                    'isMatch': False
                }), 400
            return jsonify({
                'success': False,
                'message': f'Error processing images: {str(e)}',
                'matchPercentage': 0,
                'isMatch': False
            }), 400
            
    except Exception as e:
        logger.error(f"Verification error: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'Error verifying faces: {str(e)}',
            'matchPercentage': 0,
            'isMatch': False
        }), 500
    finally:
        manage_memory()
        tf.keras.backend.clear_session()
        gc.collect()

@app.route('/api/register', methods=['POST', 'OPTIONS'])
@process_request
def register_face():
    try:
        logger.info("Received registration request")
        
        if request.method == 'OPTIONS':
            return jsonify({'status': 'ok'}), 200
        
        if request.content_type != 'application/json':
            return jsonify({
                'success': False,
                'message': 'Invalid content type. Expected application/json'
            }), 400
        
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'message': 'No data received in request'
            }), 400
            
        if 'userId' not in data or 'faceImage' not in data:
            return jsonify({
                'success': False,
                'message': 'Missing required fields: userId and faceImage'
            }), 400

        try:
            image_data = data['faceImage'].split(',')[1] if ',' in data['faceImage'] else data['faceImage']
            nparr = np.frombuffer(base64.b64decode(image_data), np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            del image_data, nparr
            gc.collect()
            
            if img is None:
                return jsonify({
                    'success': False,
                    'message': 'Failed to decode image'
                }), 400
                
            rgb_img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            
            del img
            gc.collect()
            
            try:
                DeepFace.verify(
                    rgb_img, 
                    rgb_img, 
                    model_name='Facenet',
                    detector_backend='skip',
                    enforce_detection=False,
                    distance_metric='cosine'
                )
            except Exception as e:
                if "No face detected" in str(e):
                    return jsonify({
                        'success': False,
                        'message': 'No face detected in the image'
                    }), 400
                raise e
            
            del rgb_img
            gc.collect()
            
            user_id = data['userId']
            face_image_path = os.path.join(temp_dir, f'{user_id}_face.txt')
            
            with open(face_image_path, 'w') as f:
                f.write(data['faceImage'])
            
            return jsonify({
                'success': True,
                'message': 'Face registered successfully',
                'userId': user_id
            })
            
        except Exception as e:
            logger.error(f"Image processing error: {str(e)}")
            return jsonify({
                'success': False,
                'message': f'Error processing image: {str(e)}'
            }), 400
            
    except Exception as e:
        logger.error(f"Registration error: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'Error registering face: {str(e)}'
        }), 500
    finally:
        manage_memory()
        tf.keras.backend.clear_session()
        gc.collect()

@app.route('/verify-voting', methods=['POST'])
def verify_voting():
    try:
        data = request.get_json()
        if not data or 'image' not in data or 'voterId' not in data:
            return jsonify({
                'success': False,
                'error': 'Image and voter ID are required'
            }), 400

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
            
            registered_face_url = voter_data.get('faceImageUrl')
            if not registered_face_url:
                return jsonify({
                    'success': False,
                    'error': 'Registered face image not found'
                }), 400

            registered_face_response = requests.get(registered_face_url)
            if registered_face_response.status_code != 200:
                return jsonify({
                    'success': False,
                    'error': 'Failed to fetch registered face image'
                }), 400

            with open('temp_registered.jpg', 'wb') as f:
                f.write(registered_face_response.content)

            current_image = base64_to_image(data['image'])
            current_image.save('temp_current.jpg')

            registered_face_encoding = DeepFace.encode(np.array(Image.open('temp_registered.jpg')))[0]
            current_face_encoding = DeepFace.encode(np.array(current_image))[0]
            face_distances = DeepFace.face_distance([registered_face_encoding], current_face_encoding)
            distance = float(face_distances[0])
            
            threshold = 0.6
            similarity = 1 - distance
            match_percentage = min(100, max(0, (similarity - threshold) * 100 / (1 - threshold)))
            
            if similarity > threshold:
                try:
                    _, buffer = cv2.imencode('.jpg', np.array(current_image))
                    img_str = base64.b64encode(buffer).decode('utf-8')
                    data_uri = f'data:image/jpeg;base64,{img_str}'

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
        
        if image.mode == 'RGBA':
            image = image.convert('RGB')
            
        print(f"Successfully converted base64 to image, size: {image.size}")
        return image
    except Exception as e:
        print(f"Error converting base64 to image: {str(e)}")
        raise Exception(f"Error converting base64 to image: {str(e)}")

def check_face_quality(image):
    image_np = np.array(image)
    
    if len(image_np.shape) == 3:
        gray = cv2.cvtColor(image_np, cv2.COLOR_RGB2GRAY)
    else:
        gray = image_np
    
    brightness = np.mean(gray)
    contrast = np.std(gray)
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    sharpness = np.var(laplacian)
    
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

def initialize_models_at_startup():
    """Initialize models with minimal settings"""
    try:
        logger.info("Starting model initialization...")
        
        # Create necessary directories
        os.makedirs(temp_dir, exist_ok=True)
        os.makedirs(DEEPFACE_DIR, exist_ok=True)
        os.makedirs(os.path.join(DEEPFACE_DIR, '.deepface', 'weights'), exist_ok=True)
        
        # Initialize TensorFlow with minimal memory usage
        tf.config.set_visible_devices([], 'GPU')
        tf.config.threading.set_inter_op_parallelism_threads(1)
        tf.config.threading.set_intra_op_parallelism_threads(1)
        
        # Initialize DeepFace models with minimal settings
        try:
            # First try to load from cache
            model = DeepFace.build_model("Facenet")
            if model is None:
                raise Exception("Failed to load model from cache")
            
            # Test with minimal image
            test_image = np.zeros((16, 16, 3), dtype=np.uint8)
            DeepFace.extract_faces(img_path=test_image, target_size=(16, 16), detector_backend='skip')
            
            logger.info("Models initialized successfully from cache")
            return True
        except Exception as e:
            logger.warning(f"Cache load failed, downloading models: {str(e)}")
            # If cache fails, download with minimal settings
            DeepFace.build_model("Facenet", model_name="Facenet", detector_backend="skip")
            logger.info("Models downloaded and initialized successfully")
            return True
            
    except Exception as e:
        logger.error(f"Error initializing models: {str(e)}")
        logger.error(traceback.format_exc())
        return False

# Only run the Flask development server if this script is run directly
if __name__ == '__main__':
    try:
        # Initialize models with minimal settings
        if not initialize_models_at_startup():
            logger.error("Failed to initialize models at startup")
            raise Exception("Failed to initialize face verification models")
        models_initialized = True
        
        # Validate environment variables
        required_env_vars = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY']
        missing_vars = [var for var in required_env_vars if not os.environ.get(var)]
        if missing_vars:
            raise Exception(f"Missing required environment variables: {', '.join(missing_vars)}")
        
        # Configure server
        port = int(os.environ.get('PORT', 10000))
        host = '0.0.0.0'
        
        logger.info(f"Starting server on {host}:{port}...")
        logger.info(f"Environment variables:")
        logger.info(f"PORT: {port}")
        logger.info(f"PYTHON_SERVICE_URL: {os.environ.get('PYTHON_SERVICE_URL')}")
        logger.info(f"BACKEND_API_KEY: {os.environ.get('BACKEND_API_KEY')}")
        
        # Start server
        app.run(
            host=host,
            port=port,
            debug=False,
            threaded=True,
            use_reloader=False
        )
    except Exception as e:
        logger.error(f"Fatal error during startup: {str(e)}")
        logger.error(traceback.format_exc())
        raise

# =======================
# Modified endpoint below
# =======================

@app.route('/api/upload-photo', methods=['POST', 'OPTIONS'])
@cross_origin(origins="*")
@process_request
def upload_photo():
    try:
        logger.info("Received upload-photo request")
        
        if request.method == 'OPTIONS':
            return jsonify({'status': 'ok'}), 200

        if request.content_type != 'application/json':
            logger.error(f"Invalid content type: {request.content_type}")
            return jsonify({
                'success': False,
                'message': 'Invalid content type. Expected application/json'
            }), 400

        data = request.get_json()
        if not data or 'image' not in data:
            logger.error("No image data in request")
            return jsonify({
                'success': False,
                'message': 'No image data received'
            }), 400

        # Validate Cloudinary credentials
        cloud_name = os.environ.get("CLOUDINARY_CLOUD_NAME")
        api_key = os.environ.get('CLOUDINARY_API_KEY')
        if not cloud_name or not api_key:
            logger.error("Missing Cloudinary credentials")
            return jsonify({
                'success': False,
                'message': 'Server configuration error'
            }), 500

        try:
            # Process image data
            image_data = data['image'].split(',')[1] if ',' in data['image'] else data['image']
            
            # Validate base64 data
            try:
                decoded_data = base64.b64decode(image_data)
                if len(decoded_data) == 0:
                    raise ValueError("Empty image data")
            except Exception as e:
                logger.error(f"Invalid base64 data: {str(e)}")
                return jsonify({
                    'success': False,
                    'message': 'Invalid image data format'
                }), 400

            # Upload to Cloudinary
            logger.info("Uploading to Cloudinary...")
            cloudinary_response = requests.post(
                f'https://api.cloudinary.com/v1_1/{cloud_name}/image/upload',
                files={'file': f'data:image/jpeg;base64,{image_data}'},
                data={
                    'api_key': api_key,
                    'timestamp': int(datetime.now().timestamp()),
                    'folder': 'face-verification'
                },
                timeout=30  # 30 second timeout
            )

            if cloudinary_response.status_code != 200:
                logger.error(f"Cloudinary upload failed: {cloudinary_response.text}")
                return jsonify({
                    'success': False,
                    'message': 'Failed to upload image to Cloudinary',
                    'error': cloudinary_response.text
                }), 500

            cloudinary_data = cloudinary_response.json()
            logger.info(f"Successfully uploaded to Cloudinary: {cloudinary_data.get('secure_url')}")
            
            # Clean up memory
            del image_data
            gc.collect()
            
            return jsonify({
                'success': True,
                'message': 'Photo uploaded successfully',
                'imageUrl': cloudinary_data['secure_url']
            })

        except requests.exceptions.Timeout:
            logger.error("Cloudinary upload timed out")
            return jsonify({
                'success': False,
                'message': 'Upload timed out. Please try again.'
            }), 504
        except requests.exceptions.RequestException as e:
            logger.error(f"Cloudinary request error: {str(e)}")
            return jsonify({
                'success': False,
                'message': 'Failed to connect to image service',
                'error': str(e)
            }), 503

    except Exception as e:
        logger.error(f"Photo upload error: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({
            'success': False,
            'message': f'Error uploading photo: {str(e)}',
            'error': str(e)
        }), 500
    finally:
        manage_memory()
        tf.keras.backend.clear_session()
        gc.collect()
