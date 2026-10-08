// --- CẤU HÌNH ĐƯỜNG DẪN BACKEND ---
// Tự động nhận diện chạy máy local hay trên web
const IS_LOCAL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

// --- CẤU HÌNH ĐƯỜNG DẪN BACKEND LOCAL ---
const API_BASE_URL = "http://127.0.0.1:8000";
const WS_BASE_URL  = "ws://127.0.0.1:8000/ws";
// --- QUẢN LÝ TRẠNG THÁI ---
let socket = null;
let currentUser = null;

// --- LẤY CÁC THÀNH PHẦN DOM ---
const loginScreen = document.getElementById("login-screen");
const chatScreen = document.getElementById("chat-screen");
const usernameInput = document.getElementById("username-input");
const loginBtn = document.getElementById("login-btn");
const userDisplay = document.getElementById("user-display");

const messagesBox = document.getElementById("messages-box");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");

// 1. BƯỚC ĐĂNG NHẬP
loginBtn.addEventListener("click", async () => {
    const username = usernameInput.value.trim();
    if (!username) {
        alert("Vui lòng nhập tên tài khoản!");
        return;
    }

    try {
        // Gửi API Đăng nhập sang Backend FastAPI (Thành viên 1)
        const response = await fetch(`${API_BASE_URL}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: username })
        });

        if (response.ok) {
            const data = await response.json();
            currentUser = data.username || username;
        } else {
            // Mẹo: Nếu Backend chưa dựng kịp API, tạm thời cho đăng nhập giả lập để test UI
            console.warn("Backend API chưa sẵn sàng, dùng giả lập username.");
            currentUser = username;
        }

        // Chuyển màn hình UI
        userDisplay.textContent = `@${currentUser}`;
        loginScreen.classList.add("hidden");
        chatScreen.classList.remove("hidden");

        // Kết nối WebSocket ngay
        initWebSocket();

    } catch (error) {
        console.error("Lỗi kết nối Backend, bật chế độ Demo Offline:", error);
        // Cho phép vào test giao diện ngay cả khi chưa mở Backend
        currentUser = username;
        userDisplay.textContent = `@${currentUser}`;
        loginScreen.classList.add("hidden");
        chatScreen.classList.remove("hidden");
        initWebSocket();
    }
});

// 2. MỞ KẾT NỐI WEBSOCKET REALTIME
function initWebSocket() {
    try {
        socket = new WebSocket(WS_BASE_URL);

        socket.onopen = () => {
            console.log("🟢 WebSocket đã kết nối thành công!");
        };

        // Khi nhận được tin nhắn từ Server Backend
        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            // data nhận về dự kiến: { sender: "user1", content: "hello" }
            renderMessage(data.sender, data.content);
        };

        socket.onclose = () => {
            console.log("🔴 WebSocket đã đóng kết nối.");
        };

        socket.onerror = (err) => {
            console.error("Lỗi WebSocket:", err);
        };
    } catch (e) {
        console.log("Chưa thể kết nối WebSocket do Backend chưa bật.");
    }
}

// 3. XỬ LÝ GỬI TIN NHẮN
function handleSendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    const payload = {
        sender: currentUser,
        content: text
    };

    // Nếu WebSocket đang mở thì gửi qua Server
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
    } else {
        // Nếu chưa bật Backend, tự hiện tin nhắn lên màn hình để TEST UI
        renderMessage(currentUser, text);
    }

    // Xóa trống ô nhập & focus lại
    messageInput.value = "";
    messageInput.focus();
}

// Sự kiện bấm nút Gửi hoặc nhấn phím Enter
sendBtn.addEventListener("click", handleSendMessage);
messageInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") handleSendMessage();
});

// 4. HIỂN THỊ TIN NHẮN LÊN MÀN HÌNH & TỰ ĐỘNG CUỘN (AUTO-SCROLL)
function renderMessage(sender, text) {
    const isMe = sender === currentUser;
    
    const msgDiv = document.createElement("div");
    msgDiv.classList.add("msg", isMe ? "me" : "other");

    msgDiv.innerHTML = `
        <span class="sender-name">${isMe ? "Bạn" : sender}</span>
        <div class="msg-text">${text}</div>
    `;

    messagesBox.appendChild(msgDiv);

    // Tự động cuộn xuống tin nhắn mới nhất
    messagesBox.scrollTop = messagesBox.scrollHeight;
}