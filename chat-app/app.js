const API_URL = "http://127.0.0.1:8000/api";
const WS_URL = "ws://127.0.0.1:8000/ws";

let socket = null;
let currentUsername = "";
let currentRoom = "";
let isRegisterMode = false;

// DOM Elements
const loginScreen = document.getElementById("login-screen");
const chatScreen = document.getElementById("chat-screen");
const usernameInput = document.getElementById("username-input");
const passwordInput = document.getElementById("password-input");
const confirmPasswordInput = document.getElementById("confirm-password-input");
const roomSelectGroup = document.getElementById("room-select-group");
const roomSelect = document.getElementById("room-select");

const tabLoginBtn = document.getElementById("tab-login-btn");
const tabRegisterBtn = document.getElementById("tab-register-btn");
const authSubmitBtn = document.getElementById("auth-submit-btn");
const logoutBtn = document.getElementById("logout-btn");

const roomTitle = document.getElementById("room-title");
const userInfo = document.getElementById("user-info");
const messagesContainer = document.getElementById("messages-container");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");

const userCount = document.getElementById("user-count");
const usersList = document.getElementById("users-list");

// 1. CHUYỂN ĐỔI TAB ĐĂNG NHẬP <-> ĐĂNG KÝ
tabLoginBtn.addEventListener("click", () => {
    isRegisterMode = false;
    tabLoginBtn.classList.add("active");
    tabRegisterBtn.classList.remove("active");
    confirmPasswordInput.classList.add("hidden");
    roomSelectGroup.classList.remove("hidden"); // Hiện ô chọn phòng
    authSubmitBtn.innerText = "Vào Phòng Chat";
    authSubmitBtn.style.background = "#0084ff";
});

tabRegisterBtn.addEventListener("click", () => {
    isRegisterMode = true;
    tabRegisterBtn.classList.add("active");
    tabLoginBtn.classList.remove("active");
    confirmPasswordInput.classList.remove("hidden");
    roomSelectGroup.classList.add("hidden"); // Ẩn ô chọn phòng khi đăng ký
    authSubmitBtn.innerText = "Tạo Tài Khoản Mới";
    authSubmitBtn.style.background = "#28a745";
});

// 2. XỬ LÝ SỰ KIỆN NÚT SUBMIT
authSubmitBtn.addEventListener("click", async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    const confirmPassword = confirmPasswordInput.value.trim();
    const room = roomSelect.value;

    if (!username || !password) {
        return alert("Vui lòng nhập đầy đủ tên tài khoản và mật khẩu!");
    }

    // XỬ LÝ ĐĂNG KÝ
    if (isRegisterMode) {
        if (password !== confirmPassword) {
            return alert("Mật khẩu xác nhận không khớp!");
        }

        try {
            const res = await fetch(`${API_URL}/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();

            if (!res.ok) {
                return alert(data.detail || "Đăng ký thất bại!");
            }

            alert("Đăng ký thành công! Hãy Đăng nhập.");
            tabLoginBtn.click(); // Tự động về tab Đăng nhập
        } catch (err) {
            console.error("Lỗi đăng ký:", err);
            alert("Không thể kết nối đến máy chủ Backend! Bật lại uvicorn.");
        }
    } 
    // XỬ LÝ ĐĂNG NHẬP
    else {
        try {
            const res = await fetch(`${API_URL}/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();
            if (!res.ok) {
                return alert(data.detail || "Sai tài khoản hoặc mật khẩu!");
            }

            currentUsername = data.username;
            currentRoom = room;

            loginScreen.classList.add("hidden");
            chatScreen.classList.remove("hidden");
            roomTitle.innerText = `Phòng: ${roomSelect.options[roomSelect.selectedIndex].text}`;
            userInfo.innerText = `Tài khoản: ${currentUsername}`;

            await loadHistory(room);
            connectWebSocket(room, currentUsername);
        } catch (error) {
            console.error("Lỗi khi đăng nhập:", error);
            alert("Không thể kết nối tới máy chủ Backend!");
        }
    }
});

