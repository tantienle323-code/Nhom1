const API_BASE = window.CHAT_API_URL || `${location.protocol === "https:" ? "https" : "http"}://${location.hostname || "127.0.0.1"}:8080`;
const WS_BASE = window.CHAT_WS_URL || `${API_BASE.startsWith("https:") ? "wss" : "ws"}://${new URL(API_BASE).host}/ws`;
const API_URL = `${API_BASE}/api`;
const TOKEN_KEY = "chat_access_token";
const DEFAULT_AVATAR = "https://via.placeholder.com/44";

let socket = null;
let currentUsername = "";
let currentTargetUser = "";
let currentRoom = "";
let accessToken = localStorage.getItem(TOKEN_KEY) || "";
let isRegisterMode = false;
let users = [];
let selectedMemoryMessageId = null;
const onlineUsers = new Set();

const loginScreen = document.getElementById("login-screen");
const chatScreen = document.getElementById("chat-screen");
const authForm = document.getElementById("auth-form");
const usernameInput = document.getElementById("username-input");
const passwordInput = document.getElementById("password-input");
const confirmPasswordInput = document.getElementById("confirm-password-input");
const tabLoginBtn = document.getElementById("tab-login-btn");
const tabRegisterBtn = document.getElementById("tab-register-btn");
const authSubmitBtn = document.getElementById("auth-submit-btn");
const logoutBtn = document.getElementById("logout-btn");
const headerName = document.getElementById("header-name");
const headerAvatar = document.getElementById("header-avatar");
const headerStatus = document.getElementById("header-status");
const messagesContainer = document.getElementById("messages-container");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const usersList = document.getElementById("users-list");
const userSearch = document.querySelector(".tg-search-wrapper input");
const adminLink = document.getElementById("admin-link");
const chatLayout = document.getElementById("chat-screen");
const profileModal = document.getElementById("profile-modal");
const profileUsername = document.getElementById("profile-username");
const profileAvatarInput = document.getElementById("profile-avatar-input");
const profileBioInput = document.getElementById("profile-bio-input");
const worldOpenButton = document.getElementById("world-open-btn");
const worldModal = document.getElementById("world-modal");
const worldMemoryForm = document.getElementById("world-memory-form");
const worldMemoryTitle = document.getElementById("world-memory-title");
const worldMemoryNote = document.getElementById("world-memory-note");
const worldMemories = document.getElementById("world-memories");
const worldFeedback = document.getElementById("world-feedback");
const worldSourcePreview = document.getElementById("world-source-preview");
const worldSourceText = document.getElementById("world-source-text");
const musicModal = document.getElementById("music-modal");
const musicPlaylistElement = document.getElementById("music-playlist");
const musicLinkForm = document.getElementById("music-link-form");
const musicLinkInput = document.getElementById("music-link-input");
const musicLinkName = document.getElementById("music-link-name");
const musicTrackName = document.getElementById("music-track-name");
const musicPlaybackStatus = document.getElementById("music-playback-status");
const musicPreviousButton = document.getElementById("music-previous-btn");
const musicStopButton = document.getElementById("music-stop-btn");
const musicNextButton = document.getElementById("music-next-btn");
const musicYouTubeFrame = document.getElementById("music-youtube-frame");
const musicEmbedEmpty = document.getElementById("music-embed-empty");
const musicOpenSource = document.getElementById("music-open-source");
const musicFeedback = document.getElementById("music-feedback");
const musicTrackCount = document.getElementById("music-track-count");
let musicPlaylist = [];
let currentMusicIndex = -1;

function formatApiError(detail) {
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
        const messages = detail.map((item) => {
            if (typeof item === "string") return item;
            if (!item || typeof item !== "object") return "";
            const field = Array.isArray(item.loc) ? item.loc.at(-1) : "";
            if (field === "username" && item.type === "string_too_short") {
                return "Tên tài khoản phải có ít nhất 3 ký tự.";
            }
            if (field === "username" && item.type === "string_too_long") {
                return "Tên tài khoản không được dài quá 30 ký tự.";
            }
            if (field === "password" && item.type === "string_too_short") {
                return "Mật khẩu phải có ít nhất 8 ký tự.";
            }
            return String(item.msg || "Dữ liệu nhập chưa hợp lệ.").replace(/^Value error,\s*/, "");
        }).filter(Boolean);
        return [...new Set(messages)].join("\n");
    }
    return "Yêu cầu không thành công.";
}

