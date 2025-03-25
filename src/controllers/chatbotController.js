require('dotenv').config();
const axios = require('axios');
const ChatbotHistory = require('../models/chatbotModel');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

exports.getChatbotResponse = async (req, res) => {
    try {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: "Message is required" });
        }

        const prompt = `You are an India-specific voter assistance chatbot. Answer the following question strictly within the context of Indian elections and voting procedures, in a helpful, concise, and professional tone. If the query is not related to Indian voting or elections, clearly state that you can only answer questions about Indian voter and voting processes: "${message}"`;

        const response = await axios.post(
            GEMINI_URL,
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    maxOutputTokens: 100,
                    temperature: 0.2
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
            return res.status(500).json({ error: "Invalid response from AI" });
        }

        const reply = response.data.candidates[0].content.parts[0].text;

        if(!reply){
            return res.status(500).json({error:"AI returned an empty response"});
        }

        const chatEntry = new ChatbotHistory({ userMessage: message, botResponse: reply });
        await chatEntry.save();

        res.json({ reply });
    } catch (error) {
        console.error("Chatbot Error:", error.response?.data || error.message);
        if (error.response) {
            res.status(error.response.status).json({ error: "AI API error" });
        } else {
            res.status(500).json({ error: "Internal Server Error" });
        }
    }
};