// 3. LOAD LỊCH SỬ TIN NHẮN
async function loadHistory(room) {
    messagesContainer.innerHTML = "";
    try {
        const res = await fetch(`${API_URL}/messages/${encodeURIComponent(room)}`);
        const response = await res.json();
        if (Array.isArray(response)) {
            response.forEach(msg => renderMessage(msg));
            scrollToBottom();
        }
    } catch (err) {
        console.log("Không thể tải lịch sử tin nhắn:", err);
    }
}

// 4. KẾT NỐI WEBSOCKET
function connectWebSocket(room, username) {
    const wsEndpoint = `${WS_URL}/${encodeURIComponent(room)}/${encodeURIComponent(username)}`;
    socket = new WebSocket(wsEndpoint);

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "user_list") {
            updateUserList(data.users);
        } 
        else if (data.type === "edit_message") {
            const msgElem = document.getElementById(`msg-${data._id}`);
            if (msgElem) {
                const contentElem = msgElem.querySelector(".content");
                if (contentElem) contentElem.innerText = data.new_content + " (đã sửa)";
            }
        } 
        else if (data.type === "delete_message") {
            const msgElem = document.getElementById(`msg-${data._id}`);
            if (msgElem) {
                const contentElem = msgElem.querySelector(".content");
                if (contentElem) contentElem.innerHTML = `<i style="opacity:0.7">Tin nhắn đã được thu hồi</i>`;
                const actionsElem = msgElem.querySelector(".msg-actions");
                if (actionsElem) actionsElem.remove();
            }
        } 
        else {
            renderMessage(data);
            scrollToBottom();
        }
    };
}

// 5. HIỂN THỊ TIN NHẮN
function renderMessage(msg) {
    const div = document.createElement("div");

    if (msg.type === "system") {
        div.className = "msg system";
        div.innerHTML = `<div class="content">${msg.content} ${msg.timestamp ? '(' + msg.timestamp + ')' : ''}</div>`;
    } else {
        const isSent = msg.sender === currentUsername;
        div.className = `msg ${isSent ? 'sent' : 'received'}`;
        if (msg._id) div.id = `msg-${msg._id}`;

        let contentHtml = msg.content;
        if (msg.is_deleted) {
            contentHtml = `<i style="opacity:0.7">Tin nhắn đã được thu hồi</i>`;
        } else if (msg.is_edited) {
            contentHtml += " (đã sửa)";
        }

        let actionsHtml = "";
        if (isSent && !msg.is_deleted && msg._id) {
            actionsHtml = `
                <div class="msg-actions">
                    <span onclick="editMsg('${msg._id}')">Sửa</span>
                    <span onclick="deleteMsg('${msg._id}')">Thu hồi</span>
                </div>
            `;
        }

        div.innerHTML = `
            <div class="meta">${isSent ? '' : (msg.sender || 'Người dùng') + ' • '} ${msg.timestamp || ''}</div>
            <div class="content">${contentHtml}</div>
            ${actionsHtml}
        `;
    }

    messagesContainer.appendChild(div);
}

// 6. THAO TÁC SỬA / THU HỒI TIN NHẮN
window.editMsg = function(msgId) {
    const msgElem = document.getElementById(`msg-${msgId}`);
    const contentElem = msgElem ? msgElem.querySelector(".content") : null;
    const oldContent = contentElem ? contentElem.innerText.replace(" (đã sửa)", "") : "";

    const newContent = prompt("Nhập nội dung tin nhắn mới:", oldContent);
    if (newContent && newContent.trim() !== "" && newContent !== oldContent) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: "edit_message",
                message_id: msgId,
                new_content: newContent.trim()
            }));
        }
    }
};

window.deleteMsg = function(msgId) {
    if (confirm("Bạn có chắc chắn muốn thu hồi tin nhắn này?")) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: "delete_message",
                message_id: msgId
            }));
        }
    }
};

// 7. TIỆN ÍCH
function updateUserList(users) {
    if (!usersList || !userCount) return;
    userCount.innerText = users.length;
    usersList.innerHTML = users.map(u => `<li>🟢 ${u}</li>`).join("");
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function sendMessage() {
    const content = messageInput.value.trim();
    if (content && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            sender: currentUsername,
            content: content,
            type: "chat"
        }));
        messageInput.value = "";
    }
}

sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keypress", (e) => { if (e.key === "Enter") sendMessage(); });
logoutBtn.addEventListener("click", () => { if (socket) socket.close(); location.reload(); });