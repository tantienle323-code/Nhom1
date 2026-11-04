const API_BASE = window.CHAT_API_URL || `${location.protocol === "https:" ? "https" : "http"}://${location.hostname || "127.0.0.1"}:8000`;
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
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

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
    adminLink.classList.toggle("hidden", !isAdmin);
    loginScreen.classList.add("hidden");
    chatScreen.classList.remove("hidden");
    loadUsersList();
}

function showLogin() {
    chatScreen.classList.add("hidden");
    loginScreen.classList.remove("hidden");
}

function signOut(reload = true) {
    musicYouTubeFrame.src = "about:blank";
    musicYouTubeFrame.classList.add("hidden");
    musicEmbedEmpty.classList.remove("hidden");
    musicOpenSource.classList.add("hidden");
    musicModal.classList.add("hidden");
    musicPlaylist = [];
    currentMusicIndex = -1;
    renderMusicPlaylist();
    musicTrackName.textContent = "Chưa chọn bài hát";
    musicPlaybackStatus.textContent = "Dán link YouTube để bắt đầu.";
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

tabLoginBtn.addEventListener("click", () => {
    isRegisterMode = false;
    tabLoginBtn.classList.add("active");
    tabRegisterBtn.classList.remove("active");
    confirmPasswordInput.classList.add("hidden");
    confirmPasswordInput.required = false;
    passwordInput.autocomplete = "current-password";
    authSubmitBtn.innerText = "ĐĂNG NHẬP";
});

tabRegisterBtn.addEventListener("click", () => {
    isRegisterMode = true;
    tabRegisterBtn.classList.add("active");
    tabLoginBtn.classList.remove("active");
    confirmPasswordInput.classList.remove("hidden");
    confirmPasswordInput.required = true;
    passwordInput.autocomplete = "new-password";
    authSubmitBtn.innerText = "ĐĂNG KÝ";
});

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
            tabLoginBtn.click();
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
    const filter = userSearch.value.trim().toLocaleLowerCase();
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
    if (username === currentTargetUser) {
        headerStatus.textContent = isOnline ? "trực tuyến" : "ngoại tuyến";
        headerStatus.classList.toggle("is-online", isOnline);
    }
}

async function switchPrivateChat(targetUser, avatar) {
    currentTargetUser = targetUser;
    worldOpenButton.disabled = false;
    worldModal.classList.add("hidden");
    clearMemorySource();
    if (socket) {
        const oldSocket = socket;
        socket = null;
        oldSocket.close();
    }
    currentRoom = getPrivateRoomId(currentUsername, targetUser);
    headerName.textContent = targetUser;
    headerAvatar.src = safeAvatarUrl(avatar);
    headerStatus.textContent = "đang kết nối...";
    headerStatus.classList.remove("is-online");
    chatLayout.classList.add("mobile-chat-open");
    renderUsersList();

    try {
        await loadHistory(currentRoom);
        connectWebSocket(currentRoom, currentUsername);
    } catch (error) {
        alert(error.message || "Không thể mở cuộc trò chuyện.");
    }
}

async function loadHistory(room) {
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
        if (socket === activeSocket) {
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
            if (!worldModal.classList.contains("hidden")) refreshWorld();
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
        if (socket === activeSocket) headerStatus.textContent = "mất kết nối";
    };
}

