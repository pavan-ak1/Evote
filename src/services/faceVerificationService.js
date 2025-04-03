const axios = require('axios');
const cloudinary = require('cloudinary').v2;

class FaceVerificationService {
    constructor() {
        this.baseURL = process.env.PYTHON_SERVICE_URL || 'https://voter-verify-face.onrender.com';
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
                // Validate input images
                if (!image1 || !image2) {
                    throw new Error('Both images are required for verification');
                }

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

                // Verify the Python service is available
                try {
                    await axios.get(`${this.baseURL}/health`, { timeout: 5000 });
                } catch (healthError) {
                    console.error('Python service health check failed:', healthError);
                    throw new Error('Face verification service is unavailable');
                }

                const response = await axios.post(`${this.baseURL}/verify`, {
                    image1: processedImage1,
                    image2: processedImage2
                }, {
                    timeout: 30000, // 30 second timeout for verification
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.data) {
                    throw new Error('Invalid response from face verification service');
                }

                return {
                    success: true,
                    matchPercentage: response.data.matchPercentage || 0,
                    error: null
                };

            } catch (error) {
                console.error(`Attempt ${attempt} failed:`, error);
                lastError = error;
                
                if (attempt < this.maxRetries) {
                    await this.sleep(this.retryDelay);
                }
            }
        }

        return {
            success: false,
            matchPercentage: 0,
            error: lastError?.message || 'Face verification failed after all retries'
        };
    }

    async registerFace(userId, faceImage) {
        try {
            // Validate inputs
            if (!userId || !faceImage) {
                throw new Error('User ID and face image are required');
            }

            // Check Python service health
            try {
                await axios.get(`${this.baseURL}/health`, { timeout: 5000 });
            } catch (healthError) {
                console.error('Python service health check failed:', healthError);
                throw new Error('Face registration service is unavailable');
            }

            // First, validate the face using the Python service
            const validationResponse = await axios.post(`${this.baseURL}/register`, {
                userId,
                faceImage
            }, {
                timeout: 30000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!validationResponse.data || !validationResponse.data.success) {
                throw new Error(validationResponse.data?.message || 'Face validation failed');
            }

            // If validation successful, upload to Cloudinary
            const uploadResponse = await cloudinary.uploader.upload(faceImage, {
                folder: 'face-registration',
                resource_type: 'auto',
                timeout: 30000
            });

            if (!uploadResponse || !uploadResponse.secure_url) {
                throw new Error('Failed to upload face image to Cloudinary');
            }

            return {
                success: true,
                faceImageUrl: uploadResponse.secure_url,
                verified: validationResponse.data.verified || false
            };
        } catch (error) {
            console.error('Face registration error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.message || error.message || 'Face registration failed');
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