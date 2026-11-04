const TOKEN_KEY = "chat_access_token";
const API_BASE = window.CHAT_API_URL || `${location.protocol === "https:" ? "https" : "http"}://${location.hostname || "127.0.0.1"}:8000`;
const token = localStorage.getItem(TOKEN_KEY);
const status = document.getElementById("arcade-status");

async function initializeArcade() {
    if (!token) {
        location.href = "index.html";
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/api/me`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
            localStorage.removeItem(TOKEN_KEY);
            location.href = "index.html";
            return;
        }
        const user = await response.json();
        document.getElementById("player-name").textContent = user.username;
        status.textContent = "Chọn một trò chơi để bắt đầu.";
    } catch {
        status.textContent = "Không kết nối được máy chủ. Hãy thử tải lại trang.";
    }
}

initializeArcade();
