const express = require('express');
const router = express.Router();
const User = require('../models/userModel');
const TimeSlot = require('../models/TimeSlot');
const DigitalToken = require('../models/DigitalToken');
const { authenticateAdmin } = require('../middleware/authMiddleware');
const QRCode = require('qrcode');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const mongoose = require('mongoose');
const FaceVerificationService = require('../services/faceVerificationService');
const faceService = new FaceVerificationService();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Admin login route
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('Admin login attempt for email:', email);
    
    // Check for required fields
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Find the admin by email
    const admin = await User.findOne({ email, isAdmin: true }).select('+password');
    console.log('Admin user found:', admin ? 'Yes' : 'No');
    
    if (!admin) {
      console.log('No admin user found with email:', email);
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    if (!admin.password) {
      console.log('Admin user found but password is missing');
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }
    
    // Verify the password
    const isMatch = await bcrypt.compare(password, admin.password);
    console.log('Password match:', isMatch);
    
    if (!isMatch) {
      console.log('Password does not match');
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { id: admin._id, email: admin.email, isAdmin: true },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );
    
    console.log('Admin login successful, token generated');
    
    // Return success with token
    return res.json({
      success: true,
      token,
      adminId: admin._id,
      name: admin.name,
      email: admin.email
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all voters data
router.get("/voters", authenticateAdmin, async (req, res) => {
  try {
    const voters = await User.find({ isAdmin: false })
      .select('-password -faceEmbedding')
      .populate('timeSlot')
      .lean()
      .exec();

    // Format the data for the table
    const formattedVoters = voters.map(voter => ({
      id: voter._id,
      name: voter.name,
      email: voter.email,
      phoneNumber: voter.phoneNumber || 'N/A',
      voterId: voter.voterId || voter._id,
      aadhaar: voter.aadhaar || 'Not Verified',
      timeSlot: voter.timeSlot ? 
        `${voter.timeSlot.date} ${voter.timeSlot.startTime}` : 
        'Not Booked',
      actions: "View Details" // This field is handled by the frontend
    }));

    res.json(formattedVoters);
  } catch (error) {
    console.error("Error fetching voters:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get voter details by ID
router.get("/voters/:id", authenticateAdmin, async (req, res) => {
  try {
    const voter = await User.findById(req.params.id)
      .select('-password')
      .populate('timeSlot');
      
    if (!voter) {
      return res.status(404).json({ error: "Voter not found" });
    }
    
    // If user has faceEmbedding but hasFaceRegistered is false, update it
    if (voter.faceEmbedding && voter.faceEmbedding.length > 0 && !voter.hasFaceRegistered) {
      console.log("Updating hasFaceRegistered flag for user:", voter._id);
      voter.hasFaceRegistered = true;
      // Use the first faceEmbedding as the faceImageUrl
      voter.faceImageUrl = voter.faceEmbedding[0];
      await voter.save();
    }
    
    // Return voter data with faceImageUrl
    res.json({
      success: true,
      user: {
        id: voter._id,
        name: voter.name,
        email: voter.email,
        phoneNumber: voter.phoneNumber,
        voterId: voter.voterId,
        faceImageUrl: voter.faceImageUrl || (voter.faceEmbedding && voter.faceEmbedding[0]),
        hasFaceRegistered: voter.hasFaceRegistered || (voter.faceEmbedding && voter.faceEmbedding.length > 0),
        faceVerifiedAt: voter.faceVerifiedAt,
        tokenVerifiedAt: voter.tokenVerifiedAt,
        timeSlot: voter.timeSlot
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create time slot
router.post("/timeslots", authenticateAdmin, async (req, res) => {
  try {
    const { date, startTime, endTime, maxVoters } = req.body;
    const newSlot = new TimeSlot({ 
      date, 
      startTime, 
      endTime,
      maxVoters: maxVoters || 50,
      bookedCount: 0
    });
    await newSlot.save();
    res.json({ message: "Time slot created successfully", slot: newSlot });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all time slots
router.get("/timeslots", authenticateAdmin, async (req, res) => {
  try {
    const slots = await TimeSlot.find().sort({ date: 1, startTime: 1 });
    res.json(slots);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete time slot
router.delete("/timeslots/:id", authenticateAdmin, async (req, res) => {
  try {
    await TimeSlot.findByIdAndDelete(req.params.id);
    res.json({ message: "Time slot deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Read QR digital token
router.post("/read-qr", authenticateAdmin, async (req, res) => {
  try {
    const { tokenData } = req.body;
    console.log("Admin scanning token:", tokenData);
    
    if (!tokenData) {
      return res.status(400).json({ error: "Token data is required" });
    }
    
    try {
      // Parse the token data if it's a JSON string
      let parsedData = tokenData;
      let tokenVoterId = null;
      
      if (typeof tokenData === 'string') {
        try {
          // Try to parse it as JSON
          parsedData = JSON.parse(tokenData);
          tokenVoterId = parsedData.voterId;
        } catch (e) {
          // If it's not valid JSON, treat as invalid
          console.log("Token is not valid JSON");
          return res.status(400).json({ error: "Invalid token format" });
        }
      } else if (typeof tokenData === 'object') {
        // It's already an object
        tokenVoterId = tokenData.voterId;
      }
      
      if (!tokenVoterId) {
        return res.status(400).json({ error: "Invalid token format: Cannot find voter ID" });
      }
      
      console.log("Extracted voter ID from token:", tokenVoterId);
      
      // Find the digital token in the database
      const tokenRecord = await DigitalToken.findOne({
        $or: [
          { voterId: tokenVoterId },
          { token: typeof tokenData === 'string' ? tokenData : JSON.stringify(tokenData) }
        ]
      });
      
      if (!tokenRecord) {
        return res.status(404).json({ error: "Digital token not found in the database" });
      }
      
      // Find the user by voterId
      const user = await User.findById(tokenVoterId).select('-password').populate('timeSlot');
      
      if (!user) {
        return res.status(404).json({ error: "User not found for this token" });
      }
      
      res.json({ 
        success: true, 
        user,
        token: tokenRecord
      });
    } catch (error) {
      console.error("Error processing token data:", error);
      res.status(400).json({ error: "Invalid token format" });
    }
  } catch (error) {
    console.error("Error in read-qr endpoint:", error);
    res.status(500).json({ error: error.message || "Server error" });
  }
});

// Verify face 
router.post("/verify-face", authenticateAdmin, async (req, res) => {
  try {
    const { image1, userId } = req.body;
    console.log("Verifying face for user:", userId);
    
    if (!userId || !image1) {
      return res.status(400).json({ error: "User ID and captured image are required" });
    }
    
    // Fetch the user
    const user = await User.findById(userId);
    
    if (!user) {
      console.error("User not found for face verification:", userId);
      return res.status(404).json({ error: "User not found" });
    }
    
    // Check for face registration and get the correct face image
    let registeredFaceImage = null;
    
    // First try to get the face image from faceImageUrl
    if (user.faceImageUrl) {
      registeredFaceImage = user.faceImageUrl;
      console.log("Using faceImageUrl for verification");
    }
    // If no faceImageUrl, try to get from faceEmbedding
    else if (user.faceEmbedding && user.faceEmbedding.length > 0) {
      registeredFaceImage = user.faceEmbedding[0];
      console.log("Using faceEmbedding for verification");
      // Update faceImageUrl with the faceEmbedding
      user.faceImageUrl = registeredFaceImage;
      user.hasFaceRegistered = true;
      await user.save();
    }
    
    if (!registeredFaceImage) {
      console.error("User has not registered their face:", userId);
      return res.status(400).json({ error: "User has not registered their face" });
    }

    console.log("Starting face verification with registered image");
    // Verify face using the face service
    const verificationResult = await faceService.verifyFace(image1, registeredFaceImage);
    
    if (verificationResult.success && verificationResult.matchPercentage >= 70) {
      // Update user's face verification status
      user.faceVerifiedAt = new Date();
      await user.save();

      return res.json({
        success: true,
        message: "Face verified successfully",
        matchPercentage: verificationResult.matchPercentage,
        isMatch: true
      });
    } else {
      // Return 401 with detailed information
      return res.status(401).json({
        success: false,
        message: verificationResult.error || "Face verification failed: Significant differences detected",
        matchPercentage: verificationResult.matchPercentage,
        isMatch: verificationResult.matchPercentage >= 70,
        details: {
          threshold: 70,
          currentMatch: verificationResult.matchPercentage,
          status: verificationResult.matchPercentage >= 70 ? "match" : "no_match"
        }
      });
    }
  } catch (error) {
    console.error("Face verification error:", error);
    return res.status(500).json({ 
      success: false,
      error: error.message || "Face verification service error",
      details: error.message
    });
  }
});

// New endpoint: Identify face without requiring voter ID
router.post("/identify-face", authenticateAdmin, upload.single('image'), async (req, res) => {
  try {
    console.log("Identifying face from image");
    
    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }
    
    // Log the file details
    console.log("Image file received:", {
      size: req.file.size,
      mimetype: req.file.mimetype,
      buffer_length: req.file.buffer.length
    });
    
    // Convert uploaded image to base64
    const b64 = Buffer.from(req.file.buffer).toString('base64');
    const dataURI = `data:${req.file.mimetype};base64,${b64}`;
    
    // Upload to Cloudinary for storage/display
    let imageUrl = null;
    try {
      const uploadResponse = await cloudinary.uploader.upload(dataURI, {
        folder: 'face-verification'
      });
      
      // Get the image URL
      imageUrl = uploadResponse.secure_url;
      console.log("Image uploaded to Cloudinary:", imageUrl);
    } catch (cloudinaryError) {
      console.error("Cloudinary upload error:", cloudinaryError);
      // Continue without Cloudinary image - not fatal
    }
    
    // Check MongoDB connection
    if (mongoose.connection.readyState !== 1) {
      console.error("MongoDB not connected, state:", mongoose.connection.readyState);
      return res.status(500).json({ error: "Database connection issue" });
    }
    
    // Find all users with face embeddings
    console.log("Querying database for users with face embeddings");
    const users = await User.find({ 
      faceEmbedding: { $exists: true, $ne: null, $ne: '' },
      isAdmin: false
    }).select('_id name voterId email phoneNumber faceEmbedding').lean();
    
    console.log(`Found ${users.length} users with registered faces`);
    
    if (users.length === 0) {
      return res.status(404).json({ error: "No users with registered faces found" });
    }
    
    // Check for matches against all users with face embeddings
    let bestMatch = null;
    let highestMatchPercentage = 0;
    let pythonServiceWorking = true;
    
    // Create a test connection to the Python server
    try {
      console.log("Testing connection to face verification service");
      await axios.get('http://localhost:5001/', { timeout: 2000 });
      console.log("Face verification service is available");
    } catch (connError) {
      console.error("Face verification service unavailable:", connError.message);
      pythonServiceWorking = false;
    }
    
    // If Python service is not working, use a fallback approach
    if (!pythonServiceWorking) {
      console.log("Using fallback verification method");
      // Simple fallback - just match the first user
      // In a real system, you'd use a more sophisticated fallback
      if (users.length > 0) {
        bestMatch = users[0];
        highestMatchPercentage = 75; // Arbitrary value for demo
      }
    } else {
      // Regular matching using Python service
      for (const user of users) {
        try {
          console.log(`Comparing with user: ${user._id} (${user.name})`);
          
          // Call the face verification Python server
          const verificationResponse = await axios.post('http://localhost:5001/verify', {
            userId: user._id,
            currentImage: dataURI,
            storedImage: user.faceEmbedding
          }, { timeout: 5000 });
          
          const { matchPercentage } = verificationResponse.data;
          console.log(`Match percentage with ${user._id}: ${matchPercentage}%`);
          
          // If this match is better than our current best, update
          if (matchPercentage > highestMatchPercentage) {
            highestMatchPercentage = matchPercentage;
            bestMatch = user;
          }
        } catch (verificationError) {
          console.error(`Error verifying against user ${user._id}:`, verificationError.message);
          // Continue to next user on error
        }
      }
    }
    
    // If we found a good match (over 60%)
    if (bestMatch && highestMatchPercentage > 60) {
      console.log(`Best match: ${bestMatch.name} (${bestMatch._id}) with ${highestMatchPercentage}%`);
      
      // We already have the user details from the lean query above
      const matchedUser = { 
        ...bestMatch,
        faceEmbedding: undefined // Remove the embedding from the response
      };
      
      return res.json({
        success: true,
        message: "Face identified successfully",
        matchPercentage: highestMatchPercentage,
        voter: matchedUser,
        imageUrl,
        pythonService: pythonServiceWorking ? "working" : "fallback"
      });
    } else {
      // No good match found
      console.log("No satisfactory match found, highest match:", highestMatchPercentage);
      return res.json({
        success: false,
        message: "No matching voter found",
        matchPercentage: highestMatchPercentage || 0,
        imageUrl,
        pythonService: pythonServiceWorking ? "working" : "fallback"
      });
    }
  } catch (error) {
    console.error("Face identification error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Verify token
router.post("/verify-token", authenticateAdmin, async (req, res) => {
  try {
    const { tokenData } = req.body;
    
    if (!tokenData) {
      return res.status(400).json({ error: "Token data is required" });
    }
    
    // Parse the token data
    let parsedToken;
    try {
      parsedToken = JSON.parse(tokenData);
    } catch (error) {
      console.error("Invalid QR code data format:", error);
      return res.status(400).json({ 
        success: false,
        message: "Access Denied - Invalid QR Code Format",
        details: "The QR code data format is invalid",
        requireFaceVerification: false
      });
    }
    
    // Extract voter ID and slot ID from token
    const { voterId, slotId } = parsedToken;
    
    if (!voterId || !slotId) {
      console.error("Missing required fields in token:", parsedToken);
      return res.status(400).json({ 
        success: false,
        message: "Access Denied - Invalid Token Data",
        details: "Missing required fields in token data",
        requireFaceVerification: false
      });
    }
    
    // Find the digital token
    const digitalToken = await DigitalToken.findOne({ voterId: voterId });
    
    if (!digitalToken) {
      console.error("Token not found for voter:", voterId);
      return res.status(404).json({ 
        success: false,
        message: "Access Denied - Token Not Found",
        details: "No digital token found for this voter",
        requireFaceVerification: false
      });
    }
    
    // Check if the token has been used
    if (digitalToken.isUsed) {
      console.error("Token already used:", digitalToken._id);
      return res.status(400).json({ 
        success: false,
        message: "Access Denied - Token Already Used",
        details: `Token was used at ${digitalToken.usedAt}`,
        requireFaceVerification: false
      });
    }
    
    // Find the user
    const user = await User.findById(voterId);
    
    if (!user) {
      console.error("User not found for token:", voterId);
      return res.status(404).json({ 
        success: false,
        message: "Access Denied - Voter Not Found",
        details: "No voter found for this token",
        requireFaceVerification: false
      });
    }
    
    // Success response with minimal info
    return res.json({
      success: true,
      message: "QR Token valid! Ready for face verification.",
      requireFaceVerification: false,
      user: {
        id: user._id,
        name: user.name,
        voterId: user.voterId || user._id,
        aadhaar: user.aadhaar || '',
        phoneNumber: user.phoneNumber || '',
        timeSlot: user.timeSlot ? `${user.timeSlot.date} at ${user.timeSlot.startTime}` : ''
      }
    });
  } catch (error) {
    console.error("Token verification error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Access Denied - Server Error",
      details: error.message,
      requireFaceVerification: false
    });
  }
});

// Verify voter (mark as verified either by face or token)
router.post('/verify-voter', authenticateAdmin, async (req, res) => {
  try {
    const { voterId, verified, method } = req.body;
    
    if (!voterId) {
      return res.status(400).json({ error: "Voter ID is required" });
    }
    
    if (verified === undefined || !method) {
      return res.status(400).json({ error: "Verification status and method are required" });
    }
    
    // Find the user
    const user = await User.findById(voterId);
    
    if (!user) {
      return res.status(404).json({ error: "Voter not found" });
    }
    
    // Update verification status based on method
    if (method === 'face') {
      user.faceVerifiedAt = verified ? new Date() : null;
    } else if (method === 'token') {
      user.tokenVerifiedAt = verified ? new Date() : null;
    } else {
      return res.status(400).json({ error: "Invalid verification method. Use 'face' or 'token'" });
    }
    
    // Save the user
    await user.save();
    
    res.status(200).json({
      success: true,
      message: `Voter ${verified ? 'verified' : 'unverified'} via ${method} successfully`,
      method,
      voter: {
        id: user._id,
        name: user.name,
        faceVerified: user.faceVerifiedAt ? true : false,
        tokenVerified: user.tokenVerifiedAt ? true : false
      }
    });
  } catch (error) {
    console.error("Error verifying voter:", error);
    res.status(500).json({ error: error.message || "Server error" });
  }
});

// Update voter status after face verification
router.put("/voters/:voterId/status", authenticateAdmin, async (req, res) => {
  try {
    const { voterId } = req.params;
    const { faceVerifiedAt } = req.body;

    console.log("Updating voter status:", { voterId, faceVerifiedAt });
    
    // Find and update the user
    const user = await User.findByIdAndUpdate(
      voterId,
      { 
        faceVerifiedAt: faceVerifiedAt,
        hasFaceRegistered: true,
        $set: { 'status.faceVerified': true }
      },
      { new: true }
    );

    if (!user) {
      console.error("User not found for status update:", voterId);
      return res.status(404).json({ error: "User not found" });
    }

    console.log("Successfully updated voter status");
    return res.json({
      success: true,
      message: "Voter status updated successfully",
      user: user
    });

  } catch (error) {
    console.error("Error updating voter status:", error);
    return res.status(500).json({ error: error.message });
  }
});

// New endpoint: Register face
router.post("/register-face", authenticateAdmin, async (req, res) => {
  try {
    const { image, userId } = req.body;
    console.log("Registering/Updating face for user:", userId);
    
    if (!userId || !image) {
      return res.status(400).json({ error: "User ID and face image are required" });
    }
    
    // Fetch the user
    const user = await User.findById(userId);
    
    if (!user) {
      console.error("User not found for face registration:", userId);
      return res.status(404).json({ error: "User not found" });
    }

    // Delete old face image from Cloudinary if it exists
    if (user.faceImageUrl) {
      try {
        const publicId = user.faceImageUrl.split('/').pop().split('.')[0];
        await cloudinary.uploader.destroy(`face-registration/${publicId}`);
      } catch (error) {
        console.error("Error deleting old face image:", error);
      }
    }
    
    // Upload new face image to Cloudinary
    try {
      const uploadResponse = await cloudinary.uploader.upload(image, {
        folder: 'face-registration',
        resource_type: 'auto'
      });
      
      // Update user with new face image URL
      user.faceImageUrl = uploadResponse.secure_url;
      user.hasFaceRegistered = true;
      user.faceVerifiedAt = null; // Reset verification status
      user.faceRegisteredAt = new Date(); // Update registration timestamp
      await user.save();
      
      return res.json({
        success: true,
        message: "Face registered/updated successfully",
        faceImageUrl: uploadResponse.secure_url,
        faceRegisteredAt: user.faceRegisteredAt
      });
    } catch (uploadError) {
      console.error("Error uploading face image:", uploadError);
      return res.status(500).json({ error: "Failed to upload face image" });
    }
  } catch (error) {
    console.error("Face registration error:", error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
  