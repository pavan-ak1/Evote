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

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# Backend API configuration
BACKEND_URL = os.environ.get('BACKEND_URL', 'http://localhost:3000')
BACKEND_API_KEY = os.environ.get('BACKEND_API_KEY', 'your-api-key')
PORT = int(os.environ.get('PORT', 5000))

# Initialize DeepFace models
def initialize_models():
    try:
        print("Initializing DeepFace models...")
        # Test DeepFace with a simple operation
        DeepFace.verify(
            img1_path="temp1.jpg",
            img2_path="temp1.jpg",
            model_name='VGG-Face',
            detector_backend='opencv',
            enforce_detection=False
        )
        print("DeepFace models initialized successfully")
        return True
    except Exception as e:
        print(f"Error initializing DeepFace models: {str(e)}")
        return False

# Create temp directory
temp_dir = 'temp'
if not os.path.exists(temp_dir):
    os.makedirs(temp_dir)

# Initialize models on startup
initialize_models()

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

@app.route('/')
def health_check():
    try:
        # Check if models are initialized
        if not initialize_models():
            return jsonify({
                'status': 'unhealthy',
                'service': 'face-verification',
                'version': '1.0.0',
                'error': 'Models not initialized'
            }), 503
        
        return jsonify({
            'status': 'healthy',
            'service': 'face-verification',
            'version': '1.0.0',
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({
            'status': 'unhealthy',
            'service': 'face-verification',
            'version': '1.0.0',
            'error': str(e)
        }), 503

@app.route('/verify', methods=['POST'])
def verify_face():
    try:
        data = request.get_json()
        print("Received verification request:", data.keys())
        
        if not data or 'image1' not in data or 'image2' not in data:
            return jsonify({
                'success': False,
                'error': 'Both images are required'
            }), 400
        
        # Process first image (captured image)
        try:
            print("Processing captured image...")
            image1 = base64_to_image(data['image1'])
            
            # Save temporarily for DeepFace
            temp_path1 = os.path.join(temp_dir, 'temp1.jpg')
            image1.save(temp_path1, 'JPEG')
            print("Successfully processed captured image")
        except Exception as e:
            print("Error processing captured image:", str(e))
            return jsonify({
                'success': False,
                'error': f'Error processing captured image: {str(e)}'
            }), 400
        
        # Process second image (registered image)
        try:
            print("Processing registered image...")
            if isinstance(data['image2'], str):
                if data['image2'].startswith('http'):
                    # Download from URL
                    image2 = download_image_from_url(data['image2'])
                else:
                    # Process base64
                    image2 = base64_to_image(data['image2'])
            else:
                return jsonify({
                    'success': False,
                    'error': 'Invalid image2 format'
                }), 400
            
            # Save temporarily for DeepFace
            temp_path2 = os.path.join(temp_dir, 'temp2.jpg')
            image2.save(temp_path2, 'JPEG')
            print("Successfully processed registered image")
        except Exception as e:
            print("Error processing registered image:", str(e))
            return jsonify({
                'success': False,
                'error': f'Error processing registered image: {str(e)}'
            }), 400
        
        # Verify faces using DeepFace with multiple models for increased accuracy
        try:
            print("Verifying faces with DeepFace...")
            
            # Use multiple models for verification
            models = ['VGG-Face', 'Facenet', 'OpenFace']
            verification_results = []
            
            for model in models:
                result = DeepFace.verify(
                    img1_path=temp_path1,
                    img2_path=temp_path2,
                    model_name=model,
                    detector_backend='opencv',
                    distance_metric='cosine',
                    enforce_detection=True,
                    align=True
                )
                verification_results.append(1 - result['distance'])  # Convert distance to similarity
            
            # Clean up temporary files
            if os.path.exists(temp_path1):
                os.remove(temp_path1)
            if os.path.exists(temp_path2):
                os.remove(temp_path2)
            
            # Calculate average similarity across models
            avg_similarity = sum(verification_results) / len(verification_results)
            print(f"Average similarity across models: {avg_similarity}")
            
            # Define more reasonable verification thresholds
            VERY_HIGH_CONFIDENCE = 0.85  # 85% similarity
            HIGH_CONFIDENCE = 0.80  # 80% similarity
            MEDIUM_CONFIDENCE = 0.75
            
            # Determine confidence level
            if avg_similarity >= VERY_HIGH_CONFIDENCE:
                confidence_level = 'VERY_HIGH'
            elif avg_similarity >= HIGH_CONFIDENCE:
                confidence_level = 'HIGH'
            elif avg_similarity >= MEDIUM_CONFIDENCE:
                confidence_level = 'MEDIUM'
            else:
                return jsonify({
                    'success': False,
                    'error': 'Face verification failed: Insufficient similarity',
                    'matchPercentage': avg_similarity,
                    'details': {
                        'average_similarity': avg_similarity,
                        'model_similarities': dict(zip(models, verification_results))
                    }
                }), 401
            
            verification_status = {
                'success': True,
                'matchPercentage': avg_similarity,
                'confidenceLevel': confidence_level,
                'modelResults': {model: score for model, score in zip(models, verification_results)},
                'recommendations': []
            }
            
            return jsonify(verification_status)
        except Exception as e:
            # Clean up temporary files
            if os.path.exists(temp_path1):
                os.remove(temp_path1)
            if os.path.exists(temp_path2):
                os.remove(temp_path2)
                
            print("Error in DeepFace verification:", str(e))
            return jsonify({
                'success': False,
                'error': f'Error in face verification: {str(e)}'
            }), 500
        
    except Exception as e:
        print(f"Face verification error: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/register', methods=['POST'])
def register_face():
    try:
        data = request.get_json()
        print("Received registration request")
        
        if not data or 'userId' not in data or 'faceImage' not in data:
            return jsonify({
                'success': False,
                'message': 'User ID and face image are required'
            }), 400

        print("Processing face image...")
        try:
            # Remove data URL prefix if present
            face_image = data['faceImage']
            if ',' in face_image:
                face_image = face_image.split(',')[1]
            
            # Decode base64 string
            img_data = base64.b64decode(face_image)
            nparr = np.frombuffer(img_data, np.uint8)
            opencv_image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if opencv_image is None:
                raise Exception("Failed to decode image")
                
            print("Image decoded successfully")
        except Exception as e:
            print(f"Error processing image: {str(e)}")
            return jsonify({
                'success': False,
                'message': f'Error processing image: {str(e)}'
            }), 400
        
        # Save image temporarily for DeepFace
        temp_path = os.path.join(temp_dir, f'temp_register_{data["userId"]}.jpg')
        cv2.imwrite(temp_path, opencv_image)
        
        try:
            # Verify that DeepFace can detect and process the face
            result = DeepFace.verify(
                img1_path=temp_path,
                img2_path=temp_path,
                model_name='VGG-Face',
                detector_backend='opencv',
                enforce_detection=True,
                align=True
            )
            
            # Clean up temporary file
            if os.path.exists(temp_path):
                os.remove(temp_path)
            
            # Return success response
            return jsonify({
                'success': True,
                'message': 'Face registered successfully',
                'userId': data['userId'],
                'verified': True
            })
        except Exception as e:
            # Clean up temporary file
            if os.path.exists(temp_path):
                os.remove(temp_path)
                
            print(f"Error in face registration: {str(e)}")
            return jsonify({
                'success': False,
                'message': f'Error in face registration: {str(e)}'
            }), 400

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
            result = DeepFace.verify(
                img1_path='temp_current.jpg',
                img2_path='temp_registered.jpg',
                model_name='VGG-Face',
                detector_backend='opencv',
                distance_metric='cosine',
                enforce_detection=True,
                align=True
            )

            # Clean up temporary files
            os.remove('temp_registered.jpg')
            os.remove('temp_current.jpg')

            # Convert distance to similarity percentage (0-1)
            similarity = 1 - result['distance']
            
            # Define threshold for face match (0.75 = 75%)
            threshold = 0.75
            
            # Calculate match percentage for display
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

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=PORT)
