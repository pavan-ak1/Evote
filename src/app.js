const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files - moved before API routes
app.use(express.static(path.join(__dirname, '../public')));

// Import routes
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const slotRoutes = require("./routes/timeSlotRoutes");
const adminRoutes = require("./routes/adminRoutes");
const digitalTokenRoutes = require("./routes/digitalTokenRoutes");
const expressRoutes = require("./routes/voterRoutes");
const chatbotRoutes = require("./routes/chatbotRoutes");

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/slots', slotRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/digital-token', digitalTokenRoutes);
app.use('/voter', expressRoutes);
app.use('/api/chatbot', chatbotRoutes);

// Add backward compatibility routes
app.use('/admin', adminRoutes);
app.use('/auth', authRoutes);
app.use('/api/timeslots', slotRoutes);
app.use('/timeslots', slotRoutes);

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/evoting', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 45000
})
.then(() => console.log('MongoDB connected in app.js'))
.catch(err => console.error('MongoDB connection error in app.js:', err));

// Default route
app.get('*', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Export the app
module.exports = app; 