const API_URL = "http://127.0.0.1:8000/api";
const WS_URL = "ws://127.0.0.1:8000/ws";

let socket = null;
let currentUsername = "";
let currentTargetUser = "";
let currentRoom = "";
let isRegisterMode = false;

// DOM Elements
const loginScreen = document.getElementById("login-screen");
const chatScreen = document.getElementById("chat-screen");
const usernameInput = document.getElementById("username-input");
const passwordInput = document.getElementById("password-input");
const confirmPasswordInput = document.getElementById("confirm-password-input");

const tabLoginBtn = document.getElementById("tab-login-btn");
const tabRegisterBtn = document.getElementById("tab-register-btn");
const authSubmitBtn = document.getElementById("auth-submit-btn");
const logoutBtn = document.getElementById("logout-btn");

const headerName = document.getElementById("header-name");
const headerAvatar = document.getElementById("header-avatar");
const messagesContainer = document.getElementById("messages-container");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const usersList = document.getElementById("users-list");

const myProfileModalBtn = document.getElementById("my-profile-modal-btn");
const profileModal = document.getElementById("profile-modal");
const profileUsername = document.getElementById("profile-username");
const profileAvatarInput = document.getElementById("profile-avatar-input");
const profileBioInput = document.getElementById("profile-bio-input");
const saveProfileBtn = document.getElementById("save-profile-btn");
const closeProfileBtn = document.getElementById("close-profile-btn");

// 1. SWITCH TAB AUTH
tabLoginBtn.addEventListener("click", () => {
    isRegisterMode = false;
    tabLoginBtn.classList.add("active");
    tabRegisterBtn.classList.remove("active");
    confirmPasswordInput.classList.add("hidden");
    authSubmitBtn.innerText = "ĐĂNG NHẬP";
});

tabRegisterBtn.addEventListener("click", () => {
    isRegisterMode = true;
    tabRegisterBtn.classList.add("active");
    tabLoginBtn.classList.remove("active");
    confirmPasswordInput.classList.remove("hidden");
    authSubmitBtn.innerText = "ĐĂNG KÝ";
});

// 2. AUTH SUBMIT
authSubmitBtn.addEventListener("click", async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    const confirmPassword = confirmPasswordInput.value.trim();

    if (!username || !password) return alert("Vui lòng nhập tài khoản và mật khẩu!");

    if (isRegisterMode) {
        if (password !== confirmPassword) return alert("Mật khẩu không khớp!");
        try {
            const res = await fetch(`${API_URL}/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (!res.ok) return alert(data.detail || "Đăng ký thất bại!");
            alert("Đăng ký thành công!");
            tabLoginBtn.click();
        } catch (err) { alert("Không thể kết nối Backend!"); }
    } else {
        try {
            const res = await fetch(`${API_URL}/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (!res.ok) return alert(data.detail || "Sai thông tin đăng nhập!");

            currentUsername = data.username;
            loginScreen.classList.add("hidden");
            chatScreen.classList.remove("hidden");

            await loadUsersList();
        } catch (err) { alert("Không thể kết nối Backend!"); }
    }
});

// 3. TẠO ID PHÒNG CHAT RIÊNG 1-1
function getPrivateRoomId(u1, u2) {
    const sorted = [u1, u2].sort();
    return `chat_${sorted[0]}_${sorted[1]}`;
}

// 4. DANH SÁCH USER
async function loadUsersList() {
    try {
        const res = await fetch(`${API_URL}/users`);
        const users = await res.json();
        const otherUsers = users.filter(u => u !== currentUsername);

        usersList.innerHTML = "";
        for (let user of otherUsers) {
            const pRes = await fetch(`${API_URL}/profile/${encodeURIComponent(user)}`);
            const pData = pRes.ok ? await pRes.json() : {};
            const avatar = pData.avatar_url || "https://via.placeholder.com/44";

            const li = document.createElement("li");
            li.className = "tg-chat-item";
            li.onclick = () => switchPrivateChat(user, avatar);
            li.innerHTML = `
                <img src="${avatar}" class="tg-avatar" />
                <div class="info">
                    <h4>${user}</h4>
                    <p>${pData.bio || 'Nhấn để trò chuyện'}</p>
                </div>
            `;
            usersList.appendChild(li);
        }
    } catch (err) { console.error("Lỗi danh sách:", err); }
}