function renderMessage(message) {
    if (message._id && document.getElementById(`msg-${message._id}`)) return;
    messagesContainer.querySelector(".tg-empty-notice")?.remove();
    const item = document.createElement("div");
    const isSent = message.sender === currentUsername;
    item.className = `msg ${isSent ? "sent" : "received"}`;
    if (message._id) item.id = `msg-${message._id}`;

    const content = document.createElement("div");
    content.className = "content";
    content.textContent = message.is_deleted ? "Tin nhắn đã được thu hồi" :
        `${message.content || ""}${message.is_edited ? " (đã sửa)" : ""}`;
    if (message.is_deleted) content.classList.add("deleted");

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = message.timestamp || "";
    item.append(content, meta);

    if (message._id && !message.is_deleted) {
        const actions = document.createElement("div");
        actions.className = "msg-actions";
        if (isSent) {
            const edit = document.createElement("button");
            edit.type = "button";
            edit.textContent = "Sửa";
            edit.addEventListener("click", () => editMessage(message._id, content.textContent));
            const remove = document.createElement("button");
            remove.type = "button";
            remove.textContent = "Thu hồi";
            remove.addEventListener("click", () => deleteMessage(message._id));
            actions.append(edit, remove);
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
    worldSourceText.textContent = "";
    worldSourcePreview.classList.add("hidden");
}

async function openWorld(message = null) {
    if (!currentTargetUser) return;
    worldMemoryForm.reset();
    worldFeedback.textContent = "";
    worldFeedback.classList.remove("error");
    clearMemorySource();
    if (message?._id) {
        selectedMemoryMessageId = message._id;
        worldSourceText.textContent = message.content || "";
        worldSourcePreview.classList.remove("hidden");
    }
    worldModal.classList.remove("hidden");
    await refreshWorld();
}

async function refreshWorld() {
    const targetUser = currentTargetUser;
    if (!targetUser) return;
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

worldOpenButton.addEventListener("click", () => openWorld());
document.getElementById("world-close-btn").addEventListener("click", () => {
    worldModal.classList.add("hidden");
});
worldModal.addEventListener("click", (event) => {
    if (event.target === worldModal) worldModal.classList.add("hidden");
});
document.getElementById("world-clear-source-btn").addEventListener("click", clearMemorySource);
worldMemoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const targetUser = currentTargetUser;
    const saveButton = document.getElementById("world-memory-save-btn");
    const payload = {
        title: worldMemoryTitle.value.trim(),
        note: worldMemoryNote.value.trim(),
        message_id: selectedMemoryMessageId,
    };
    saveButton.disabled = true;
    worldFeedback.textContent = "Đang lưu kỷ niệm...";
    worldFeedback.classList.remove("error");
    try {
        await apiFetch(`/world/${encodeURIComponent(targetUser)}/memories`, {
            method: "POST",
            body: JSON.stringify(payload),
        });
        if (targetUser !== currentTargetUser) return;
        worldMemoryForm.reset();
        clearMemorySource();
        worldFeedback.textContent = "Đã lưu kỷ niệm vào thế giới chung.";
        await refreshWorld();
    } catch (error) {
        worldFeedback.textContent = error.message || "Không thể lưu kỷ niệm.";
        worldFeedback.classList.add("error");
    } finally {
        saveButton.disabled = false;
    }
});

async function deleteWorldMemory(memoryId) {
    if (!confirm("Xóa kỷ niệm này khỏi thế giới chung?")) return;
    try {
        await apiFetch(`/world/${encodeURIComponent(currentTargetUser)}/memories/${encodeURIComponent(memoryId)}`, {
            method: "DELETE",
        });
        await refreshWorld();
    } catch (error) {
        worldFeedback.textContent = error.message || "Không thể xóa kỷ niệm.";
        worldFeedback.classList.add("error");
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
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
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

sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
});
logoutBtn.addEventListener("click", () => signOut());
userSearch.addEventListener("input", renderUsersList);
document.getElementById("back-users-btn").addEventListener("click", () => {
    chatLayout.classList.remove("mobile-chat-open");
});

document.getElementById("my-profile-modal-btn").addEventListener("click", async () => {
    try {
        const user = await apiFetch(`/profile/${encodeURIComponent(currentUsername)}`);
        profileUsername.textContent = user.username;
        profileAvatarInput.value = user.avatar_url || "";
        profileBioInput.value = user.bio || "";
        profileModal.classList.remove("hidden");
    } catch (error) {
        alert(error.message || "Không thể tải hồ sơ.");
    }
});

document.getElementById("close-profile-btn").addEventListener("click", () => {
    profileModal.classList.add("hidden");
});

profileModal.addEventListener("click", (event) => {
    if (event.target === profileModal) profileModal.classList.add("hidden");
});

document.getElementById("save-profile-btn").addEventListener("click", async () => {
    try {
        await apiFetch(`/profile/${encodeURIComponent(currentUsername)}`, {
            method: "PUT",
            body: JSON.stringify({
                avatar_url: profileAvatarInput.value.trim(),
                bio: profileBioInput.value.trim(),
            }),
        });
        profileModal.classList.add("hidden");
        await loadUsersList();
        const myProfile = await apiFetch(`/profile/${encodeURIComponent(currentUsername)}`);
        if (currentTargetUser === currentUsername) headerAvatar.src = safeAvatarUrl(myProfile.avatar_url);
    } catch (error) {
        alert(error.message || "Không thể lưu hồ sơ.");
    }
});

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
        musicFeedback.textContent = error.message || "Không thể lưu danh sách link trong trình duyệt.";
        musicFeedback.classList.add("error");
        return false;
    }
}

