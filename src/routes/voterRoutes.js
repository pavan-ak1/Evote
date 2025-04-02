// const faceapi = require("face-api.js");
const express = require('express');
const router = express.Router();
const User = require('../models/userModel');
const { authMiddleware } = require('../middleware/authMiddleware');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const FaceVerificationService = require('../services/faceVerificationService');
const faceService = new FaceVerificationService();

// router.post("/verify-face", async (req, res) => {
//     try {
//         const { voterID, faceEmbedding } = req.body;

//         if (!voterID || !faceEmbedding) {
//             return res.status(400).json({ success: false, message: "Voter ID and Face data are required!" });
//         }

//         // Find voter by Voter ID
//         const voter = await Voter.findOne({ voterID });
//         if (!voter) {
//             return res.status(404).json({ success: false, message: "Voter not found!" });
//         }

//         // Compare stored face embedding with the new one
//         const distance = faceapi.euclideanDistance(faceEmbedding, voter.faceEmbedding);
//         console.log(`🔍 Face match distance: ${distance}`);

//         if (distance < 0.5) { // Lower is better
//             return res.json({ success: true, message: `Voter Verified: ${voter.name}` });
//         } else {
//             return res.json({ success: false, message: "Face does not match!" });
//         }
//     } catch (error) {
//         console.error(error);
//         res.status(500).json({ success: false, message: "Error verifying face" });
//     }
// });

router.get('/profile', async (req, res) => {
    try {
        const userId = req.user.id; // Make sure req.user exists
        const user = await User.findById(userId).select('-password'); // Exclude password from response

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json(user);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});


router.get('/voters/:id', async (req, res) => {
    try {
        const voterId = req.params.id;
        const voter = await Voter.findById(voterId);

        if (!voter) {
            return res.status(404).json({ message: 'Voter not found' });
        }

        res.json(voter);
    } catch (error) {
        console.error('Error fetching voter:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// Voter login route
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Check for required fields
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }
    
    // Find the user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Check if the user is an admin - if so, don't allow login here
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Please use admin login' });
    }
    
    // Verify the password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );
    
    // Return success with token and user info
    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        voterId: user.voterId,
        phoneNumber: user.phoneNumber
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Add a new route for verifying digital tokens with Voter ID
router.post('/verify-token', authMiddleware, async (req, res) => {
  try {
    const { tokenData, voterId } = req.body;
    
    if (!tokenData) {
      return res.status(400).json({ success: false, message: "No token provided" });
    }
    
    if (!voterId) {
      return res.status(400).json({ success: false, message: "Voter ID is required for security verification" });
    }

    // Get the authenticated user
    const userId = req.user.id;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    // Verify that the provided Voter ID matches the user's Voter ID
    if (user.voterId !== voterId) {
      return res.status(403).json({ 
        success: false, 
        message: "Voter ID verification failed. Please ensure you've entered your correct Voter ID." 
      });
    }
    
    // Verify that the token matches the user's digital token
    if (user.digitalToken !== tokenData) {
      return res.status(403).json({ 
        success: false, 
        message: "Invalid digital token. Please check and try again." 
      });
    }
    
    // Update token verification timestamp
    user.tokenVerifiedAt = new Date();
    await user.save();

    return res.status(200).json({ 
      success: true, 
      message: "Digital token verified successfully!" 
    });
  } catch (error) {
    console.error("Token Verification Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Register face
router.post('/face/register', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const { faceImage } = req.body;
        if (!faceImage) {
            return res.status(400).json({ message: 'Face image is required' });
        }

        // Register face with the face verification service
        const result = await faceService.registerFace(user.id, faceImage);

        // Update user record with face image and URL
        user.faceImage = faceImage;
        user.faceImageUrl = result.faceImageUrl;
        user.hasFaceRegistered = true;
        user.faceRegisteredAt = new Date();
        await user.save();

        res.json({ 
            success: true,
            message: 'Face registered successfully',
            faceImageUrl: result.faceImageUrl
        });
    } catch (error) {
        console.error('Face registration error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error registering face',
            error: error.message 
        });
    }
});

// Verify face
router.post('/face/verify', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Check if face is registered
        if (!user.hasFaceRegistered) {
            return res.status(400).json({ message: 'Face not registered' });
        }

        // Check if verification is locked
        if (user.isFaceVerificationLocked()) {
            const lockTime = user.faceVerificationLockedUntil;
            return res.status(429).json({
                message: 'Face verification temporarily locked',
                lockedUntil: lockTime
            });
        }

        const { faceImage } = req.body;
        if (!faceImage) {
            return res.status(400).json({ message: 'Face image is required' });
        }

        // Verify face with the service
        const verificationResult = await faceService.verifyFace(user.faceImage, faceImage);
        
        if (verificationResult.isMatch) {
            // Reset verification attempts on success
            await user.resetFaceVerificationAttempts();
            user.lastFaceVerification = new Date();
            await user.save();

            return res.json({
                message: 'Face verified successfully',
                lastVerification: user.lastFaceVerification
            });
        } else {
            // Increment failed attempts
            await user.incrementFaceVerificationAttempts();
            
            return res.status(401).json({
                message: 'Face verification failed',
                attemptsRemaining: 3 - user.faceVerificationAttempts
            });
        }
    } catch (error) {
        console.error('Face verification error:', error);
        res.status(500).json({ 
            message: 'Error verifying face',
            error: error.message 
        });
    }
});

// Check face verification status
router.get('/face/status', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({
            hasFaceRegistered: user.hasFaceRegistered,
            faceRegisteredAt: user.faceRegisteredAt,
            lastVerification: user.lastFaceVerification,
            isLocked: user.isFaceVerificationLocked(),
            lockedUntil: user.faceVerificationLockedUntil,
            attemptsRemaining: Math.max(0, 3 - user.faceVerificationAttempts)
        });
    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({ 
            message: 'Error checking face verification status',
            error: error.message 
        });
    }
});

// Check face verification service health
router.get('/face/health', async (req, res) => {
    try {
        const health = await faceService.checkHealth();
        res.status(200).json(health);
    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({ 
            message: 'Error checking face verification service health',
            error: error.message 
        });
    }
});

module.exports = router;