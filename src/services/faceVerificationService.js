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

    async checkServiceHealth() {
        try {
            const response = await axios.get(`${this.baseURL}/health`, {
                timeout: 5000,
                headers: {
                    'Accept': 'application/json'
                }
            });
            return response.data && response.data.status === 'healthy';
        } catch (error) {
            console.error('Face service health check failed:', error.message);
            return false;
        }
    }

    async registerFace(userId, faceImage) {
        try {
            // Check service health first
            const isHealthy = await this.checkServiceHealth();
            if (!isHealthy) {
                throw new Error('Face registration service is unavailable');
            }

            // Validate inputs
            if (!userId || !faceImage) {
                throw new Error('User ID and face image are required');
            }

            // Process the face image
            let processedImage = faceImage;
            if (!processedImage.startsWith('data:image')) {
                processedImage = `data:image/jpeg;base64,${processedImage}`;
            }

            // Register face with Python service
            const response = await axios.post(`${this.baseURL}/register`, {
                userId,
                faceImage: processedImage
            }, {
                timeout: 30000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.data || !response.data.success) {
                throw new Error(response.data?.message || 'Face registration failed');
            }

            // Upload to Cloudinary for storage
            const uploadResponse = await cloudinary.uploader.upload(processedImage, {
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
                verified: response.data.verified || false
            };

        } catch (error) {
            console.error('Face registration error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.message || error.message || 'Face registration failed');
        }
    }

    async verifyFace(image1, image2) {
        let lastError = null;
        
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                // Check service health first
                const isHealthy = await this.checkServiceHealth();
                if (!isHealthy) {
                    throw new Error('Face verification service is unavailable');
                }

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

                const response = await axios.post(`${this.baseURL}/verify`, {
                    image1: processedImage1,
                    image2: processedImage2
                }, {
                    timeout: 30000,
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
                console.error(`Attempt ${attempt} failed:`, error.response?.data || error.message);
                lastError = error;
                
                if (attempt < this.maxRetries) {
                    await this.sleep(this.retryDelay);
                }
            }
        }

        return {
            success: false,
            matchPercentage: 0,
            error: lastError?.response?.data?.message || lastError?.message || 'Face verification failed after all retries'
        };
    }
}

module.exports = FaceVerificationService; 