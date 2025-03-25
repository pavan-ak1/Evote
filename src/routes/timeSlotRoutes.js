const express = require("express");
const router = express.Router();
const { 
  createTimeSlot, 
  getAvailableSlots, 
  bookTimeSlot, 
  getQueueStatus, 
  getBookedSlot
} = require("../controllers/timeSlotController");

const { authMiddleware } = require("../middleware/authMiddleware"); // Updated import to get the named export

// 🔹 Admin-only route to create a new time slot
router.post("/create", createTimeSlot);

// 🔹 Get available time slots for a specific date
router.get("/available", getAvailableSlots);

// 🔹 Book a time slot (Protected Route)
router.post("/book", authMiddleware, bookTimeSlot);

// 🔹 Get queue status for a slot
router.get("/queue/:slotId", authMiddleware, getQueueStatus);

// 🔹 Get booked slots for the authenticated voter
router.get("/booked", authMiddleware, getBookedSlot);

module.exports = router;
