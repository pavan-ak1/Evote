const QRCode = require("qrcode");
const TimeSlot = require("../models/TimeSlot");
const DigitalToken = require("../models/DigitalToken");
const qrUtils = require("../utils/qrUtils"); // This should export a generateQRCode() function
const mongoose = require("mongoose");
const PDFDocument = require("pdfkit");
const StreamBuffers = require("stream-buffers");
const moment = require("moment");
const User = require("../models/userModel");

// Endpoint to generate digital token and return the QR code URL (and store/update in DB)
exports.generateDigitalToken = async (req, res) => {
  try {
    const voterId = req.user._id.toString();
    console.log("Generating digital token for Voter ID:", voterId);

    // Find the user's booked slot
    const user = await User.findById(voterId).populate('timeSlot');
    if (!user || !user.timeSlot) {
      return res.status(404).json({ error: "No booked slot found for this voter." });
    }

    const bookedSlot = user.timeSlot;
    console.log("Found Booked Slot:", bookedSlot);

    // Prepare data for the QR code - use a consistent format with just essential data
    const qrData = JSON.stringify({
      voterId: voterId,
      slotId: bookedSlot._id.toString()
    });

    console.log("QR Data prepared:", qrData);

    // Generate QR code URL with better options for clearer QR code
    let qrCodeUrl;
    try {
      qrCodeUrl = await QRCode.toDataURL(qrData, {
        errorCorrectionLevel: 'H', // High error correction for better scanning
        margin: 2,
        scale: 8,
        color: {
          dark: '#000000',  // Black dots
          light: '#ffffff' // White background
        }
      });
      console.log("QR code generated successfully with length:", qrCodeUrl.length);
    } catch (error) {
      console.error("Error generating QR code:", error);
      return res.status(500).json({ error: "Failed to generate QR code" });
    }

    // First check if a token already exists for this voter
    let existingToken = await DigitalToken.findOne({ voterId: voterId });
    
    if (existingToken) {
      // Update the existing token
      existingToken.slotId = bookedSlot._id;
      existingToken.qrCode = qrCodeUrl;
      existingToken.token = qrData;
      if (user.phoneNumber) {
        existingToken.phoneNumber = user.phoneNumber;
      }
      await existingToken.save();
      console.log("Updated existing digital token:", existingToken._id);
    } else {
      // Create a new token
      const newToken = new DigitalToken({
        voterId: voterId,
        slotId: bookedSlot._id,
        qrCode: qrCodeUrl,
        token: qrData,
        phoneNumber: user.phoneNumber
      });
      await newToken.save();
      console.log("New digital token created:", newToken._id);
    }
    
    res.status(200).json({
      message: "Digital token generated successfully",
      qrCodeUrl: qrCodeUrl
    });
  } catch (error) {
    console.error("Error generating digital token:", error);
    res.status(500).json({ error: error.message });
  }
};

// Endpoint to download digital token as a PDF
exports.downloadDigitalTokenPDF = async (req, res) => {
  try {
    const voterId = req.user._id.toString();
    
    // Get the user and their time slot
    const user = await User.findById(voterId).populate('timeSlot');
    
    if (!user || !user.timeSlot) {
      return res.status(404).json({ error: "No booked slot found for this voter." });
    }

    const bookedSlot = user.timeSlot;
    
    // Get the digital token
    const digitalToken = await DigitalToken.findOne({ voterId: voterId });
    
    if (!digitalToken) {
      return res.status(404).json({ error: "Digital token not found. Please generate a token first." });
    }
    
    // Use the QR code URL directly from the stored token
    const qrCodeUrl = digitalToken.qrCode;
    
    // Create PDF document
    const doc = new PDFDocument();
    const bufferStream = new StreamBuffers.WritableStreamBuffer({
      initialSize: 100 * 1024,
      incrementAmount: 10 * 1024
    });
    doc.pipe(bufferStream);

    // Add header
    doc.fontSize(20).text("Digital Voting Token", { align: "center" });
    doc.moveDown();

    // Add voter details
    doc.fontSize(14).text(`Voter ID: ${voterId}`);
    doc.text(`Name: ${user.name}`);
    doc.text(`Phone Number: ${user.phoneNumber || 'N/A'}`);
    doc.text(`Slot Date: ${bookedSlot.date}`);
    doc.text(`Slot Time: ${bookedSlot.startTime} - ${bookedSlot.endTime}`);
    doc.moveDown();

    // Add QR code
    const base64Data = qrCodeUrl.replace(/^data:image\/png;base64,/, "");
    const qrImageBuffer = Buffer.from(base64Data, "base64");
    doc.image(qrImageBuffer, { align: "center", fit: [150, 150] });
    
    doc.fontSize(12).text("This QR code contains your voting token. Present this at the polling station.", { align: "center" });
    
    doc.end();

    bufferStream.on("finish", () => {
      const pdfData = bufferStream.getContents();
      res.setHeader("Content-Disposition", `attachment; filename=digital_token_${user.name.replace(/\s+/g, '_')}.pdf`);
      res.setHeader("Content-Type", "application/pdf");
      res.send(pdfData);
    });
  } catch (error) {
    console.error("Error generating digital token PDF:", error);
    res.status(500).json({ error: error.message });
  }
};

// Verify the digital token
exports.verifyDigitalToken = async (req, res) => {
  try {
    // Handle both GET and POST
    let tokenData = req.body?.tokenData;
    let phoneNumber = req.params?.phoneNumber;
    
    // Log which method is being used
    if (tokenData) {
      console.log("POST method - Verifying token data:", tokenData);
    } else if (phoneNumber) {
      console.log("GET method - Verifying by phone number:", phoneNumber);
    } else {
      return res.status(400).json({ error: "Missing token data or phone number" });
    }
    
    // Find by token data (POST method)
    if (tokenData) {
      // Try to parse if it's a JSON string
      let voterId = null;
      try {
        if (typeof tokenData === 'string') {
          try {
            const parsed = JSON.parse(tokenData);
            voterId = parsed.voterId;
          } catch (e) {
            console.error("Not a valid JSON string, treating as direct ID");
            voterId = tokenData;
          }
        } else if (typeof tokenData === 'object') {
          voterId = tokenData.voterId;
        }
      } catch (e) {
        console.error("Error parsing token:", e);
      }
      
      if (!voterId) {
        return res.status(400).json({ error: "Invalid token format: Cannot extract voter ID" });
      }
      
      console.log("Extracted voter ID for verification:", voterId);
      
      // Find the token in the database using various queries
      const token = await DigitalToken.findOne({ 
        $or: [
          { token: typeof tokenData === 'string' ? tokenData : JSON.stringify(tokenData) },
          { voterId: voterId }
        ] 
      });
      
      if (!token) {
        return res.status(404).json({ error: "Invalid digital token" });
      }
      
      // Find the associated user
      const user = await User.findById(token.voterId).select('-password').populate('timeSlot');
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      return res.status(200).json({
        success: true,
        message: "Digital token verified successfully",
        user,
        token
      });
    } 
    // Find by phone number (GET method - legacy)
    else if (phoneNumber) {
      // Find token by phone number
      const token = await DigitalToken.findOne({ phoneNumber });
      
      if (!token) {
        return res.status(404).json({ error: "No digital token found for this phone number" });
      }
      
      // Find the associated user
      const user = await User.findById(token.voterId).select('-password').populate('timeSlot');
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      return res.status(200).json({
        success: true,
        message: "Digital token verified successfully",
        user,
        token
      });
    }
  } catch (error) {
    console.error("Error verifying digital token:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
