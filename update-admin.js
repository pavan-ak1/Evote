const mongoose = require('mongoose');
const User = require('./src/models/userModel');
const bcrypt = require('bcrypt');
require('dotenv').config();

async function updateAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');
    
    // Find admin user
    const admin = await User.findOne({ email: 'admin@eci.gov.in' });
    if (!admin) {
      console.log('Admin user not found');
      await mongoose.connection.close();
      return;
    }
    
    // Update admin properties
    admin.isAdmin = true;
    
    // Hash new password and update
    const hashedPassword = await bcrypt.hash('Admin@123', 10);
    admin.password = hashedPassword;
    
    await admin.save();
    
    console.log('Admin user updated successfully:');
    console.log('Email: admin@eci.gov.in');
    console.log('Password: Admin@123');
    console.log('isAdmin: true');
    
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error updating admin:', error);
  }
}

updateAdmin(); 