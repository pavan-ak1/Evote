# EvoteZip - Digital Voting System

A secure digital voting system with face recognition, digital tokens, and admin verification.

## Setup Instructions

### Prerequisites
- Node.js (v14+)
- Python (v3.6+)
- MongoDB

### Environment Setup
1. Create a `.env` file in the root directory with the following variables:
```
PORT=3000
MONGODB_URI=mongodb://localhost:27017/evoting
JWT_SECRET=your_secure_jwt_secret
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret
GEMINI_API_KEY=your_gemini_api_key
FACE_VERIFICATION_PORT=5001
```

### Installation

1. Install Node.js dependencies:
```bash
npm install
```

2. Install Python dependencies (for face verification server):
```bash
pip install flask flask-cors pillow numpy
```

### Running the Application

1. Start the face verification server:
```bash
python face_verification_server.py
```

2. In a separate terminal, start the main Node.js server:
```bash
npm start
```

3. Access the application:
   - Voter interface: http://localhost:3000
   - Admin interface: http://localhost:3000/admin

## Recent Fixes

1. QR Code Generation and PDF Download:
   - Fixed the digital token generation and PDF download functionality
   - Resolved duplicate key errors in the database

2. Face Verification:
   - Simplified verification response to show clear access granted/denied messages
   - Improved face recognition model with better similarity calculation

3. Voter Management Table:
   - Added proper formatting for voter data display
   - Fixed misaligned table headers

4. AI Chatbot:
   - Implemented Gemini AI integration for voter assistance

## Troubleshooting

- If you encounter a duplicate key error with phoneNumber, the fix is already applied but you might need to clear the existing tokens collection:
```
mongo
use evoting
db.digitaltokens.drop()
```

- For face verification server issues, check the console logs to ensure it's running on port 5001

"# Evote" 
things to do 
4️⃣ Next Steps
✅ Add Liveness Detection (Anti-Spoofing)
To prevent photo or video spoofing, add:

Eye blinking detection
Head movement verification
Mouth movement verification
✅ Add Multi-Factor Authentication (MFA)
If face verification fails, request:

OTP verification via SMS
Fingerprint authentication (WebAuthn)
Would you like me to implement liveness detection or MFA next? 🚀


set up auth MIddleware