async function apiFetch(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${API_URL}${path}`, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && accessToken) {
        signOut(false);
    }
    if (!response.ok) throw new Error(formatApiError(data.detail));
    return data;
}

function setAuthenticated(username, token, isAdmin) {
    currentUsername = username;
    accessToken = token;
    localStorage.setItem(TOKEN_KEY, token);
    loadYouTubePlaylist(username);
    if (adminLink) adminLink.classList.toggle("hidden", !isAdmin);
    loginScreen.classList.add("hidden");
    chatScreen.classList.remove("hidden");
    loadUsersList();
}

function showLogin() {
    chatScreen.classList.add("hidden");
    loginScreen.classList.remove("hidden");
}

function signOut(reload = true) {
    if (musicYouTubeFrame) {
        musicYouTubeFrame.src = "about:blank";
        musicYouTubeFrame.classList.add("hidden");
    }
    if (musicEmbedEmpty) musicEmbedEmpty.classList.remove("hidden");
    if (musicOpenSource) musicOpenSource.classList.add("hidden");
    if (musicModal) musicModal.classList.add("hidden");
    musicPlaylist = [];
    currentMusicIndex = -1;
    renderMusicPlaylist();
    if (musicTrackName) musicTrackName.textContent = "Chưa chọn bài hát";
    if (musicPlaybackStatus) musicPlaybackStatus.textContent = "Dán link YouTube để bắt đầu.";
    accessToken = "";
    currentUsername = "";
    localStorage.removeItem(TOKEN_KEY);
    if (socket) {
        const oldSocket = socket;
        socket = null;
        oldSocket.close();
    }
    if (reload) location.reload();
    else showLogin();
}

if (tabLoginBtn) {
    tabLoginBtn.addEventListener("click", () => {
        isRegisterMode = false;
        tabLoginBtn.classList.add("active");
        if (tabRegisterBtn) tabRegisterBtn.classList.remove("active");
        if (confirmPasswordInput) {
            confirmPasswordInput.classList.add("hidden");
            confirmPasswordInput.required = false;
        }
        if (passwordInput) passwordInput.autocomplete = "current-password";
        if (authSubmitBtn) authSubmitBtn.innerText = "ĐĂNG NHẬP";
    });
}

if (tabRegisterBtn) {
    tabRegisterBtn.addEventListener("click", () => {
        isRegisterMode = true;
        tabRegisterBtn.classList.add("active");
        if (tabLoginBtn) tabLoginBtn.classList.remove("active");
        if (confirmPasswordInput) {
            confirmPasswordInput.classList.remove("hidden");
            confirmPasswordInput.required = true;
        }
        if (passwordInput) passwordInput.autocomplete = "new-password";
        if (authSubmitBtn) authSubmitBtn.innerText = "ĐĂNG KÝ";
    });
}

if (authForm) {
    authForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        try {
            if (isRegisterMode) {
                if (password !== confirmPasswordInput.value) {
                    alert("Mật khẩu xác nhận không khớp.");
                    return;
                }
                await apiFetch("/register", {
                    method: "POST",
                    body: JSON.stringify({ username, password }),
                });
                alert("Đăng ký thành công. Hãy đăng nhập để tiếp tục.");
                if (tabLoginBtn) tabLoginBtn.click();
                passwordInput.value = "";
                confirmPasswordInput.value = "";
                return;
            }

            const result = await apiFetch("/login", {
                method: "POST",
                body: JSON.stringify({ username, password }),
            });
            setAuthenticated(result.username, result.access_token, result.is_admin);
            passwordInput.value = "";
        } catch (error) {
            alert(error.message || "Không thể kết nối Backend.");
        }
    });
}

function getPrivateRoomId(usernameA, usernameB) {
    const [first, second] = [usernameA, usernameB].sort();
    return `chat_${first}_${second}`;
}

function safeAvatarUrl(value) {
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) ? url.href : DEFAULT_AVATAR;
    } catch {
        return DEFAULT_AVATAR;
    }
}

function renderUsersList() {
    if (!usersList) return;
    const filter = userSearch ? userSearch.value.trim().toLocaleLowerCase() : "";
    usersList.replaceChildren();
    for (const user of users.filter((item) =>
        item.username !== currentUsername && item.username.toLocaleLowerCase().includes(filter)
    )) {
        const item = document.createElement("li");
        item.className = `tg-chat-item${currentTargetUser === user.username ? " active" : ""}`;
        item.addEventListener("click", () => switchPrivateChat(user.username, user.avatar));

        const avatar = document.createElement("img");
        avatar.src = user.avatar;
        avatar.alt = "";
        avatar.className = "tg-avatar";
        avatar.onerror = () => { avatar.src = DEFAULT_AVATAR; };

        const info = document.createElement("div");
        info.className = "info";
        const name = document.createElement("h4");
        name.textContent = user.username;
        const bio = document.createElement("p");
        bio.textContent = user.bio || "Nhấn để trò chuyện";
        info.append(name, bio);
        item.append(avatar, info);
        usersList.append(item);
    }
}

async function loadUsersList() {
    try {
        const usernames = await apiFetch("/users");
        const profiles = await Promise.all(usernames
            .filter((username) => username !== currentUsername)
            .map(async (username) => {
                const profile = await apiFetch(`/profile/${encodeURIComponent(username)}`);
                return {
                    username,
                    bio: profile.bio || "",
                    avatar: safeAvatarUrl(profile.avatar_url || DEFAULT_AVATAR),
                };
            }));
        users = profiles;
        renderUsersList();
    } catch (error) {
        console.error("Không thể tải danh sách người dùng:", error);
        alert(error.message || "Không thể tải danh sách người dùng.");
    }
}

function setPresence(username, isOnline) {
    if (isOnline) onlineUsers.add(username);
    else onlineUsers.delete(username);
    if (username === currentTargetUser && headerStatus) {
        headerStatus.textContent = isOnline ? "trực tuyến" : "ngoại tuyến";
        headerStatus.classList.toggle("is-online", isOnline);
    }
}

async function switchPrivateChat(targetUser, avatar) {
    currentTargetUser = targetUser;
    if (worldOpenButton) worldOpenButton.disabled = false;
    if (worldModal) worldModal.classList.add("hidden");
    clearMemorySource();
    if (socket) {
        const oldSocket = socket;
        socket = null;
        oldSocket.close();
    }
    currentRoom = getPrivateRoomId(currentUsername, targetUser);
    if (headerName) headerName.textContent = targetUser;
    if (headerAvatar) headerAvatar.src = safeAvatarUrl(avatar);
    if (headerStatus) {
        headerStatus.textContent = "đang kết nối...";
        headerStatus.classList.remove("is-online");
    }
    if (chatLayout) chatLayout.classList.add("mobile-chat-open");
    renderUsersList();

    try {
        await loadHistory(currentRoom);
        connectWebSocket(currentRoom, currentUsername);
    } catch (error) {
        alert(error.message || "Không thể mở cuộc trò chuyện.");
    }
}

async function loadHistory(room) {
    if (!messagesContainer) return;
    messagesContainer.replaceChildren();
    const history = await apiFetch(`/messages/${encodeURIComponent(room)}`);
    if (!history.length) {
        const notice = document.createElement("div");
        notice.className = "tg-empty-notice";
        notice.textContent = "Chưa có tin nhắn. Hãy bắt đầu trò chuyện!";
        messagesContainer.append(notice);
    } else {
        for (const message of history) renderMessage(message);
    }
    scrollToBottom();
}

function connectWebSocket(room, username) {
    const endpoint = `${WS_BASE}/${encodeURIComponent(room)}/${encodeURIComponent(username)}`;
    const activeSocket = new WebSocket(endpoint, [`bearer.${accessToken}`, "chat"]);
    socket = activeSocket;
    activeSocket.onopen = () => {
        if (socket === activeSocket && headerStatus) {
            headerStatus.textContent = "ngoại tuyến";
            headerStatus.classList.remove("is-online");
        }
    };
    activeSocket.onmessage = (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch {
            console.error("Backend gửi dữ liệu WebSocket không hợp lệ.");
            return;
        }

        if (data.type === "presence") {
            setPresence(data.username, data.online);
        } else if (data.type === "edit_message") {
            const message = document.getElementById(`msg-${data._id}`);
            const content = message?.querySelector(".content");
            if (content) content.textContent = `${data.new_content} (đã sửa)`;
        } else if (data.type === "delete_message") {
            const message = document.getElementById(`msg-${data._id}`);
            if (message) {
                message.querySelector(".content").textContent = "Tin nhắn đã được thu hồi";
                message.querySelector(".content").classList.add("deleted");
                message.querySelector(".msg-actions")?.remove();
            }
        } else if (data.type === "error") {
            alert(data.message);
        } else {
            renderMessage(data);
            scrollToBottom();
            if (worldModal && !worldModal.classList.contains("hidden")) refreshWorld();
        }
    };
    activeSocket.onclose = (event) => {
        if (socket !== activeSocket) return;
        socket = null;
        setPresence(currentTargetUser, false);
        if (event.code === 4401) {
            alert("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
            signOut(false);
        }
    };
    activeSocket.onerror = () => {
        if (socket === activeSocket && headerStatus) headerStatus.textContent = "mất kết nối";
    };
}

function renderMessage(message) {
    if (!messagesContainer) return;
    if (message._id && document.getElementById(`msg-${message._id}`)) return;
    messagesContainer.querySelector(".tg-empty-notice")?.remove();
    const item = document.createElement("div");
    const isSent = message.sender === currentUsername;
    item.className = `msg ${isSent ? "sent" : "received"}`;
    if (message._id) item.id = `msg-${message._id}`;

    const content = document.createElement("div");
    content.className = "content";

    const textVal = message.content || "";
    if (message.is_deleted) {
        content.textContent = "Tin nhắn đã được thu hồi";
        content.classList.add("deleted");
    } else if (textVal.startsWith("/uploads/")) {
        const fullUrl = `${API_BASE}${textVal}`;
        if (textVal.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
            const img = document.createElement("img");
            img.src = fullUrl;
            img.style.maxWidth = "260px";
            img.style.borderRadius = "8px";
            img.style.marginTop = "4px";
            img.style.display = "block";
            content.append(img);
        } else if (textVal.match(/\.(mp4|webm|ogg)$/i)) {
            const video = document.createElement("video");
            video.src = fullUrl;
            video.controls = true;
            video.style.maxWidth = "260px";
            video.style.borderRadius = "8px";
            video.style.marginTop = "4px";
            video.style.display = "block";
            content.append(video);
        } else {
            content.textContent = textVal;
        }
    } else {
        content.textContent = `${textVal}${message.is_edited ? " (đã sửa)" : ""}`;
    }

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = message.timestamp || "";
    item.append(content, meta);

    if (message._id && !message.is_deleted) {
        const actions = document.createElement("div");
        actions.className = "msg-actions";
        if (isSent && !textVal.startsWith("/uploads/")) {
            const edit = document.createElement("button");
            edit.type = "button";
            edit.textContent = "Sửa";
            edit.addEventListener("click", () => editMessage(message._id, content.textContent));
            actions.append(edit);
        }
        if (isSent) {
            const remove = document.createElement("button");
            remove.type = "button";
            remove.textContent = "Thu hồi";
            remove.addEventListener("click", () => deleteMessage(message._id));
            actions.append(remove);
        }
        const remember = document.createElement("button");
        remember.type = "button";
        remember.className = "save-memory-action";
        remember.textContent = "🌱 Lưu kỷ niệm";
        remember.addEventListener("click", () => openWorld(message));
        actions.append(remember);
        item.append(actions);
    }
    messagesContainer.append(item);
}

function clearMemorySource() {
    selectedMemoryMessageId = null;
    if (worldSourceText) worldSourceText.textContent = "";
    if (worldSourcePreview) worldSourcePreview.classList.add("hidden");
}

async function openWorld(message = null) {
    if (!currentTargetUser) return;
    if (worldMemoryForm) worldMemoryForm.reset();
    if (worldFeedback) {
        worldFeedback.textContent = "";
        worldFeedback.classList.remove("error");
    }
    clearMemorySource();
    if (message?._id) {
        selectedMemoryMessageId = message._id;
        if (worldSourceText) worldSourceText.textContent = message.content || "";
        if (worldSourcePreview) worldSourcePreview.classList.remove("hidden");
    }
    if (worldModal) worldModal.classList.remove("hidden");
    await refreshWorld();
}

async function refreshWorld() {
    const targetUser = currentTargetUser;
    if (!targetUser || !worldFeedback) return;
    worldFeedback.textContent = "Đang tải thế giới...";
    worldFeedback.classList.remove("error");
    try {
        const data = await apiFetch(`/world/${encodeURIComponent(targetUser)}`);
        if (targetUser !== currentTargetUser) return;
        document.getElementById("world-title").textContent = `${currentUsername} & ${targetUser}`;
        document.getElementById("world-landmark").textContent = data.world.landmark;
        document.getElementById("world-description").textContent = data.world.description;
        document.getElementById("world-stage-name").textContent = data.world.name;
        document.getElementById("world-stage-level").textContent = `Cấp ${data.world.level}`;
        const progressFill = document.getElementById("world-progress-fill");
        progressFill.style.width = `${Math.max(0, Math.min(100, data.world.progress))}%`;
        document.querySelector(".world-progress-track").setAttribute("aria-valuenow", data.world.progress);
        document.querySelector(".world-progress-track").setAttribute("aria-valuemin", "0");
        document.querySelector(".world-progress-track").setAttribute("aria-valuemax", "100");
        document.getElementById("world-progress-label").textContent = data.world.next_threshold === null ?
            "Thế giới đã đạt cấp cao nhất hiện tại." :
            `Thêm ${data.world.next_threshold - data.world.score} điểm chung để mở cột mốc tiếp theo.`;
        document.getElementById("world-message-count").textContent = data.stats.messages;
        document.getElementById("world-game-count").textContent = data.stats.games;
        document.getElementById("world-memory-count").textContent = data.stats.memories;
        renderWorldMemories(data.memories, data.memories_truncated);
        worldFeedback.textContent = "";
    } catch (error) {
        if (targetUser !== currentTargetUser) return;
        worldFeedback.textContent = error.message || "Không thể tải thế giới chung.";
        worldFeedback.classList.add("error");
    }
}

function renderWorldMemories(memories, truncated) {
    if (!worldMemories) return;
    worldMemories.replaceChildren();
    if (!memories.length) {
        const empty = document.createElement("p");
        empty.className = "world-empty-memories";
        empty.textContent = "Chưa có kỷ niệm nào. Hãy lưu điều đầu tiên mà hai bạn muốn nhớ!";
        worldMemories.append(empty);
        return;
    }
    for (const memory of memories) {
        const card = document.createElement("article");
        card.className = "world-memory-card";
        const title = document.createElement("h4");
        title.textContent = memory.title;
        card.append(title);
        if (memory.note) {
            const note = document.createElement("p");
            note.textContent = memory.note;
            card.append(note);
        }
        if (memory.source_excerpt) {
            const excerpt = document.createElement("blockquote");
            excerpt.textContent = `“${memory.source_excerpt}”`;
            card.append(excerpt);
        }
        const meta = document.createElement("div");
        meta.className = "world-memory-meta";
        const date = memory.created_at ? new Date(memory.created_at) : null;
        const dateLabel = date && !Number.isNaN(date.valueOf()) ?
            date.toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" }) : "";
        meta.textContent = `${memory.created_by}${dateLabel ? ` · ${dateLabel}` : ""}`;
        card.append(meta);
        if (memory.created_by === currentUsername) {
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "world-memory-delete";
            remove.textContent = "Xóa";
            remove.addEventListener("click", () => deleteWorldMemory(memory.id));
            card.append(remove);
        }
        worldMemories.append(card);
    }
    if (truncated) {
        const notice = document.createElement("p");
        notice.className = "world-empty-memories";
        notice.textContent = "Đang hiển thị 50 kỷ niệm gần nhất.";
        worldMemories.append(notice);
    }
}

if (worldOpenButton) worldOpenButton.addEventListener("click", () => openWorld());
const worldCloseBtn = document.getElementById("world-close-btn");
if (worldCloseBtn) {
    worldCloseBtn.addEventListener("click", () => {
        if (worldModal) worldModal.classList.add("hidden");
    });
}
if (worldModal) {
    worldModal.addEventListener("click", (event) => {
        if (event.target === worldModal) worldModal.classList.add("hidden");
    });
}
const clearSourceBtn = document.getElementById("world-clear-source-btn");
if (clearSourceBtn) clearSourceBtn.addEventListener("click", clearMemorySource);

if (worldMemoryForm) {
    worldMemoryForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const targetUser = currentTargetUser;
        const saveButton = document.getElementById("world-memory-save-btn");
        const payload = {
            title: worldMemoryTitle.value.trim(),
            note: worldMemoryNote.value.trim(),
            message_id: selectedMemoryMessageId,
        };
        if (saveButton) saveButton.disabled = true;
        if (worldFeedback) {
            worldFeedback.textContent = "Đang lưu kỷ niệm...";
            worldFeedback.classList.remove("error");
        }
        try {
            await apiFetch(`/world/${encodeURIComponent(targetUser)}/memories`, {
                method: "POST",
                body: JSON.stringify(payload),
            });
            if (targetUser !== currentTargetUser) return;
            worldMemoryForm.reset();
            clearMemorySource();
            if (worldFeedback) worldFeedback.textContent = "Đã lưu kỷ niệm vào thế giới chung.";
            await refreshWorld();
        } catch (error) {
            if (worldFeedback) {
                worldFeedback.textContent = error.message || "Không thể lưu kỷ niệm.";
                worldFeedback.classList.add("error");
            }
        } finally {
            if (saveButton) saveButton.disabled = false;
        }
    });
}

async function deleteWorldMemory(memoryId) {
    if (!confirm("Xóa kỷ niệm này khỏi thế giới chung?")) return;
    try {
        await apiFetch(`/world/${encodeURIComponent(currentTargetUser)}/memories/${encodeURIComponent(memoryId)}`, {
            method: "DELETE",
        });
        await refreshWorld();
    } catch (error) {
        if (worldFeedback) {
            worldFeedback.textContent = error.message || "Không thể xóa kỷ niệm.";
            worldFeedback.classList.add("error");
        }
    }
}

function editMessage(messageId, oldContent) {
    const newContent = prompt("Nhập nội dung mới:", oldContent.replace(/ \(đã sửa\)$/, ""));
    if (!newContent?.trim() || newContent.trim() === oldContent.replace(/ \(đã sửa\)$/, "")) return;
    if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: "edit_message",
            message_id: messageId,
            new_content: newContent.trim(),
        }));
    }
}

function deleteMessage(messageId) {
    if (confirm("Thu hồi tin nhắn này?") && socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "delete_message", message_id: messageId }));
    }
}

function scrollToBottom() {
    if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function sendMessage() {
    if (!currentRoom) return alert("Vui lòng chọn một người để nhắn tin.");
    const content = messageInput.value.trim();
    if (!content) return;
    if (content.length > 2000) return alert("Tin nhắn không được dài quá 2000 ký tự.");
    if (socket?.readyState !== WebSocket.OPEN) return alert("Đang kết nối lại. Vui lòng thử gửi lại.");
    socket.send(JSON.stringify({ type: "chat", content }));
    messageInput.value = "";
}

if (sendBtn) sendBtn.addEventListener("click", sendMessage);
if (messageInput) {
    messageInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });
}

const fileInput = document.getElementById("file-input");
if (fileInput) {
    fileInput.addEventListener("change", async function (e) {
        const file = e.target.files[0];
        if (!file) return;
        if (!currentRoom) return alert("Vui lòng chọn người cần nhắn trước khi đính kèm tệp.");

        const formData = new FormData();
        formData.append("file", file);

        try {
            const response = await fetch(`${API_URL}/upload`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${accessToken}`
                },
                body: formData
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.detail || "Không thể tải tệp lên.");
            }

            const data = await response.json();
            if (socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "chat", content: data.url }));
            }
            fileInput.value = "";
        } catch (error) {
            alert("Lỗi upload: " + error.message);
        }
    });
}

