require('dotenv').config();
const axios = require('axios');
const ChatbotHistory = require('../models/chatbotModel');
const ChatMessage = require('../models/ChatMessage');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

exports.getChatbotResponse = async (req, res) => {
    try {
        // Check if API key is configured
        if (!GEMINI_API_KEY) {
            console.error("Gemini API key is not configured");
            return res.status(500).json({ error: "Chatbot service is not properly configured" });
        }

        const { message, userId, roomId } = req.body;

        if (!message) {
            return res.status(400).json({ error: "Message is required" });
        }

        // Create a room ID if not provided
        const chatRoomId = roomId || (userId ? `user_${userId}` : `guest_${Date.now()}`);

        const prompt = `You are an India-specific voter assistance chatbot. Your role is to help users with information about Indian elections and voting procedures. 
        Please provide accurate, helpful, and concise information about:
        - Voter registration process
        - Voter ID card
        - Election procedures
        - Polling booth locations
        - Voting rights and responsibilities
        - Election dates and schedules
        
        If the query is not related to Indian voting or elections, politely inform that you can only answer questions about Indian voter and voting processes.
        
        User's question: "${message}"`;

        const response = await axios.post(
            GEMINI_URL,
            {
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }],
                generationConfig: {
                    temperature: 0.3,
                    topP: 0.8,
                    topK: 40,
                    maxOutputTokens: 500
                }
            },
            {
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );

        if (!response.data || !response.data.candidates || response.data.candidates.length === 0) {
            console.error("Gemini API Error:", response.data);
            return res.status(500).json({ error: "Failed to generate response from AI" });
        }

        const reply = response.data.candidates[0].content.parts[0].text;

        if(!reply){
            return res.status(500).json({error: "AI returned an empty response"});
        }

        // Save user message to ChatMessage model
        const userMessage = new ChatMessage({
            userId: userId || null,
            room: chatRoomId,
            text: message,
            sender: 'user'
        });
        await userMessage.save();

        // Save bot response to ChatMessage model
        const botResponse = new ChatMessage({
            userId: userId || null,
            room: chatRoomId,
            text: reply,
            sender: 'system'
        });
        await botResponse.save();

        // Also save to old ChatbotHistory model for backward compatibility
        const chatEntry = new ChatbotHistory({ userMessage: message, botResponse: reply });
        await chatEntry.save();

        res.json({ 
            reply,
            roomId: chatRoomId,
            messageId: botResponse._id
        });
    } catch (error) {
        console.error("Chatbot Error:", error.response?.data || error.message);
        
        // Handle specific error cases
        if (error.response) {
            switch (error.response.status) {
                case 400:
                    return res.status(400).json({ error: "Invalid request to AI service" });
                case 401:
                    return res.status(500).json({ error: "AI service authentication failed" });
                case 404:
                    return res.status(500).json({ error: "AI model not found. Please check configuration." });
                case 429:
                    return res.status(429).json({ error: "Too many requests to AI service" });
                default:
                    return res.status(error.response.status).json({ error: "AI service error" });
            }
        } else if (error.request) {
            return res.status(503).json({ error: "AI service is unavailable" });
        } else {
            return res.status(500).json({ error: "Internal server error" });
        }
    }
};

// Get chat history for a specific room
exports.getChatHistory = async (req, res) => {
    try {
        const { roomId } = req.params;
        const { limit = 50 } = req.query;
        
        if (!roomId) {
            return res.status(400).json({ error: "Room ID is required" });
        }
        
        const messages = await ChatMessage.find({ room: roomId })
            .sort({ createdAt: 1 })
            .limit(parseInt(limit));
            
        res.json(messages);
    } catch (error) {
        console.error("Error fetching chat history:", error);
        res.status(500).json({ error: "Failed to fetch chat history" });
    }
};