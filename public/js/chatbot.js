document.addEventListener("DOMContentLoaded", () => {
    const chatBox = document.getElementById("chat-box");
    const userInput = document.getElementById("user-input");
    const chatbotContainer = document.getElementById("chatbot-container");

    // Add initial welcome message
    chatBox.innerHTML = `<div class="bot-message">Hello! I'm your voting assistant. How can I help you today?</div>`;

    window.toggleChatbot = function () {
        chatbotContainer.classList.toggle("hidden");
        if (!chatbotContainer.classList.contains("hidden")) {
            userInput.focus();
        }
    };

    // Handle enter key press
    userInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            window.sendMessage();
        }
    });

    window.sendMessage = async function () {
        const message = userInput.value.trim();
        if (!message) return;

        // Add user message to chat
        chatBox.innerHTML += `<div class="user-message">${escapeHtml(message)}</div>`;
        userInput.value = "";
        
        // Add loading indicator
        const loadingDiv = document.createElement("div");
        loadingDiv.className = "bot-message loading";
        loadingDiv.textContent = "Typing...";
        chatBox.appendChild(loadingDiv);
        
        // Scroll to bottom
        chatBox.scrollTop = chatBox.scrollHeight;

        try {
            const token = localStorage.getItem("token");
            const response = await fetch("/api/chatbot", {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    ...(token ? { "Authorization": `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ 
                    message,
                    userId: localStorage.getItem("userId")
                }),
            });

            // Remove loading indicator
            loadingDiv.remove();

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.error);
            }

            if (data.reply) {
                chatBox.innerHTML += `<div class="bot-message">${escapeHtml(data.reply)}</div>`;
            } else {
                throw new Error("Invalid response from server");
            }
        } catch (error) {
            // Remove loading indicator if it exists
            loadingDiv.remove();
            
            console.error("Chatbot error:", error);
            chatBox.innerHTML += `<div class="bot-message error">Sorry, I encountered an error. Please try again later.</div>`;
        }

        // Scroll to bottom
        chatBox.scrollTop = chatBox.scrollHeight;
    };

    // Voice Input Feature
    if (window.SpeechRecognition || window.webkitSpeechRecognition) {
        const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
        recognition.lang = 'en-IN';
        recognition.continuous = false;
        recognition.interimResults = false;

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            userInput.value = transcript;
            window.sendMessage();
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            chatBox.innerHTML += `<div class="bot-message error">Sorry, I couldn't understand that. Please try typing your message.</div>`;
        };

        window.startVoiceInput = function () {
            recognition.start();
            chatBox.innerHTML += `<div class="bot-message">Listening...</div>`;
        };
    } else {
        window.startVoiceInput = function () {
            alert('Speech recognition is not supported in your browser.');
        };
    }

    // Helper function to escape HTML and prevent XSS
    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
});