if (logoutBtn) logoutBtn.addEventListener("click", () => signOut());
if (userSearch) userSearch.addEventListener("input", renderUsersList);

const backUsersBtn = document.getElementById("back-users-btn");
if (backUsersBtn) {
    backUsersBtn.addEventListener("click", () => {
        if (chatLayout) chatLayout.classList.remove("mobile-chat-open");
    });
}

const myProfileBtn = document.getElementById("my-profile-modal-btn");
if (myProfileBtn) {
    myProfileBtn.addEventListener("click", async () => {
        try {
            const user = await apiFetch(`/profile/${encodeURIComponent(currentUsername)}`);
            if (profileUsername) profileUsername.textContent = user.username;
            if (profileAvatarInput) profileAvatarInput.value = user.avatar_url || "";
            if (profileBioInput) profileBioInput.value = user.bio || "";
            if (profileModal) profileModal.classList.remove("hidden");
        } catch (error) {
            alert(error.message || "Không thể tải hồ sơ.");
        }
    });
}

const closeProfileBtn = document.getElementById("close-profile-btn");
if (closeProfileBtn) {
    closeProfileBtn.addEventListener("click", () => {
        if (profileModal) profileModal.classList.add("hidden");
    });
}

if (profileModal) {
    profileModal.addEventListener("click", (event) => {
        if (event.target === profileModal) profileModal.classList.add("hidden");
    });
}