function loadYouTubePlaylist(username) {
    musicPlaylist = [];
    currentMusicIndex = -1;
    musicYouTubeFrame.src = "about:blank";
    musicYouTubeFrame.classList.add("hidden");
    musicEmbedEmpty.classList.remove("hidden");
    musicOpenSource.classList.add("hidden");
    musicTrackName.textContent = "Chưa chọn bài hát";
    musicPlaybackStatus.textContent = "Chọn link đã lưu hoặc dán link mới.";
    musicFeedback.textContent = "";
    musicFeedback.classList.remove("error");
    try {
        const stored = JSON.parse(localStorage.getItem(musicStorageKey(username)) || "[]");
        if (!Array.isArray(stored)) throw new TypeError("Danh sách nhạc đã lưu không hợp lệ.");
        for (const entry of stored.slice(0, 50)) {
            if (!entry || typeof entry.sourceUrl !== "string" || typeof entry.name !== "string") continue;
            const parsed = parseYouTubeLink(entry.sourceUrl);
            if (parsed) musicPlaylist.push({ ...parsed, name: entry.name, sourceUrl: entry.sourceUrl });
        }
    } catch (error) {
        musicFeedback.textContent = error.message || "Không thể đọc danh sách link đã lưu.";
        musicFeedback.classList.add("error");
    }
    renderMusicPlaylist();
}

function renderMusicPlaylist() {
    musicPlaylistElement.replaceChildren();
    musicTrackCount.textContent = `${musicPlaylist.length} bài`;
    musicPreviousButton.disabled = musicPlaylist.length < 2 || currentMusicIndex < 0;
    musicStopButton.disabled = currentMusicIndex < 0;
    musicNextButton.disabled = musicPlaylist.length < 2 || currentMusicIndex < 0;
    if (!musicPlaylist.length) {
        const empty = document.createElement("li");
        empty.className = "music-playlist-empty";
        empty.textContent = "Chưa có link nào. Dán link YouTube để tạo danh sách nghe.";
        musicPlaylistElement.append(empty);
        return;
    }

    musicPlaylist.forEach((track, index) => {
        const row = document.createElement("li");
        row.className = `music-track-row${index === currentMusicIndex ? " active" : ""}`;
        const select = document.createElement("button");
        select.type = "button";
        select.className = "music-track-select";
        select.textContent = track.name;
        select.title = track.name;
        select.setAttribute("aria-label", `Phát ${track.name}`);
        select.addEventListener("click", () => playMusicTrack(index));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "music-track-remove";
        remove.textContent = "Xóa";
        remove.setAttribute("aria-label", `Xóa ${track.name} khỏi danh sách`);
        remove.addEventListener("click", () => removeMusicTrack(index));
        row.append(select, remove);
        musicPlaylistElement.append(row);
    });
}