// 5. CHUYỂN CHAT
window.switchPrivateChat = async function(targetUser, avatar) {
    currentTargetUser = targetUser;
    if (socket) socket.close();

    currentRoom = getPrivateRoomId(currentUsername, targetUser);

    headerName.innerText = targetUser;
    headerAvatar.src = avatar || "https://via.placeholder.com/44";

    await loadHistory(currentRoom);
    connectWebSocket(currentRoom, currentUsername);
};

// 6. LỊCH SỬ TIN NHẮN
async function loadHistory(room) {
    messagesContainer.innerHTML = "";
    try {
        const res = await fetch(`${API_URL}/messages/${encodeURIComponent(room)}`);
        const response = await res.json();
        if (Array.isArray(response)) {
            response.forEach(msg => renderMessage(msg));
            scrollToBottom();
        }
    } catch (err) { console.log("Lỗi lịch sử:", err); }
}

// 7. WEBSOCKET
function connectWebSocket(room, username) {
    const wsEndpoint = `${WS_URL}/${encodeURIComponent(room)}/${encodeURIComponent(username)}`;
    socket = new WebSocket(wsEndpoint);

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "edit_message") {
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

// 8. RENDER MESSAGE
function renderMessage(msg) {
    const div = document.createElement("div");
    const isSent = msg.sender === currentUsername;
    div.className = `msg ${isSent ? 'sent' : 'received'}`;
    if (msg._id) div.id = `msg-${msg._id}`;

    let contentHtml = msg.content;
    if (msg.is_deleted) contentHtml = `<i style="opacity:0.7">Tin nhắn đã được thu hồi</i>`;
    else if (msg.is_edited) contentHtml += " (đã sửa)";

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
        <div class="content">${contentHtml}</div>
        <div class="meta">${msg.timestamp || ''}</div>
        ${actionsHtml}
    `;

    messagesContainer.appendChild(div);
}

// 9. ACTION
window.editMsg = function(msgId) {
    const msgElem = document.getElementById(`msg-${msgId}`);
    const contentElem = msgElem ? msgElem.querySelector(".content") : null;
    const oldContent = contentElem ? contentElem.innerText.replace(" (đã sửa)", "") : "";

    const newContent = prompt("Nhập nội dung mới:", oldContent);
    if (newContent && newContent.trim() !== "" && newContent !== oldContent) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "edit_message", message_id: msgId, new_content: newContent.trim() }));
        }
    }
};

window.deleteMsg = function(msgId) {
    if (confirm("Thu hồi tin nhắn?")) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "delete_message", message_id: msgId }));
        }
    }
};

function scrollToBottom() { messagesContainer.scrollTop = messagesContainer.scrollHeight; }

function sendMessage() {
    if (!currentRoom) return alert("Vui lòng chọn 1 người bạn để nhắn!");
    const content = messageInput.value.trim();
    if (content && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ sender: currentUsername, content: content, type: "chat" }));
        messageInput.value = "";
    }
}

sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keypress", (e) => { if (e.key === "Enter") sendMessage(); });
logoutBtn.addEventListener("click", () => { if (socket) socket.close(); location.reload(); });

// 10. PROFILE MODAL
myProfileModalBtn.addEventListener("click", async () => {
    try {
        const res = await fetch(`${API_URL}/profile/${encodeURIComponent(currentUsername)}`);
        const user = await res.json();
        profileUsername.innerText = user.username;
        profileAvatarInput.value = user.avatar_url || "";
        profileBioInput.value = user.bio || "";
        profileModal.classList.remove("hidden");
    } catch (err) { alert("Lỗi tải profile!"); }
});

closeProfileBtn.addEventListener("click", () => profileModal.classList.add("hidden"));

saveProfileBtn.addEventListener("click", async () => {
    try {
        const res = await fetch(`${API_URL}/profile/${encodeURIComponent(currentUsername)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                avatar_url: profileAvatarInput.value.trim(),
                bio: profileBioInput.value.trim()
            })
        });
        const data = await res.json();
        alert(data.message || "Cập nhật thành công!");
        profileModal.classList.add("hidden");
        await loadUsersList();
    } catch (err) { alert("Lỗi khi lưu!"); }
});