const saveProfileBtn = document.getElementById("save-profile-btn");
if (saveProfileBtn) {
    saveProfileBtn.addEventListener("click", async () => {
        try {
            await apiFetch(`/profile/${encodeURIComponent(currentUsername)}`, {
                method: "PUT",
                body: JSON.stringify({
                    avatar_url: profileAvatarInput.value.trim(),
                    bio: profileBioInput.value.trim(),
                }),
            });
            if (profileModal) profileModal.classList.add("hidden");
            await loadUsersList();
            const myProfile = await apiFetch(`/profile/${encodeURIComponent(currentUsername)}`);
            if (currentTargetUser === currentUsername && headerAvatar) {
                headerAvatar.src = safeAvatarUrl(myProfile.avatar_url);
            }
        } catch (error) {
            alert(error.message || "Không thể lưu hồ sơ.");
        }
    });
}

function parseYouTubeLink(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    const host = url.hostname.toLowerCase();
    const isShortLink = host === "youtu.be";
    const isYouTubeHost = [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtube-nocookie.com",
        "www.youtube-nocookie.com",
    ].includes(host);
    if (url.protocol !== "https:" || (!isShortLink && !isYouTubeHost)) return null;

    let videoId = "";
    if (isShortLink) {
        videoId = url.pathname.split("/").filter(Boolean)[0] || "";
    } else {
        videoId = url.searchParams.get("v") || "";
        const pathMatch = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/);
        if (!videoId && pathMatch) videoId = pathMatch[1];
    }
    const playlistId = url.searchParams.get("list") || "";
    if (videoId && !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
    if (playlistId && !/^[A-Za-z0-9_-]{10,100}$/.test(playlistId)) return null;
    if (!videoId && !playlistId) return null;

    const embedUrl = videoId ?
        new URL(`/embed/${encodeURIComponent(videoId)}`, "https://www.youtube-nocookie.com") :
        new URL("/embed/videoseries", "https://www.youtube-nocookie.com");
    embedUrl.searchParams.set("rel", "0");
    if (playlistId) embedUrl.searchParams.set("list", playlistId);
    return {
        embedUrl: embedUrl.href,
        key: `${videoId}:${playlistId}`,
        defaultName: playlistId && !videoId ? "Playlist YouTube" : `YouTube · ${videoId}`,
    };
}

