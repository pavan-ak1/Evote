// File: src/routes/visionRoutes.js
const express = require('express');
const router = express.Router();
const User = require('../models/userModel');
const { authMiddleware } = require('../middleware/authMiddleware');

// Add Python server URL configuration
const PYTHON_SERVER_URL = process.env.PYTHON_SERVER_URL || 'http://localhost:5001';

// New simplified face verification endpoint with Voter ID verification
router.post('/face-verification', authMiddleware, async (req, res) => {
  try {
    const { image, voterId } = req.body;
    
    if (!image) {
      return res.status(400).json({ success: false, message: "No image received" });
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
    
    // Store the face image in the user document
    user.faceEmbedding = image;
    user.faceVerifiedAt = new Date();
    await user.save();

    return res.status(200).json({ 
      success: true, 
      message: "Face registered successfully!" 
    });
  } catch (error) {
    console.error("Face Verification Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Legacy endpoints kept for backward compatibility
router.post('/register-face', async (req, res) => {
  try {
    const { voterID, imageBase64 } = req.body;
    if (!voterID || !imageBase64) {
      return res.status(400).json({ error: 'voterID and imageBase64 are required' });
    }

    // Find the user
    const user = await User.findOne({ voterId: voterID });
    if (!user) {
      return res.status(404).json({ error: 'Voter not found' });
    }

    // Store the face image directly
    user.faceEmbedding = imageBase64;
    user.faceVerifiedAt = new Date();
    await user.save();

    res.json({ message: 'Face registered successfully' });
  } catch (error) {
    console.error('Error registering face:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/verify-face', async (req, res) => {
  try {
    const { voterID, imageBase64 } = req.body;
    if (!voterID || !imageBase64) {
      return res.status(400).json({ error: 'voterID and imageBase64 required' });
    }

    // Find the user
    const user = await User.findOne({ voterId: voterID });
    if (!user) {
      return res.status(404).json({ error: 'Voter not found' });
    }

    // In a real system, we'd do actual face comparison here
    // For this demo, just check if the user has a face registered
    if (!user.faceEmbedding) {
      return res.status(400).json({ error: 'No registered face found for this voter' });
    }

    res.json({ message: 'Face verification successful' });
  } catch (error) {
    console.error('Error verifying face:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
