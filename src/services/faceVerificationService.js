const axios = require('axios');
const cloudinary = require('cloudinary').v2;

class FaceVerificationService {
    constructor() {
        this.baseURL = `http://localhost:${process.env.FACE_VERIFICATION_PORT || 5000}`;
        this.maxRetries = 3;
        this.retryDelay = 5000; // 5 seconds
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async verifyFace(image1, image2) {
        let lastError = null;
        
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                // Ensure both images are in the correct format
                let processedImage1 = image1;
                let processedImage2 = image2;

                // Process image1 if needed
                if (!processedImage1.startsWith('data:image')) {
                    processedImage1 = `data:image/jpeg;base64,${processedImage1}`;
                }

                // Process image2 if needed
                if (processedImage2.startsWith('http')) {
                    try {
                        // If it's a Cloudinary URL, download it
                        const response = await axios.get(processedImage2, { 
                            responseType: 'arraybuffer',
                            timeout: 15000 // 15 second timeout for download
                        });
                        processedImage2 = `data:image/jpeg;base64,${Buffer.from(response.data).toString('base64')}`;
                    } catch (downloadError) {
                        console.error('Error downloading image:', downloadError);
                        throw new Error('Failed to download registered face image');
                    }
                } else if (!processedImage2.startsWith('data:image')) {
                    processedImage2 = `data:image/jpeg;base64,${processedImage2}`;
                }

                console.log(`Attempt ${attempt}/${this.maxRetries}: Sending verification request to:`, `${this.baseURL}/verify`);
                console.log('Image1 format:', processedImage1.substring(0, 50) + '...');
                console.log('Image2 format:', processedImage2.substring(0, 50) + '...');

                const response = await axios.post(`${this.baseURL}/verify`, {
                    image1: processedImage1,
                    image2: processedImage2
                }, {
                    timeout: 60000 // 60 second timeout for verification
                });

                console.log('Verification response:', response.data);

                if (!response.data || typeof response.data.success === 'undefined') {
                    throw new Error('Invalid response from face verification service');
                }

                // Convert the response to match the expected format
                return {
                    success: response.data.success,
                    isMatch: response.data.matchPercentage >= 0.75, // 75% threshold
                    matchPercentage: response.data.matchPercentage * 100
                };
            } catch (error) {
                lastError = error;
                console.error(`Attempt ${attempt}/${this.maxRetries} failed:`, error.message);
                
                // Handle 401 response specifically
                if (error.response?.status === 401) {
                    return {
                        success: false,
                        isMatch: false,
                        matchPercentage: error.response.data.matchPercentage * 100,
                        error: error.response.data.error
                    };
                }
                
                if (attempt < this.maxRetries) {
                    console.log(`Retrying in ${this.retryDelay/1000} seconds...`);
                    await this.sleep(this.retryDelay);
                }
            }
        }

        // If we get here, all retries failed
        console.error('All verification attempts failed');
        if (lastError.response?.data) {
            throw new Error(`Face verification service error: ${lastError.response.data.error || lastError.message}`);
        }
        throw new Error(`Face verification service error: ${lastError.message}`);
    }

    async registerFace(userId, faceImage) {
        try {
            // First, validate the face using the Python service
            const validationResponse = await axios.post(`${this.baseURL}/register`, {
                userId,
                faceImage
            });

            if (!validationResponse.data.success) {
                throw new Error(validationResponse.data.message || 'Face validation failed');
            }

            // If validation successful, upload to Cloudinary
            const uploadResponse = await cloudinary.uploader.upload(faceImage, {
                folder: 'face-registration',
                resource_type: 'auto'
            });

            return {
                success: true,
                faceImageUrl: uploadResponse.secure_url,
                verified: validationResponse.data.verified
            };
        } catch (error) {
            console.error('Face registration error:', error.response?.data || error.message);
            throw error;
        }
    }

    async checkHealth() {
        try {
            const response = await axios.get(`${this.baseURL}/health`);
            return response.data;
        } catch (error) {
            console.error('Health check error:', error.response?.data || error.message);
            throw error;
        }
    }
}

module.exports = FaceVerificationService; 