function musicStorageKey(username) {
    return `chat_youtube_playlist_${username}`;
}

function saveYouTubePlaylist() {
    try {
        localStorage.setItem(musicStorageKey(currentUsername), JSON.stringify(
            musicPlaylist.map(({ name, sourceUrl }) => ({ name, sourceUrl }))
        ));
        return true;
    } catch (error) {
        if (musicFeedback) {
            musicFeedback.textContent = error.message || "Không thể lưu danh sách link trong trình duyệt.";
            musicFeedback.classList.add("error");
        }
        return false;
    }
}

function renderMusicPlaylist() {
    if (!musicPlaylistElement) return;
    musicPlaylistElement.replaceChildren();
    if (musicTrackCount) musicTrackCount.textContent = `${musicPlaylist.length} bài`;
    if (!musicPlaylist.length) {
        const empty = document.createElement("p");
        empty.className = "music-empty";
        empty.textContent = "Chưa có bài hát nào được lưu.";
        musicPlaylistElement.append(empty);
        return;
    }
    musicPlaylist.forEach((item, index) => {
        const card = document.createElement("div");
        card.className = `music-item${index === currentMusicIndex ? " active" : ""}`;
        card.addEventListener("click", () => playMusicTrack(index));

        const info = document.createElement("div");
        info.className = "info";
        const title = document.createElement("h5");
        title.textContent = item.name;
        info.append(title);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.textContent = "✕";
        removeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            removeMusicTrack(index);
        });

        card.append(info, removeBtn);
        musicPlaylistElement.append(card);
    });
}

