// models/userModel.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String },
    email: { type: String, required: true, unique: true },  
    password: { type: String, required: true },
    adharNumber: { type: String },
    phoneNumber: { type: String, required: true, unique: true },
    voterId: { type: String },
    phoneNumberVerified: { type: Boolean, default: false },
    faceEmbedding: { type: Array, required: true },
    digitalToken: String,
    // Change timeSlot from a string to a reference to TimeSlot (single booking)
    timeSlot: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "TimeSlot", 
      default: null 
    },
    isAdmin: { type: Boolean, default: false },
    faceVerifiedAt: {
      type: Date,
      default: null
    },
    tokenVerifiedAt: {
      type: Date,
      default: null
    }
});

module.exports = mongoose.model('User', userSchema);
