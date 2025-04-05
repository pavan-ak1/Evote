const axios = require('axios');
const cloudinary = require('cloudinary').v2;

class FaceVerificationService {
    constructor() {
        this.baseURL = 'https://voter-verify-face-ofgu.onrender.com';
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 second
        this.initialized = false;
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async checkServiceHealth() {
        try {
            // Try to connect to the service directly
            const response = await axios.get(this.baseURL, {
                timeout: 10000, // Increased timeout
                headers: {
                    'Accept': 'application/json'
                }
            });

            // Check if service is healthy
            if (response.data && response.data.status === 'healthy') {
                this.initialized = true;
                return true;
            }

            // If service is not healthy, return false
            console.error('Service health check failed:', response.data);
            return false;
        } catch (error) {
            // If we get a 404 for /health, but the service is responding, consider it healthy
            if (error.response?.status === 404) {
                this.initialized = true;
                return true;
            }
            console.error('Face service health check failed:', error.message);
            return false;
        }
    }

    async waitForService(maxAttempts = 3) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (await this.checkServiceHealth()) {
                return true;
            }
            if (attempt < maxAttempts) {
                await this.sleep(this.retryDelay);
            }
        }
        return false;
    }

    async registerFace(userId, faceImage) {
        let lastError = null;
        
        // Wait for service to be ready
        if (!this.initialized && !(await this.waitForService())) {
            throw new Error('Face registration service is temporarily unavailable');
        }

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
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
                const response = await axios.post(`${this.baseURL}/api/register`, {
                    userId: userId,
                    faceImage: processedImage.split(',')[1]
                }, {
                    timeout: 30000,
                    withCredentials: true,
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                });

                if (!response.data || !response.data.success) {
                    throw new Error(response.data?.message || response.data?.error || 'Face registration failed');
                }

                return {
                    success: true,
                    message: response.data.message,
                    userId: response.data.userId
                };

            } catch (error) {
                console.error(`Registration attempt ${attempt} failed:`, error.response?.data || error.message);
                lastError = error;
                
                if (attempt < this.maxRetries) {
                    await this.sleep(this.retryDelay);
                }
            }
        }

        throw new Error(lastError?.response?.data?.message || lastError?.message || 'Face registration failed after all retries');
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

                // Process images
                let processedImage1 = image1;
                let processedImage2 = image2;

                if (!processedImage1.startsWith('data:image')) {
                    processedImage1 = `data:image/jpeg;base64,${processedImage1}`;
                }

                if (!processedImage2.startsWith('data:image')) {
                    processedImage2 = `data:image/jpeg;base64,${processedImage2}`;
                }

                const response = await axios.post(`${this.baseURL}/verify`, {
                    image1: processedImage1.split(',')[1],
                    image2: processedImage2.split(',')[1]
                }, {
                    timeout: 30000,
                    withCredentials: true,
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                });

                if (!response.data) {
                    throw new Error('Invalid response from face verification service');
                }

                return {
                    success: true,
                    matchPercentage: response.data.matchPercentage || 0,
                    isMatch: response.data.isMatch || false,
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
            isMatch: false,
            error: lastError?.response?.data?.message || lastError?.message || 'Face verification failed after all retries'
        };
    }
}

module.exports = FaceVerificationService; 