function playMusicTrack(index) {
    if (index < 0 || index >= musicPlaylist.length) return;
    currentMusicIndex = index;
    const track = musicPlaylist[index];
    if (musicYouTubeFrame) {
        musicYouTubeFrame.src = track.embedUrl;
        musicYouTubeFrame.classList.remove("hidden");
    }
    if (musicEmbedEmpty) musicEmbedEmpty.classList.add("hidden");
    if (musicOpenSource) {
        musicOpenSource.href = track.sourceUrl;
        musicOpenSource.classList.remove("hidden");
    }
    if (musicTrackName) musicTrackName.textContent = track.name;
    if (musicPlaybackStatus) musicPlaybackStatus.textContent = "Đang phát qua YouTube...";
    renderMusicPlaylist();
}

function removeMusicTrack(index) {
    musicPlaylist.splice(index, 1);
    if (currentMusicIndex === index) {
        currentMusicIndex = -1;
        if (musicYouTubeFrame) {
            musicYouTubeFrame.src = "about:blank";
            musicYouTubeFrame.classList.add("hidden");
        }
        if (musicEmbedEmpty) musicEmbedEmpty.classList.remove("hidden");
        if (musicOpenSource) musicOpenSource.classList.add("hidden");
        if (musicTrackName) musicTrackName.textContent = "Chưa chọn bài hát";
        if (musicPlaybackStatus) musicPlaybackStatus.textContent = "Chọn link đã lưu hoặc dán link mới.";
    } else if (currentMusicIndex > index) {
        currentMusicIndex--;
    }
    saveYouTubePlaylist();
    renderMusicPlaylist();
}

