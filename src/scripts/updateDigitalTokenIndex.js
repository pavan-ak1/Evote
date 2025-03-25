const mongoose = require('mongoose');
const DigitalToken = require('../models/digitalToken');
require('dotenv').config();

async function updateIndex() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/evoting');
    console.log('Connected to MongoDB');

    // Drop the existing index
    await DigitalToken.collection.dropIndex('phoneNumber_1');
    console.log('Dropped existing phoneNumber index');

    // Create new sparse index
    await DigitalToken.collection.createIndex({ phoneNumber: 1 }, { sparse: true });
    console.log('Created new sparse index on phoneNumber');

    console.log('Index update completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error updating index:', error);
    process.exit(1);
  }
}

updateIndex(); 