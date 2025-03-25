document.addEventListener("DOMContentLoaded", () => {
    const chatBox = document.getElementById("chat-box");
    const userInput = document.getElementById("user-input");
    const chatbotContainer = document.getElementById("chatbot-container");

    window.toggleChatbot = function () {
        chatbotContainer.classList.toggle("hidden");
    };

    window.sendMessage = async function () {
        const message = userInput.value.trim();
        if (!message) return;

        chatBox.innerHTML += `<div>User: ${message}</div>`;
        userInput.value = "";

        const response = await fetch("/api/chatbot", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message }),
        });

        const data = await response.json();
        chatBox.innerHTML += `<div>Bot: ${data.reply}</div>`;
    };

    // 🎤 Voice Input Feature
    const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.onresult = (event) => {
        userInput.value = event.results[0][0].transcript;
        sendMessage();
    };

    window.startVoiceInput = function () {
        recognition.start();
    };
});
