const API_URL = "http://127.0.0.1:8000/api";
const WS_URL = "ws://127.0.0.1:8000/ws";

let socket = null;
let currentUsername = "";
let currentRoom = "";

// DOM Elements
const loginScreen = document.getElementById("login-screen");
const chatScreen = document.getElementById("chat-screen");
const usernameInput = document.getElementById("username-input");
const roomSelect = document.getElementById("room-select");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");

const roomTitle = document.getElementById("room-title");
const userInfo = document.getElementById("user-info");
const messagesContainer = document.getElementById("messages-container");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");

const userCount = document.getElementById("user-count");
const usersList = document.getElementById("users-list");

// 1. ĐĂNG NHẬP
loginBtn.addEventListener("click", async () => {
    const username = usernameInput.value.trim();
    const room = roomSelect.value;

    if (!username) return alert("Vui lòng nhập tên!");

    currentUsername = username;
    currentRoom = room;

    // Gọi API Login
    await fetch(`${API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username })
    });

    // Chuyển giao diện
    loginScreen.classList.add("hidden");
    chatScreen.classList.remove("hidden");
    roomTitle.innerText = `Phòng: ${roomSelect.options[roomSelect.selectedIndex].text}`;
    userInfo.innerText = `Tài khoản: ${username}`;

    // Tải lịch sử & Đăng ký WebSocket
    await loadHistory(room);
    connectWebSocket(room, username);
});

// 2. LOAD LỊCH SỬ TIN NHẮN
async function loadHistory(room) {
    messagesContainer.innerHTML = "";
    const res = await fetch(`${API_URL}/messages/${room}`);
    const history = await res.json();
    history.forEach(msg => renderMessage(msg));
    scrollToBottom();
}

// 3. KẾT NỐI WEBSOCKET
function connectWebSocket(room, username) {
    socket = new WebSocket(`${WS_URL}/${room}/${username}`);

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "user_list") {
            updateUserList(data.users);
        } else {
            renderMessage(data);
            scrollToBottom();
        }
    };
}

// 4. HIỂN THỊ TIN NHẮN & THÔNG BÁO
function renderMessage(msg) {
    const div = document.createElement("div");

    if (msg.type === "system") {
        div.className = "msg system";
        div.innerHTML = `<div class="content">${msg.content} (${msg.timestamp})</div>`;
    } else {
        const isSent = msg.sender === currentUsername;
        div.className = `msg ${isSent ? 'sent' : 'received'}`;
        div.innerHTML = `
            <div class="meta">${isSent ? '' : msg.sender + ' • '} ${msg.timestamp || ''}</div>
            <div class="content">${msg.content}</div>
        `;
    }

    messagesContainer.appendChild(div);
}

// 5. CẬP NHẬT DANH SÁCH ONLINE
function updateUserList(users) {
    userCount.innerText = users.length;
    usersList.innerHTML = users.map(u => `<li>🟢 ${u}</li>`).join("");
}

// Auto Scroll xuống cuối
function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// 6. GỬI TIN NHẮN
function sendMessage() {
    const content = messageInput.value.trim();
    if (content && socket) {
        socket.send(JSON.stringify({ content }));
        messageInput.value = "";
    }
}

sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendMessage();
});

// THOÁT
logoutBtn.addEventListener("click", () => {
    if (socket) socket.close();
    location.reload();
});