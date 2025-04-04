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
    
    // Find the user's booked slot
    const user = await User.findById(voterId).populate('timeSlot');
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    if (!user.timeSlot) {
      return res.status(400).json({ 
        error: "You need to book a time slot first before generating a digital token.",
        redirect: "/time-slot.html"
      });
    }

    const bookedSlot = user.timeSlot;

    // Prepare data for the QR code - use a consistent format with just essential data
    const qrData = JSON.stringify({
      voterId: voterId,
      slotId: bookedSlot._id.toString()
    });

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
    
    // Create PDF document with proper settings
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      bufferPages: true,
      autoFirstPage: true,
      info: {
        Title: 'Digital Voting Token',
        Author: 'Election Commission of India'
      }
    });
    
    // Create a buffer to store the PDF
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    
    // Create a promise to handle PDF generation
    const pdfPromise = new Promise((resolve, reject) => {
      doc.on('end', () => {
        const result = Buffer.concat(chunks);
        resolve(result);
      });
      doc.on('error', reject);
    });

    // Add header
    doc.font('Helvetica-Bold')
       .fontSize(24)
       .text('Election Commission of India', { align: 'center' });
    
    doc.moveDown();
    doc.fontSize(20)
       .text('Digital Voting Token', { align: 'center' });
    
    doc.moveDown(2);

    // Add voter details
    doc.font('Helvetica-Bold')
       .fontSize(14)
       .text('Voter Information:', { align: 'left' });
    
    doc.moveDown();
    doc.font('Helvetica')
       .fontSize(12)
       .text(`Name: ${user.name}`, { align: 'left' })
       .text(`Voter ID: ${user.voterId || voterId}`, { align: 'left' })
       .text(`Phone Number: ${user.phoneNumber || 'N/A'}`, { align: 'left' })
       .text(`Email: ${user.email || 'N/A'}`, { align: 'left' });
    
    doc.moveDown(2);

    // Add time slot information
    doc.font('Helvetica-Bold')
       .fontSize(14)
       .text('Voting Time Slot:', { align: 'left' });
    
    doc.moveDown();
    doc.font('Helvetica')
       .fontSize(12)
       .text(`Date: ${bookedSlot.date}`, { align: 'left' })
       .text(`Time: ${bookedSlot.startTime} - ${bookedSlot.endTime}`, { align: 'left' });
    
    doc.moveDown(2);

    // Add QR code
    try {
      const qrCodeUrl = digitalToken.qrCode;
      const base64Data = qrCodeUrl.replace(/^data:image\/png;base64,/, "");
      const qrImageBuffer = Buffer.from(base64Data, "base64");
      
      doc.font('Helvetica-Bold')
         .fontSize(14)
         .text('QR Code:', { align: 'center' });
      
      doc.moveDown();
      doc.image(qrImageBuffer, {
        fit: [200, 200],
        align: 'center'
      });
    } catch (error) {
      console.error('Error adding QR code to PDF:', error);
      throw new Error('Failed to add QR code to PDF');
    }
    
    doc.moveDown(2);

    // Add instructions
    doc.font('Helvetica-Bold')
       .fontSize(14)
       .text('Instructions:', { align: 'left' });
    
    doc.moveDown();
    doc.font('Helvetica')
       .fontSize(10)
       .text('1. Present this token at the polling booth', { align: 'left' })
       .text('2. Show the QR code to the polling officer', { align: 'left' })
       .text('3. Keep this token safe and do not share it', { align: 'left' })
       .text('4. This token is valid only for the specified time slot', { align: 'left' });
    
    // Add footer
    doc.moveDown(4);
    doc.font('Helvetica')
       .fontSize(8)
       .text('Generated on: ' + new Date().toLocaleString(), { align: 'center' })
       .text('© Election Commission of India', { align: 'center' });
    
    // Finalize PDF
    doc.end();
    
    // Wait for PDF to be generated
    const pdfBuffer = await pdfPromise;
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=digital_token_${user.name.replace(/\s+/g, '_')}.pdf`);
    
    // Send the PDF
    res.send(pdfBuffer);
    
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