function loadYouTubePlaylist(username) {
    musicPlaylist = [];
    currentMusicIndex = -1;
    if (musicYouTubeFrame) {
        musicYouTubeFrame.src = "about:blank";
        musicYouTubeFrame.classList.add("hidden");
    }
    if (musicEmbedEmpty) musicEmbedEmpty.classList.remove("hidden");
    if (musicOpenSource) musicOpenSource.classList.add("hidden");
    if (musicTrackName) musicTrackName.textContent = "Chưa chọn bài hát";
    if (musicPlaybackStatus) musicPlaybackStatus.textContent = "Chọn link đã lưu hoặc dán link mới.";
    if (musicFeedback) {
        musicFeedback.textContent = "";
        musicFeedback.classList.remove("error");
    }
    try {
        const stored = JSON.parse(localStorage.getItem(musicStorageKey(username)) || "[]");
        if (!Array.isArray(stored)) throw new TypeError("Danh sách nhạc đã lưu không hợp lệ.");
        for (const entry of stored.slice(0, 50)) {
            if (!entry || typeof entry.sourceUrl !== "string" || typeof entry.name !== "string") continue;
            const parsed = parseYouTubeLink(entry.sourceUrl);
            if (parsed) musicPlaylist.push({ ...parsed, name: entry.name, sourceUrl: entry.sourceUrl });
        }
    } catch (err) {
        console.error("Lỗi tải playlist YouTube:", err);
    }
    renderMusicPlaylist();
}