function loadMusicTrack(index, autoplay = true) {
    const track = musicPlaylist[index];
    if (!track) return false;
    currentMusicIndex = index;
    const embedUrl = new URL(track.embedUrl);
    if (autoplay) embedUrl.searchParams.set("autoplay", "1");
    musicYouTubeFrame.src = embedUrl.href;
    musicYouTubeFrame.classList.remove("hidden");
    musicEmbedEmpty.classList.add("hidden");
    musicOpenSource.href = track.sourceUrl;
    musicOpenSource.classList.remove("hidden");
    musicTrackName.textContent = track.name;
    musicPlaybackStatus.textContent = autoplay ?
        "Đang mở trình phát YouTube. Điều khiển phát và âm lượng trong khung video." :
        "Đã chọn. Bấm nút phát trong khung YouTube để nghe.";
    musicFeedback.textContent = "";
    musicFeedback.classList.remove("error");
    renderMusicPlaylist();
    return true;
}

function playMusicTrack(index) {
    loadMusicTrack(index, true);
}

function addYouTubeLink(sourceUrl, name) {
    const parsed = parseYouTubeLink(sourceUrl);
    if (!parsed) {
        musicFeedback.textContent = "Link không hợp lệ. Hãy dùng link video hoặc playlist YouTube có HTTPS.";
        musicFeedback.classList.add("error");
        return;
    }
    const existingIndex = musicPlaylist.findIndex((track) => track.key === parsed.key);
    if (existingIndex >= 0) {
        musicLinkInput.value = "";
        musicLinkName.value = "";
        playMusicTrack(existingIndex);
        musicFeedback.textContent = "Link này đã có trong danh sách, đang mở lại.";
        musicFeedback.classList.remove("error");
        return;
    }
    if (musicPlaylist.length >= 50) {
        musicFeedback.textContent = "Danh sách phát tối đa 50 link.";
        musicFeedback.classList.add("error");
        return;
    }
    const title = name.trim().slice(0, 100) || parsed.defaultName;
    musicPlaylist.push({ ...parsed, name: title, sourceUrl });
    const saved = saveYouTubePlaylist();
    musicLinkInput.value = "";
    musicLinkName.value = "";
    playMusicTrack(musicPlaylist.length - 1);
    if (!saved) musicFeedback.classList.add("error");
}

function removeMusicTrack(index) {
    if (!musicPlaylist[index]) return;
    musicPlaylist.splice(index, 1);
    if (currentMusicIndex === index) {
        musicYouTubeFrame.src = "about:blank";
        musicYouTubeFrame.classList.add("hidden");
        musicEmbedEmpty.classList.remove("hidden");
        musicOpenSource.classList.add("hidden");
        currentMusicIndex = -1;
        musicTrackName.textContent = "Chưa chọn bài hát";
        musicPlaybackStatus.textContent = "Chọn link đã lưu hoặc dán link mới.";
    } else if (index < currentMusicIndex) {
        currentMusicIndex -= 1;
    }
    saveYouTubePlaylist();
    renderMusicPlaylist();
}

function skipMusicTrack(direction) {
    if (musicPlaylist.length < 2 || currentMusicIndex < 0) return;
    const nextIndex = (currentMusicIndex + direction + musicPlaylist.length) % musicPlaylist.length;
    playMusicTrack(nextIndex);
}

document.getElementById("music-open-btn").addEventListener("click", () => {
    musicModal.classList.remove("hidden");
});
document.getElementById("music-close-btn").addEventListener("click", () => {
    musicModal.classList.add("hidden");
});
musicModal.addEventListener("click", (event) => {
    if (event.target === musicModal) musicModal.classList.add("hidden");
});
musicLinkForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addYouTubeLink(musicLinkInput.value.trim(), musicLinkName.value);
});
musicPreviousButton.addEventListener("click", () => {
    skipMusicTrack(-1);
});
musicStopButton.addEventListener("click", () => {
    musicYouTubeFrame.src = "about:blank";
    musicYouTubeFrame.classList.add("hidden");
    musicEmbedEmpty.classList.remove("hidden");
    musicPlaybackStatus.textContent = "Đã dừng. Chọn link trong danh sách để nghe tiếp.";
});
musicNextButton.addEventListener("click", () => skipMusicTrack(1));

async function restoreSession() {
    if (!accessToken) return;
    try {
        const user = await apiFetch("/me");
        setAuthenticated(user.username, accessToken, user.is_admin);
    } catch {
        signOut(false);
    }
}

restoreSession();
