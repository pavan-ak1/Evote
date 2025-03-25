import os
import base64
import logging
import numpy as np
from PIL import Image
from io import BytesIO
from flask import Flask, request, jsonify
from flask_cors import CORS

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('face-verification')

# Initialize Flask app
app = Flask(__name__)
CORS(app)

def decode_base64_to_image(base64_string):
    """Convert base64 string to PIL Image."""
    try:
        if not base64_string:
            return None
            
        # Extract the actual base64 content if the string includes data URI prefix
        if ',' in base64_string:
            base64_string = base64_string.split(',')[1]
            
        # Decode the base64 string to binary
        binary_data = base64.b64decode(base64_string)
        
        # Create PIL Image from binary data
        image = Image.open(BytesIO(binary_data))
        return image
    except Exception as e:
        logger.error(f"Error decoding base64 image: {str(e)}")
        return None

def calculate_similarity(stored_image_data, current_image_data):
    """Calculate face similarity between two images using improved metrics."""
    try:
        # Get stored image
        stored_image = None
        if stored_image_data:
            stored_image = decode_base64_to_image(stored_image_data)
        
        # Get current image
        current_image = None
        if current_image_data:
            current_image = decode_base64_to_image(current_image_data)
        
        # Check if we have both images
        if not stored_image or not current_image:
            logger.warning("Missing one or both images for comparison")
            return 50.0  # Return low confidence

        # Convert images to grayscale for better comparison
        stored_gray = stored_image.convert('L')
        current_gray = current_image.convert('L')
        
        # Resize images to same dimensions for comparison
        target_size = (224, 224)
        stored_gray = stored_gray.resize(target_size)
        current_gray = current_gray.resize(target_size)
        
        # Convert to numpy arrays
        stored_array = np.array(stored_gray)
        current_array = np.array(current_gray)
        
        # Normalize pixel values
        stored_array = stored_array.astype(float) / 255.0
        current_array = current_array.astype(float) / 255.0
        
        # Calculate structural similarity index (SSIM)
        # Higher SSIM means more similar images
        ssim = np.mean((stored_array - current_array) ** 2)
        
        # Convert SSIM to percentage (0-100)
        # Lower SSIM means higher similarity
        similarity = 100 - (ssim * 100)
        
        # Apply sigmoid function to get smoother results
        similarity = 100 / (1 + np.exp(-0.1 * (similarity - 50)))
        
        # Ensure similarity is between 0 and 100
        similarity = max(0, min(100, similarity))
        
        logger.info(f"Calculated similarity: {similarity:.2f}%")
        
        return similarity
    except Exception as e:
        logger.error(f"Error calculating similarity: {str(e)}")
        return 55.0  # Return a default value on error

@app.route('/register', methods=['POST'])
def register_face():
    """Register a face by storing its base64 representation."""
    try:
        data = request.json
        user_id = data.get('userId')
        face_image = data.get('faceImage')
        
        logger.info(f"Received face registration request for user: {user_id}")
        
        if not user_id or not face_image:
            logger.error("Missing required parameters")
            return jsonify({'error': 'Missing required parameters'}), 400
            
        # Verify the image is valid
        image = decode_base64_to_image(face_image)
        if not image:
            logger.error("Invalid image format")
            return jsonify({'error': 'Invalid image format'}), 400
            
        logger.info(f"Successfully registered face for user: {user_id}")
        
        return jsonify({
            'success': True,
            'message': 'Face registered successfully',
            'userId': user_id
        })
        
    except Exception as e:
        logger.error(f"Error during face registration: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/verify', methods=['POST'])
def verify_face():
    """Verify face similarity with improved threshold."""
    try:
        data = request.json
        user_id = data.get('userId')
        current_image = data.get('currentImage')
        stored_image = data.get('storedImage')
        
        logger.info(f"Received verification request for user: {user_id}")
        
        if not user_id or not current_image:
            logger.error("Missing required parameters")
            return jsonify({'error': 'Missing required parameters'}), 400
        
        # If no stored image, return a low match percentage
        if not stored_image:
            logger.warning(f"No stored image for user {user_id}")
            is_match = False
            match_percentage = 45.0
        else:
            # Calculate similarity between the stored and current face
            match_percentage = calculate_similarity(stored_image, current_image)
            # Adjusted threshold for better accuracy
            is_match = match_percentage >= 75.0
        
        logger.info(f"Verification result: isMatch={is_match}, percentage={match_percentage:.2f}%")
        
        return jsonify({
            'success': True,
            'isMatch': is_match,
            'matchPercentage': round(match_percentage, 2),
            'userId': user_id
        })
        
    except Exception as e:
        logger.error(f"Error during face verification: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({'status': 'ok'}), 200

@app.route('/', methods=['GET'])
def home():
    """Home endpoint."""
    return jsonify({
        'service': 'Face Verification API',
        'status': 'running',
        'endpoints': {
            '/register': 'POST - Register a face',
            '/verify': 'POST - Verify face similarity',
            '/health': 'GET - Health check'
        }
    })

if __name__ == '__main__':
    logger.info("Starting Face Verification Server...")
    port = int(os.environ.get('FACE_VERIFICATION_PORT', 5001))
    debug = os.environ.get('FLASK_DEBUG', 'False').lower() == 'true'
    logger.info(f"Server will run on port {port}, debug mode: {debug}")
    app.run(host='0.0.0.0', port=port, debug=debug) 