if (musicLinkForm) {
    musicLinkForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const url = musicLinkInput.value.trim();
        const name = musicLinkName.value.trim();
        const parsed = parseYouTubeLink(url);
        if (!parsed) {
            alert("Đường dẫn YouTube không hợp lệ.");
            return;
        }
        const trackName = name || parsed.defaultName;
        musicPlaylist.unshift({ ...parsed, name: trackName, sourceUrl: url });
        saveYouTubePlaylist();
        musicLinkInput.value = "";
        musicLinkName.value = "";
        playMusicTrack(0);
    });
}

if (musicPreviousButton) {
    musicPreviousButton.addEventListener("click", () => {
        if (currentMusicIndex > 0) playMusicTrack(currentMusicIndex - 1);
    });
}

if (musicNextButton) {
    musicNextButton.addEventListener("click", () => {
        if (currentMusicIndex < musicPlaylist.length - 1) playMusicTrack(currentMusicIndex + 1);
    });
}

if (musicStopButton) {
    musicStopButton.addEventListener("click", () => {
        currentMusicIndex = -1;
        if (musicYouTubeFrame) {
            musicYouTubeFrame.src = "about:blank";
            musicYouTubeFrame.classList.add("hidden");
        }
        if (musicEmbedEmpty) musicEmbedEmpty.classList.remove("hidden");
        if (musicOpenSource) musicOpenSource.classList.add("hidden");
        if (musicTrackName) musicTrackName.textContent = "Chưa chọn bài hát";
        if (musicPlaybackStatus) musicPlaybackStatus.textContent = "Đã dừng phát nhạc.";
        renderMusicPlaylist();
    });
}

const openMusicBtn = document.getElementById("music-open-btn");
if (openMusicBtn) {
    openMusicBtn.addEventListener("click", () => {
        if (musicModal) musicModal.classList.remove("hidden");
    });
}

const closeMusicBtn = document.getElementById("music-close-btn");
if (closeMusicBtn) {
    closeMusicBtn.addEventListener("click", () => {
        if (musicModal) musicModal.classList.add("hidden");
    });
}

if (musicModal) {
    musicModal.addEventListener("click", (e) => {
        if (e.target === musicModal) musicModal.classList.add("hidden");
    });
}

// Kiểm tra phiên đăng nhập hiện tại khi khởi chạy ứng dụng
if (accessToken) {
    apiFetch("/profile/me").then(user => {
        setAuthenticated(user.username, accessToken, user.is_admin);
    }).catch(() => {
        signOut(false);
    });
} else {
    showLogin();
}