require('dotenv').config();

module.exports = {
    pythonService: {
        url: process.env.PYTHON_SERVICE_URL || 'http://localhost:5001',
        apiKey: process.env.BACKEND_API_KEY
    }
}; 