require('dotenv').config();

module.exports = {
    pythonService: {
        url: process.env.PYTHON_SERVICE_URL || 'https://voter-verify-face-ofgu.onrender.com',
        apiKey: process.env.BACKEND_API_KEY
    }
}; 