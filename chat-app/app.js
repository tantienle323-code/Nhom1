const API_BASE = window.CHAT_API_URL || location.origin;
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
let groups = [];
let selectedMemoryMessageId = null;
const onlineUsers = new Set();
let activeCall = null;
let pendingCallInvite = null;

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
const videoCallButton = document.getElementById("video-call-btn");
const callOverlay = document.getElementById("call-overlay");
const callTitle = document.getElementById("call-title");
const callStatus = document.getElementById("call-status");
const callCloseButton = document.getElementById("call-close-btn");
const callIncoming = document.getElementById("call-incoming");
const callIncomingText = document.getElementById("call-incoming-text");
const callAcceptButton = document.getElementById("call-accept-btn");
const callRejectButton = document.getElementById("call-reject-btn");
const callVideoGrid = document.getElementById("call-video-grid");
const callControls = document.getElementById("call-controls");
const callMicButton = document.getElementById("call-mic-btn");
const callCameraButton = document.getElementById("call-camera-btn");
const callScreenButton = document.getElementById("call-screen-btn");
const callHangupButton = document.getElementById("call-hangup-btn");
const messagesContainer = document.getElementById("messages-container");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const usersList = document.getElementById("users-list");
const groupsList = document.getElementById("groups-list");
const groupModal = document.getElementById("group-modal");
const groupNameInput = document.getElementById("group-name-input");
const groupMembersSelect = document.getElementById("group-members-select");
const createGroupButton = document.getElementById("open-create-group-btn");
const submitGroupButton = document.getElementById("submit-group-btn");
const cancelGroupButton = document.getElementById("cancel-group-btn");
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
const musicShareButton = document.getElementById("music-share-btn");
const musicLeaveShareButton = document.getElementById("music-leave-share-btn");
const musicShareStatus = document.getElementById("music-share-status");
const musicInviteBanner = document.getElementById("music-invite-banner");
const musicInviteDescription = document.getElementById("music-invite-description");
const musicInviteAcceptButton = document.getElementById("music-invite-accept");
const musicInviteDeclineButton = document.getElementById("music-invite-decline");
let musicPlaylist = [];
let currentMusicIndex = -1;
let currentMusicTrack = null;
let youtubePlayer = null;
let youtubePlayerReady = false;
let youtubePlayerPromise = null;
let youtubeApiPromise = null;
let youtubeBufferingTimeoutId = null;
const YOUTUBE_PLAYER_TIMEOUT_MS = 15000;
let musicPlaybackError = "";
let musicSyncActive = false;
let musicSyncRoom = "";
let musicSyncLeader = "";
let pendingMusicInvite = null;
let outgoingMusicInvite = false;
let suppressMusicSyncUntil = 0;
let lastObservedMusicTime = null;
let lastMusicHeartbeatAt = 0;

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

async function loadProtectedMedia(element, url) {
    try {
        const response = await fetch(`${API_BASE}${url}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (response.status === 401 && accessToken) signOut(false);
        if (!response.ok) throw new Error(`Tải tệp thất bại (${response.status}).`);
        const objectUrl = URL.createObjectURL(await response.blob());
        const revokeObjectUrl = () => URL.revokeObjectURL(objectUrl);
        element.addEventListener(element instanceof HTMLVideoElement ? "loadedmetadata" : "load", revokeObjectUrl, { once: true });
        element.addEventListener("error", revokeObjectUrl, { once: true });
        if (!element.isConnected) {
            revokeObjectUrl();
            return;
        }
        element.src = objectUrl;
    } catch (error) {
        console.error("Không thể tải tệp trong cuộc trò chuyện:", error);
        if (element instanceof HTMLImageElement) element.alt = "Không thể tải ảnh đính kèm.";
    }
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
    loadGroupsList();
}

function showLogin() {
    chatScreen.classList.add("hidden");
    loginScreen.classList.remove("hidden");
}

function signOut(reload = true) {
    finishVideoCall();
    resetMusicSyncSession(true);
    if (musicYouTubeFrame) {
        musicYouTubeFrame.classList.add("hidden");
    }
    if (youtubePlayerReady && youtubePlayer) youtubePlayer.stopVideo();
    if (musicEmbedEmpty) musicEmbedEmpty.classList.remove("hidden");
    if (musicOpenSource) musicOpenSource.classList.add("hidden");
    if (musicModal) musicModal.classList.add("hidden");
    musicPlaylist = [];
    currentMusicIndex = -1;
    currentMusicTrack = null;
    renderMusicPlaylist();
    updateMusicShareControls();
    if (musicTrackName) musicTrackName.textContent = "Chưa chọn bài hát";
    if (musicPlaybackStatus) musicPlaybackStatus.textContent = "Dán link YouTube để bắt đầu.";
    accessToken = "";
    currentUsername = "";
    currentTargetUser = "";
    currentRoom = "";
    groups = [];
    if (groupsList) groupsList.replaceChildren();
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

function renderGroupsList() {
    if (!groupsList) return;
    groupsList.replaceChildren();
    if (!groups.length) {
        const empty = document.createElement("li");
        empty.className = "tg-empty-notice";
        empty.textContent = "Chưa tham gia nhóm nào";
        groupsList.append(empty);
        return;
    }
    for (const group of groups) {
        const item = document.createElement("li");
        item.className = `tg-chat-item${currentRoom === group.id ? " active" : ""}`;
        item.addEventListener("click", () => switchGroupChat(group));
        const avatar = document.createElement("span");
        avatar.className = "tg-group-avatar";
        avatar.setAttribute("aria-hidden", "true");
        avatar.textContent = "👥";
        const info = document.createElement("div");
        info.className = "info";
        const name = document.createElement("h4");
        name.textContent = group.name;
        const detail = document.createElement("p");
        detail.textContent = `${group.members.length} thành viên`;
        info.append(name, detail);
        item.append(avatar, info);
        groupsList.append(item);
    }
}

function renderGroupMemberOptions() {
    if (!groupMembersSelect) return;
    groupMembersSelect.replaceChildren();
    for (const user of users) {
        const label = document.createElement("label");
        label.className = "group-member-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = user.username;
        const username = document.createElement("span");
        username.textContent = user.username;
        label.append(checkbox, username);
        groupMembersSelect.append(label);
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
        renderGroupMemberOptions();
    } catch (error) {
        console.error("Không thể tải danh sách người dùng:", error);
        alert(error.message || "Không thể tải danh sách người dùng.");
    }
}

async function loadGroupsList() {
    const username = currentUsername;
    try {
        const loadedGroups = await apiFetch("/groups");
        if (currentUsername !== username) return;
        groups = loadedGroups;
        renderGroupsList();
    } catch (error) {
        console.error("Không thể tải danh sách nhóm:", error);
        alert(error.message || "Không thể tải danh sách nhóm.");
    }
}

async function switchGroupChat(group) {
    finishVideoCall();
    resetMusicSyncSession(true);
    pendingMusicInvite = null;
    if (musicInviteBanner) musicInviteBanner.classList.add("hidden");
    currentTargetUser = "";
    currentRoom = group.id;
    updateVideoCallButton();
    if (worldOpenButton) worldOpenButton.disabled = true;
    if (worldModal) worldModal.classList.add("hidden");
    clearMemorySource();
    if (socket) {
        const oldSocket = socket;
        socket = null;
        oldSocket.close();
    }
    if (headerName) headerName.textContent = group.name;
    if (headerAvatar) headerAvatar.src = DEFAULT_AVATAR;
    if (headerStatus) {
        headerStatus.textContent = `${group.members.length} thành viên`;
        headerStatus.classList.remove("is-online");
    }
    updateMusicShareControls();
    if (chatLayout) chatLayout.classList.add("mobile-chat-open");
    renderUsersList();
    renderGroupsList();
    try {
        const room = group.id;
        messagesContainer.replaceChildren();
        const history = await apiFetch(`/groups/${encodeURIComponent(room)}/messages`);
        if (currentRoom !== room) return;
        if (!history.length) {
            const notice = document.createElement("div");
            notice.className = "tg-empty-notice";
            notice.textContent = "Nhóm chưa có tin nhắn. Hãy bắt đầu trò chuyện!";
            messagesContainer.append(notice);
        } else {
            for (const message of history) renderMessage(message);
        }
        scrollToBottom();
        connectWebSocket(room, currentUsername);
    } catch (error) {
        alert(error.message || "Không thể mở nhóm chat.");
    }
}

if (createGroupButton) {
    createGroupButton.addEventListener("click", () => {
        if (groupNameInput) groupNameInput.value = "";
        if (groupMembersSelect) {
            groupMembersSelect.querySelectorAll("input[type=checkbox]").forEach((checkbox) => {
                checkbox.checked = false;
            });
        }
        if (groupModal) groupModal.classList.remove("hidden");
    });
}

if (cancelGroupButton) {
    cancelGroupButton.addEventListener("click", () => {
        if (groupModal) groupModal.classList.add("hidden");
    });
}

if (groupModal) {
    groupModal.addEventListener("click", (event) => {
        if (event.target === groupModal) groupModal.classList.add("hidden");
    });
}

if (submitGroupButton) {
    submitGroupButton.addEventListener("click", async () => {
        const name = groupNameInput.value.trim();
        const selectedMembers = [...groupMembersSelect.querySelectorAll("input:checked")]
            .map((checkbox) => checkbox.value);
        if (!name) return alert("Vui lòng nhập tên nhóm.");
        if (!selectedMembers.length) return alert("Hãy chọn ít nhất một thành viên khác.");
        if (selectedMembers.length > 49) return alert("Mỗi nhóm có thể mời tối đa 49 thành viên khác.");
        submitGroupButton.disabled = true;
        try {
            const group = await apiFetch("/groups", {
                method: "POST",
                body: JSON.stringify({ name, members: selectedMembers }),
            });
            if (groupModal) groupModal.classList.add("hidden");
            await loadGroupsList();
            await switchGroupChat({
                ...group,
                members: group.members || [...selectedMembers, currentUsername],
            });
        } catch (error) {
            alert(error.message || "Không thể tạo nhóm.");
        } finally {
            submitGroupButton.disabled = false;
        }
    });
}

function setPresence(username, isOnline) {
    if (isOnline) onlineUsers.add(username);
    else onlineUsers.delete(username);
    if (username === currentTargetUser && headerStatus) {
        headerStatus.textContent = isOnline ? "trực tuyến" : "ngoại tuyến";
        headerStatus.classList.toggle("is-online", isOnline);
    }
}

function updateVideoCallButton() {
    if (videoCallButton) {
        videoCallButton.disabled =
            !currentRoom || socket?.readyState !== WebSocket.OPEN ||
            Boolean(activeCall) || Boolean(pendingCallInvite);
    }
}

function sendCallSignal(action, callId, details = {}) {
    if (socket?.readyState !== WebSocket.OPEN || !currentRoom || !callId) return false;
    socket.send(JSON.stringify({
        type: "call_signal",
        action,
        call_id: callId,
        ...details,
    }));
    return true;
}

function setCallStatus(message) {
    if (callStatus) callStatus.textContent = message;
}

function createCallVideoTile(username, local = false) {
    const tile = document.createElement("div");
    tile.className = `call-video-tile${local ? " local" : ""}`;
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = local;
    video.controls = !local;
    const label = document.createElement("span");
    label.textContent = local ? `${username} (bạn)` : username;
    tile.append(video, label);
    callVideoGrid?.append(tile);
    return { tile, video, label };
}

function setCallLocalStream(stream, isScreenShare = false) {
    if (!activeCall) return;
    let localTile = activeCall.localTile;
    if (!localTile) {
        localTile = createCallVideoTile(currentUsername, true);
        activeCall.localTile = localTile;
    }
    localTile.video.srcObject = stream;
    localTile.tile.classList.toggle("screen-share", isScreenShare);
    localTile.video.play().catch(() => {});
}

function renderCallStatus() {
    if (!activeCall) return;
    const others = [...activeCall.participants].filter((name) => name !== currentUsername);
    setCallStatus(others.length ? `Đang gọi cùng ${others.join(", ")}` : "Đang chờ người khác tham gia...");
}

function closeCallPeer(username) {
    const peer = activeCall?.peers.get(username);
    if (peer) {
        peer.pc.onicecandidate = null;
        peer.pc.ontrack = null;
        peer.pc.onconnectionstatechange = null;
        peer.pc.close();
        peer.tile.remove();
        activeCall.peers.delete(username);
    }
    activeCall.participants.delete(username);
    renderCallStatus();
}

function createCallPeer(username) {
    if (!activeCall) throw new Error("Cuộc gọi đã kết thúc.");
    const existing = activeCall.peers.get(username);
    if (existing) return existing;

    const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    const videoStream = activeCall.screenStream || activeCall.localStream;
    for (const track of videoStream.getVideoTracks()) pc.addTrack(track, videoStream);
    for (const track of activeCall.localStream.getAudioTracks()) {
        pc.addTrack(track, activeCall.localStream);
    }

    const remoteStream = new MediaStream();
    const { tile, video } = createCallVideoTile(username);
    video.srcObject = remoteStream;
    const peer = { pc, stream: remoteStream, tile, video, pendingCandidates: [] };
    activeCall.peers.set(username, peer);
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendCallSignal("ice", activeCall?.id, {
                target: username,
                candidate: event.candidate.toJSON(),
            });
        }
    };
    pc.ontrack = (event) => {
        const incomingStream = event.streams[0];
        if (incomingStream) {
            peer.video.srcObject = incomingStream;
            peer.stream = incomingStream;
        } else if (!peer.stream.getTracks().some((track) => track.id === event.track.id)) {
            peer.stream.addTrack(event.track);
        }
        peer.tile.classList.toggle(
            "audio-only",
            !peer.stream.getVideoTracks().some((track) => track.enabled),
        );
        peer.video.play().catch(() => {
            setCallStatus(`Nhấn Phát trên khung video của ${username} để bật hình/tiếng.`);
        });
    };
    pc.onconnectionstatechange = () => {
        if (!activeCall || !activeCall.peers.has(username)) return;
        if (pc.connectionState === "failed") {
            setCallStatus(`Không kết nối được với ${username}. Hãy thử cùng Wi-Fi hoặc cấu hình TURN.`);
        } else if (pc.connectionState === "connected") {
            renderCallStatus();
        }
    };
    return peer;
}

async function flushCallCandidates(peer) {
    for (const candidate of peer.pendingCandidates.splice(0)) {
        await peer.pc.addIceCandidate(candidate);
    }
}

async function createCallOffer(username) {
    const peer = createCallPeer(username);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    if (!sendCallSignal("offer", activeCall?.id, {
        target: username,
        description: peer.pc.localDescription,
    })) {
        throw new Error("Mất kết nối chat; không gửi được lời mời kết nối video.");
    }
}

async function handleCallSignal(data) {
    if (data.sender === currentUsername) return;

    if (data.action === "invite") {
        if (activeCall || pendingCallInvite) {
            sendCallSignal("reject", data.call_id);
            return;
        }
        pendingCallInvite = { ...data, room: currentRoom };
        updateVideoCallButton();
        if (callTitle) callTitle.textContent = currentRoom.startsWith("group_") ? "Cuộc gọi nhóm" : "Cuộc gọi video";
        if (callIncomingText) callIncomingText.textContent = `${data.sender} đang mời bạn tham gia cuộc gọi video.`;
        callIncoming?.classList.remove("hidden");
        callVideoGrid?.classList.add("hidden");
        callControls?.classList.add("hidden");
        callCloseButton?.classList.add("hidden");
        callOverlay?.classList.remove("hidden");
        setCallStatus("Cuộc gọi đến");
        return;
    }

    if (data.action === "reject") {
        if (activeCall?.id === data.call_id) {
            setCallStatus(`${data.sender} đã từ chối cuộc gọi.`);
        }
        return;
    }
    if (data.action === "peer_left") {
        if (activeCall?.id === data.call_id) closeCallPeer(data.sender);
        return;
    }
    if (data.action === "join") {
        if (!activeCall || activeCall.id !== data.call_id || data.sender === currentUsername) return;
        activeCall.participants.add(data.sender);
        renderCallStatus();
        try {
            await createCallOffer(data.sender);
        } catch (error) {
            console.error("Không thể kết nối người tham gia cuộc gọi:", error);
            setCallStatus(error.message || `Không thể kết nối với ${data.sender}.`);
        }
        return;
    }
    if (!activeCall || activeCall.id !== data.call_id || data.target !== currentUsername) return;
    activeCall.participants.add(data.sender);
    renderCallStatus();

    try {
        if (data.action === "offer") {
            const peer = createCallPeer(data.sender);
            await peer.pc.setRemoteDescription(data.description);
            await flushCallCandidates(peer);
            const answer = await peer.pc.createAnswer();
            await peer.pc.setLocalDescription(answer);
            if (!sendCallSignal("answer", activeCall.id, {
                target: data.sender,
                description: peer.pc.localDescription,
            })) throw new Error("Mất kết nối chat; không gửi được phản hồi cuộc gọi.");
        } else if (data.action === "answer") {
            const peer = activeCall.peers.get(data.sender);
            if (!peer) return;
            await peer.pc.setRemoteDescription(data.description);
            await flushCallCandidates(peer);
        } else if (data.action === "ice") {
            const peer = activeCall.peers.get(data.sender);
            if (!peer) return;
            if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate);
            else peer.pendingCandidates.push(data.candidate);
        }
    } catch (error) {
        console.error("Không thể xử lý tín hiệu cuộc gọi:", error);
        setCallStatus(`Lỗi kết nối với ${data.sender}. Hãy kiểm tra mạng hoặc bật HTTPS.`);
    }
}

async function acquireCallMedia() {
    if (!window.RTCPeerConnection || !window.MediaStream) {
        throw new Error("Trình duyệt này không hỗ trợ gọi video WebRTC.");
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("Trình duyệt yêu cầu HTTPS để dùng camera/micro trên thiết bị khác. Hãy mở trang bằng HTTPS.");
    }
    return navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    });
}

function prepareActiveCall(callId, initiator, localStream) {
    activeCall = {
        id: callId,
        room: currentRoom,
        initiator,
        localStream,
        screenStream: null,
        localTile: null,
        peers: new Map(),
        participants: new Set([currentUsername]),
    };
    callIncoming?.classList.add("hidden");
    callVideoGrid?.classList.remove("hidden");
    callControls?.classList.remove("hidden");
    callCloseButton?.classList.add("hidden");
    callOverlay?.classList.remove("hidden");
    if (callTitle) callTitle.textContent = currentRoom.startsWith("group_") ? "Cuộc gọi nhóm" : "Cuộc gọi video";
    setCallLocalStream(localStream);
    if (callMicButton) {
        callMicButton.textContent = "🎙️ Tắt mic";
        callMicButton.setAttribute("aria-pressed", "true");
    }
    if (callCameraButton) {
        callCameraButton.textContent = "📷 Tắt camera";
        callCameraButton.setAttribute("aria-pressed", "true");
    }
    if (callScreenButton) {
        callScreenButton.textContent = "🖥️ Chia sẻ màn hình";
        callScreenButton.setAttribute("aria-pressed", "false");
    }
    updateVideoCallButton();
    renderCallStatus();
}

async function startVideoCall() {
    if (!currentRoom || socket?.readyState !== WebSocket.OPEN || activeCall) return;
    const callRoom = currentRoom;
    const callSocket = socket;
    let localStream = null;
    try {
        localStream = await acquireCallMedia();
        if (currentRoom !== callRoom || socket !== callSocket || socket?.readyState !== WebSocket.OPEN) {
            localStream.getTracks().forEach((track) => track.stop());
            return;
        }
        const callId = crypto.randomUUID ?
            crypto.randomUUID() :
            ([...crypto.getRandomValues(new Uint8Array(16))]
                .map((value) => value.toString(16).padStart(2, "0"))
                .join(""));
        prepareActiveCall(callId, currentUsername, localStream);
        if (!sendCallSignal("invite", callId)) {
            finishVideoCall(false);
            alert("Không gửi được lời mời. Hãy kết nối lại chat rồi thử lại.");
            return;
        }
        setCallStatus("Đang mời thành viên trong cuộc trò chuyện...");
    } catch (error) {
        if (localStream && activeCall?.localStream !== localStream) {
            localStream.getTracks().forEach((track) => track.stop());
        }
        console.error("Không thể bắt đầu cuộc gọi video:", error);
        alert(error.message || "Không thể truy cập camera hoặc micro. Hãy kiểm tra quyền truy cập của trình duyệt.");
    }
}

async function acceptVideoCall() {
    const invite = pendingCallInvite;
    if (!invite || invite.room !== currentRoom || socket?.readyState !== WebSocket.OPEN) return;
    let localStream = null;
    try {
        localStream = await acquireCallMedia();
        if (pendingCallInvite?.call_id !== invite.call_id || socket?.readyState !== WebSocket.OPEN) {
            localStream.getTracks().forEach((track) => track.stop());
            return;
        }
        pendingCallInvite = null;
        prepareActiveCall(invite.call_id, invite.sender, localStream);
        activeCall.participants.add(invite.sender);
        renderCallStatus();
        if (!sendCallSignal("join", invite.call_id)) finishVideoCall(false);
    } catch (error) {
        if (localStream && activeCall?.localStream !== localStream) {
            localStream.getTracks().forEach((track) => track.stop());
        }
        console.error("Không thể tham gia cuộc gọi video:", error);
        setCallStatus(error.message || "Không thể truy cập camera hoặc micro.");
    }
}

function rejectVideoCall() {
    if (pendingCallInvite) sendCallSignal("reject", pendingCallInvite.call_id);
    pendingCallInvite = null;
    callOverlay?.classList.add("hidden");
    callIncoming?.classList.add("hidden");
    updateVideoCallButton();
}

function finishVideoCall(notify = true) {
    const call = activeCall;
    if (notify && call && call.room === currentRoom) sendCallSignal("leave", call.id);
    if (notify && pendingCallInvite?.room === currentRoom) {
        sendCallSignal("reject", pendingCallInvite.call_id);
    }
    activeCall = null;
    if (call) {
        for (const peer of call.peers.values()) peer.pc.close();
        for (const track of call.localStream.getTracks()) track.stop();
        for (const track of call.screenStream?.getTracks() || []) track.stop();
    }
    pendingCallInvite = null;
    callVideoGrid?.replaceChildren();
    callOverlay?.classList.add("hidden");
    callIncoming?.classList.add("hidden");
    callVideoGrid?.classList.remove("hidden");
    callControls?.classList.add("hidden");
    callCloseButton?.classList.add("hidden");
    updateVideoCallButton();
}

async function toggleCallScreenShare() {
    if (!activeCall) return;
    if (activeCall.screenStream) {
        stopCallScreenShare();
        return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
        setCallStatus("Trình duyệt này không hỗ trợ chia sẻ màn hình.");
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        if (!activeCall) {
            stream.getTracks().forEach((track) => track.stop());
            return;
        }
        activeCall.screenStream = stream;
        const screenTrack = stream.getVideoTracks()[0];
        for (const peer of activeCall.peers.values()) {
            const sender = peer.pc.getSenders().find((item) => item.track?.kind === "video");
            if (sender) await sender.replaceTrack(screenTrack);
        }
        setCallLocalStream(stream, true);
        if (callScreenButton) {
            callScreenButton.textContent = "⏹ Dừng chia sẻ";
            callScreenButton.setAttribute("aria-pressed", "true");
        }
        if (callCameraButton) callCameraButton.disabled = true;
        screenTrack.addEventListener("ended", stopCallScreenShare, { once: true });
        setCallStatus("Đang chia sẻ màn hình.");
    } catch (error) {
        if (error.name !== "NotAllowedError") {
            console.error("Không thể chia sẻ màn hình:", error);
            setCallStatus("Không thể chia sẻ màn hình. Hãy thử cấp quyền hoặc dùng trình duyệt khác.");
        }
    }
}

function stopCallScreenShare() {
    if (!activeCall?.screenStream) return;
    const call = activeCall;
    const cameraTrack = call.localStream.getVideoTracks()[0];
    call.screenStream.getTracks().forEach((track) => track.stop());
    call.screenStream = null;
    if (cameraTrack) {
        for (const peer of call.peers.values()) {
            const sender = peer.pc.getSenders().find((item) => item.track?.kind === "video");
            if (sender) sender.replaceTrack(cameraTrack).catch((error) => {
                console.error("Không thể khôi phục camera:", error);
            });
        }
    }
    setCallLocalStream(call.localStream);
    if (callScreenButton) {
        callScreenButton.textContent = "🖥️ Chia sẻ màn hình";
        callScreenButton.setAttribute("aria-pressed", "false");
    }
    if (callCameraButton) callCameraButton.disabled = false;
    renderCallStatus();
}

if (videoCallButton) videoCallButton.addEventListener("click", startVideoCall);
if (callAcceptButton) callAcceptButton.addEventListener("click", acceptVideoCall);
if (callRejectButton) callRejectButton.addEventListener("click", rejectVideoCall);
if (callHangupButton) callHangupButton.addEventListener("click", () => finishVideoCall());
if (callCloseButton) callCloseButton.addEventListener("click", () => finishVideoCall());
if (callMicButton) {
    callMicButton.addEventListener("click", () => {
        const track = activeCall?.localStream.getAudioTracks()[0];
        if (!track) return;
        track.enabled = !track.enabled;
        callMicButton.textContent = track.enabled ? "🎙️ Tắt mic" : "🔇 Bật mic";
        callMicButton.setAttribute("aria-pressed", String(track.enabled));
    });
}
if (callCameraButton) {
    callCameraButton.addEventListener("click", () => {
        const track = activeCall?.localStream.getVideoTracks()[0];
        if (!track) return;
        track.enabled = !track.enabled;
        callCameraButton.textContent = track.enabled ? "📷 Tắt camera" : "🚫 Bật camera";
        callCameraButton.setAttribute("aria-pressed", String(track.enabled));
    });
}
if (callScreenButton) callScreenButton.addEventListener("click", toggleCallScreenShare);

async function switchPrivateChat(targetUser, avatar) {
    finishVideoCall();
    resetMusicSyncSession(true);
    pendingMusicInvite = null;
    if (musicInviteBanner) musicInviteBanner.classList.add("hidden");
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
    updateVideoCallButton();
    updateMusicShareControls();
    if (headerName) headerName.textContent = targetUser;
    if (headerAvatar) headerAvatar.src = safeAvatarUrl(avatar);
    if (headerStatus) {
        headerStatus.textContent = "đang kết nối...";
        headerStatus.classList.remove("is-online");
    }
    if (chatLayout) chatLayout.classList.add("mobile-chat-open");
    renderUsersList();
    renderGroupsList();

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
    if (currentRoom !== room) return;
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
            headerStatus.textContent = currentRoom.startsWith("group_") ? "đã kết nối" : "ngoại tuyến";
            headerStatus.classList.remove("is-online");
        }
        updateMusicShareControls();
        updateVideoCallButton();
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
        } else if (data.type === "call_signal") {
            handleCallSignal(data);
        } else if (data.type === "music_sync") {
            handleMusicSyncEvent(data);
        } else if (data.type === "error") {
            if (activeCall) {
                setCallStatus(data.message);
                if (data.message.includes("đã đủ") || data.message.includes("không còn hoạt động")) {
                    finishVideoCall(false);
                }
            }
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
        if (musicSyncRoom === room) resetMusicSyncSession(false);
        if (activeCall?.room === room || pendingCallInvite?.room === room) finishVideoCall(false);
        updateMusicShareControls();
        updateVideoCallButton();
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

    if (currentRoom.startsWith("group_") && !isSent) {
        const sender = document.createElement("div");
        sender.className = "tg-group-sender";
        sender.textContent = message.sender || "Thành viên";
        item.append(sender);
    }

    const content = document.createElement("div");
    content.className = "content";

    const textVal = message.content || "";
    if (message.is_deleted) {
        content.textContent = "Tin nhắn đã được thu hồi";
        content.classList.add("deleted");
    } else if (textVal.startsWith("/uploads/")) {
        if (textVal.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
            const img = document.createElement("img");
                img.alt = "Ảnh được chia sẻ trong cuộc trò chuyện";
            img.style.maxWidth = "260px";
            img.style.borderRadius = "8px";
            img.style.marginTop = "4px";
            img.style.display = "block";
            content.append(img);
                loadProtectedMedia(img, textVal);
            } else if (textVal.match(/\.(mp4|webm|ogg)$/i)) {
                const video = document.createElement("video");
            video.controls = true;
                video.preload = "metadata";
                video.style.maxWidth = "260px";
                video.style.borderRadius = "8px";
                video.style.marginTop = "4px";
                video.style.display = "block";
                content.append(video);
                loadProtectedMedia(video, textVal);
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
        if (!currentRoom.startsWith("group_")) {
            const remember = document.createElement("button");
            remember.type = "button";
            remember.className = "save-memory-action";
            remember.textContent = "🌱 Lưu kỷ niệm";
            remember.addEventListener("click", () => openWorld(message));
            actions.append(remember);
        }
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
        if (file.size > 20 * 1024 * 1024) {
            fileInput.value = "";
            return alert("Tệp vượt quá giới hạn 20 MB.");
        }
        if (socket?.readyState !== WebSocket.OPEN) {
            fileInput.value = "";
            return alert("Đang kết nối lại. Vui lòng thử gửi lại.");
        }

        const formData = new FormData();
        formData.append("file", file);
        const uploadRoom = currentRoom;
        const uploadSocket = socket;

        try {
            const data = await apiFetch("/upload", {
                method: "POST",
                body: formData
            });
            if (uploadRoom !== currentRoom || uploadSocket !== socket || uploadSocket.readyState !== WebSocket.OPEN) {
                throw new Error("Bạn đã chuyển cuộc trò chuyện hoặc bị mất kết nối; tệp chưa được gửi.");
            }
            uploadSocket.send(JSON.stringify({ type: "chat", content: data.url }));
            fileInput.value = "";
        } catch (error) {
            fileInput.value = "";
            alert("Lỗi gửi tệp: " + error.message);
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
        videoId,
        playlistId,
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

function updateMusicShareControls() {
    const canShare = Boolean(
        currentTargetUser &&
        currentRoom &&
        !currentRoom.startsWith("group_") &&
        socket?.readyState === WebSocket.OPEN
    );
    if (musicShareButton) {
        musicShareButton.disabled = !canShare || !currentMusicTrack;
        musicShareButton.classList.toggle("hidden", musicSyncActive);
    }
    if (musicLeaveShareButton) musicLeaveShareButton.classList.toggle("hidden", !musicSyncActive);
    if (!musicShareStatus) return;
    if (musicSyncActive) {
        musicShareStatus.textContent = `Đang nghe/xem cùng ${currentTargetUser}. Cả hai đều có thể điều khiển.`;
    } else if (!canShare) {
        musicShareStatus.textContent = "Chọn một cuộc trò chuyện riêng để mời đối phương.";
    } else if (!currentMusicTrack) {
        musicShareStatus.textContent = "Phát một video YouTube trước khi gửi lời mời.";
    } else {
        musicShareStatus.textContent = "Mời đối phương tham gia; họ cần đồng ý trước khi phát.";
    }
}

function updateMusicTransportControls() {
    if (musicStopButton) musicStopButton.disabled = !currentMusicTrack;
    if (musicPreviousButton) musicPreviousButton.disabled = currentMusicIndex <= 0;
    if (musicNextButton) musicNextButton.disabled =
        currentMusicIndex < 0 || currentMusicIndex >= musicPlaylist.length - 1;
}

function resetMusicSyncSession(notifyPartner = false) {
    if (notifyPartner && pendingMusicInvite) sendMusicSignal({ action: "decline" });
    if (notifyPartner && (musicSyncActive || outgoingMusicInvite)) {
        sendMusicSignal({ action: "leave" });
    }
    pendingMusicInvite = null;
    if (musicInviteBanner) musicInviteBanner.classList.add("hidden");
    musicSyncActive = false;
    musicSyncRoom = "";
    musicSyncLeader = "";
    outgoingMusicInvite = false;
    updateMusicShareControls();
}

function sendMusicSignal(data) {
    if (socket?.readyState !== WebSocket.OPEN || !currentRoom || currentRoom.startsWith("group_")) return false;
    socket.send(JSON.stringify({ type: "music_sync", ...data }));
    return true;
}

function getMusicSnapshot(action) {
    let videoId = currentMusicTrack?.videoId || "";
    if (!videoId && !currentMusicTrack?.playlistId && youtubePlayerReady && youtubePlayer) {
        videoId = youtubePlayer.getVideoData()?.video_id || "";
    }
    const playlistId = currentMusicTrack?.playlistId || "";
    const playerState = youtubePlayerReady && youtubePlayer ? youtubePlayer.getPlayerState() : -1;
    const playbackState = action === "invite" ?
        (playerState === 2 || playerState === 0 ? "paused" : "playing") :
        (playerState === 0 ? "ended" : playerState === 2 ? "paused" : "playing");
    const position = youtubePlayerReady && youtubePlayer ?
        Math.max(0, Math.min(86400, youtubePlayer.getCurrentTime() || 0)) : 0;
    return {
        action,
        video_id: videoId,
        playlist_id: playlistId,
        title: currentMusicTrack?.name || "YouTube",
        position,
        playback_state: playbackState,
    };
}

function sendMusicState() {
    if (!musicSyncActive || currentRoom !== musicSyncRoom) return;
    if (sendMusicSignal(getMusicSnapshot("state"))) {
        musicSyncLeader = currentUsername;
        lastMusicHeartbeatAt = Date.now();
    }
}

function showMusicPlaybackError(message) {
    musicPlaybackError = message;
    if (musicPlaybackStatus) {
        musicPlaybackStatus.textContent = message;
        musicPlaybackStatus.classList.add("error");
    }
    if (musicFeedback) {
        musicFeedback.textContent = message;
        musicFeedback.classList.add("error");
    }
}

function clearMusicPlaybackError() {
    musicPlaybackError = "";
    if (musicPlaybackStatus) musicPlaybackStatus.classList.remove("error");
    if (musicFeedback) {
        musicFeedback.textContent = "";
        musicFeedback.classList.remove("error");
    }
}

function setMusicPlaybackStatus(message) {
    if (!musicPlaybackError && musicPlaybackStatus) musicPlaybackStatus.textContent = message;
}

function createYouTubePlayerFrame(track) {
    const target = document.getElementById("music-youtube-player");
    if (!target) throw new Error("Không tìm thấy khung phát video.");
    if (!track.videoId && !track.playlistId) {
        throw new Error("Lời mời không có video hoặc playlist YouTube hợp lệ.");
    }

    const iframe = document.createElement("iframe");
    iframe.id = "music-youtube-player";
    iframe.title = "Trình phát YouTube";
    iframe.width = "100%";
    iframe.height = "100%";
    iframe.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
    iframe.setAttribute("allowfullscreen", "");
    iframe.setAttribute("referrerpolicy", "origin");

    const videoUrl = track.videoId ?
        new URL(`/embed/${encodeURIComponent(track.videoId)}`, "https://www.youtube.com") :
        new URL("/embed/videoseries", "https://www.youtube.com");
    videoUrl.searchParams.set("autoplay", "1");
    videoUrl.searchParams.set("controls", "1");
    videoUrl.searchParams.set("enablejsapi", "1");
    videoUrl.searchParams.set("origin", location.origin);
    videoUrl.searchParams.set("playsinline", "1");
    videoUrl.searchParams.set("rel", "0");
    videoUrl.searchParams.set("widget_referrer", location.href);
    if (track.playlistId) videoUrl.searchParams.set("list", track.playlistId);

    iframe.src = videoUrl.href;
    target.replaceWith(iframe);
    return iframe;
}

function loadYouTubeApi() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (!youtubeApiPromise) {
        youtubeApiPromise = new Promise((resolve, reject) => {
            const timeoutId = window.setTimeout(
                () => reject(new Error("YouTube không phản hồi. Hãy kiểm tra kết nối Internet rồi thử lại.")),
                YOUTUBE_PLAYER_TIMEOUT_MS,
            );
            const previousCallback = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => {
                window.clearTimeout(timeoutId);
                try {
                    if (typeof previousCallback === "function") previousCallback();
                } finally {
                    resolve(window.YT);
                }
            };
            const script = document.createElement("script");
            script.src = "https://www.youtube.com/iframe_api";
            script.onerror = () => {
                window.clearTimeout(timeoutId);
                reject(new Error("Không thể tải YouTube. Kiểm tra kết nối Internet hoặc thử mở video trực tiếp."));
            };
            document.head.append(script);
        }).catch((error) => {
            youtubeApiPromise = null;
            throw error;
        });
    }
    return youtubeApiPromise;
}

function ensureYouTubePlayer() {
    if (youtubePlayerReady && youtubePlayer) return Promise.resolve(youtubePlayer);
    if (youtubePlayerPromise) return youtubePlayerPromise;
    youtubePlayerPromise = loadYouTubeApi().then((YT) => new Promise((resolve, reject) => {
        const timeoutId = window.setTimeout(
            () => reject(new Error("YouTube chưa tạo được trình phát. Hãy thử tải lại hoặc mở video trên YouTube.")),
            YOUTUBE_PLAYER_TIMEOUT_MS,
        );
        const playerFrame = createYouTubePlayerFrame(currentMusicTrack || {});
        youtubePlayer = new YT.Player(playerFrame, {
            events: {
                onReady: (event) => {
                    window.clearTimeout(timeoutId);
                    youtubePlayerReady = true;
                    const iframe = event.target.getIframe();
                    iframe.title = "Trình phát YouTube";
                    iframe.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
                    iframe.setAttribute("allowfullscreen", "");
                    setMusicPlaybackStatus("Đã kết nối YouTube; đang tải video...");
                    resolve(event.target);
                },
                onAutoplayBlocked: () => {
                    setMusicPlaybackStatus("Trình duyệt chặn tự phát. Hãy nhấn Play trong khung video.");
                },
                onStateChange: (event) => {
                    if (youtubeBufferingTimeoutId !== null) {
                        window.clearTimeout(youtubeBufferingTimeoutId);
                        youtubeBufferingTimeoutId = null;
                    }
                    if (event.data === YT.PlayerState.PLAYING) {
                        clearMusicPlaybackError();
                        setMusicPlaybackStatus("Đang phát qua YouTube...");
                    } else if (event.data === YT.PlayerState.BUFFERING) {
                        setMusicPlaybackStatus("Đang tải video từ YouTube...");
                        youtubeBufferingTimeoutId = window.setTimeout(() => {
                            youtubeBufferingTimeoutId = null;
                            if (youtubePlayer?.getPlayerState() === YT.PlayerState.BUFFERING) {
                                setMusicPlaybackStatus("Video tải quá lâu. Kiểm tra mạng hoặc chọn “Mở trên YouTube”.");
                            }
                        }, 12000);
                    } else if (event.data === YT.PlayerState.PAUSED) {
                        setMusicPlaybackStatus("Đã tạm dừng.");
                    } else if (event.data === YT.PlayerState.ENDED) {
                        setMusicPlaybackStatus("Video đã phát xong.");
                    }
                    lastObservedMusicTime = youtubePlayer.getCurrentTime() || 0;
                    if (
                        Date.now() >= suppressMusicSyncUntil &&
                        [YT.PlayerState.PLAYING, YT.PlayerState.PAUSED, YT.PlayerState.ENDED].includes(event.data)
                    ) {
                        sendMusicState();
                    }
                },
                onError: (event) => {
                    window.clearTimeout(timeoutId);
                    const reason = event.data === 101 || event.data === 150 ?
                        "Chủ video không cho phép phát trong khung nhúng." :
                        event.data === 153 ? "YouTube không nhận được thông tin trang nhúng. Hãy tải lại trang rồi thử lại." :
                            event.data === 100 ? "Video không tồn tại, đã bị xóa hoặc đang ở chế độ riêng tư." :
                            "YouTube không thể phát nội dung này.";
                    const message = `${reason} Hãy chọn “Mở trên YouTube” hoặc thử video khác (mã ${event.data}).`;
                    showMusicPlaybackError(message);
                    reject(new Error(message));
                },
            },
        });
    })).catch((error) => {
        youtubePlayerPromise = null;
        throw error;
    });
    return youtubePlayerPromise;
}

async function loadMusicInPlayer(track, { position = 0, playbackState = "playing" } = {}) {
    if (musicYouTubeFrame) musicYouTubeFrame.classList.remove("hidden");
    if (musicEmbedEmpty) musicEmbedEmpty.classList.add("hidden");
    if (musicOpenSource) {
        musicOpenSource.href = track.sourceUrl ||
            (track.videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(track.videoId)}` : "");
        musicOpenSource.classList.toggle("hidden", !track.sourceUrl && !track.videoId);
    }
    if (musicTrackName) musicTrackName.textContent = track.name;
    clearMusicPlaybackError();
    if (musicPlaybackStatus) {
        musicPlaybackStatus.textContent = "Đang kết nối với YouTube...";
    }
    updateMusicTransportControls();
    updateMusicShareControls();
    const player = await ensureYouTubePlayer();
    suppressMusicSyncUntil = Date.now() + 1800;
    lastObservedMusicTime = position;
    if (playbackState === "ended") {
        player.stopVideo();
    } else if (track.videoId) {
        if (playbackState === "playing") {
            player.loadVideoById({ videoId: track.videoId, startSeconds: position });
        } else {
            player.cueVideoById({ videoId: track.videoId, startSeconds: position });
        }
    } else if (track.playlistId) {
        const options = { listType: "playlist", list: track.playlistId, index: 0 };
        if (playbackState === "playing") player.loadPlaylist(options);
        else player.cuePlaylist(options);
        if (playbackState === "paused" && position > 0) {
            window.setTimeout(() => player.seekTo(position, true), 1200);
        }
    }
    if (playbackState === "paused" && track.videoId) {
        window.setTimeout(() => player.pauseVideo(), 600);
    }
}

async function playMusicTrack(index) {
    if (index < 0 || index >= musicPlaylist.length) return;
    currentMusicIndex = index;
    currentMusicTrack = musicPlaylist[index];
    renderMusicPlaylist();
    updateMusicShareControls();
    try {
        await loadMusicInPlayer(currentMusicTrack);
    } catch (error) {
        console.error("Không thể phát nội dung YouTube:", error);
        if (musicPlaybackStatus) musicPlaybackStatus.textContent = error.message || "Không thể phát nội dung YouTube.";
    }
}

function applyRemoteMusicState(data) {
    if (!musicSyncActive || currentRoom !== musicSyncRoom) return;
    const incomingKey = `${data.video_id || ""}:${data.playlist_id || ""}`;
    const activeKey = currentMusicTrack?.key ||
        `${currentMusicTrack?.videoId || ""}:${currentMusicTrack?.playlistId || ""}`;
    const trackChanged = incomingKey !== activeKey;
    const track = {
        key: incomingKey,
        videoId: data.video_id || "",
        playlistId: data.playlist_id || "",
        name: data.title || "YouTube",
        sourceUrl: data.video_id ?
            `https://www.youtube.com/watch?v=${encodeURIComponent(data.video_id)}` :
            `https://www.youtube.com/playlist?list=${encodeURIComponent(data.playlist_id)}`,
    };
    if (trackChanged) {
        currentMusicTrack = track;
        currentMusicIndex = musicPlaylist.findIndex((item) => item.key === incomingKey);
        renderMusicPlaylist();
    }
    updateMusicShareControls();
    musicSyncLeader = data.sender;
    lastMusicHeartbeatAt = Date.now();
    if (musicYouTubeFrame) musicYouTubeFrame.classList.remove("hidden");
    if (musicEmbedEmpty) musicEmbedEmpty.classList.add("hidden");
    if (musicPlaybackError && !trackChanged) return;

    ensureYouTubePlayer().then((player) => {
        if (!musicSyncActive || currentRoom !== musicSyncRoom) return;
        const currentPosition = player.getCurrentTime() || 0;
        const currentState = player.getPlayerState();
        const needsSeek = Math.abs(currentPosition - data.position) > 2;
        suppressMusicSyncUntil = Date.now() + 1800;
        if (trackChanged || currentState < 0 || currentState === 5 || data.playback_state === "ended") {
            loadMusicInPlayer(track, {
                position: data.position,
                playbackState: data.playback_state,
            }).catch((error) => console.error("Không thể đồng bộ trình phát:", error));
        } else {
            if (needsSeek) player.seekTo(data.position, true);
            if (data.playback_state === "playing" && currentState !== 1) player.playVideo();
            if (data.playback_state === "paused" && currentState !== 2) player.pauseVideo();
        }
    }).catch((error) => {
        console.error("Không thể đồng bộ trình phát YouTube:", error);
        showMusicPlaybackError(error.message || "Không tải được YouTube. Hãy kiểm tra kết nối rồi thử lại.");
    });
}

function handleMusicSyncEvent(data) {
    if (data.sender === currentUsername) return;
    if (data.action === "invite") {
        pendingMusicInvite = data;
        if (musicInviteDescription) {
            musicInviteDescription.textContent = `${data.sender} mời bạn nghe/xem “${data.title}” cùng nhau.`;
        }
        if (musicInviteBanner) musicInviteBanner.classList.remove("hidden");
        return;
    }
    if (data.action === "decline" && data.sender === currentTargetUser) {
        if (musicShareStatus) musicShareStatus.textContent = `${data.sender} chưa tham gia nghe/xem chung.`;
        outgoingMusicInvite = false;
        return;
    }
    if (data.action === "join" && outgoingMusicInvite && data.sender === currentTargetUser) {
        outgoingMusicInvite = false;
        musicSyncActive = true;
        musicSyncRoom = currentRoom;
        musicSyncLeader = currentUsername;
        updateMusicShareControls();
        sendMusicState();
        return;
    }
    if (data.action === "state") {
        if (pendingMusicInvite?.sender === data.sender && !musicSyncActive) {
            pendingMusicInvite = data;
            if (musicInviteDescription) {
                musicInviteDescription.textContent = `${data.sender} đang phát “${data.title}”. Bạn có thể tham gia bất cứ lúc nào.`;
            }
        }
        if (musicSyncActive && currentRoom === musicSyncRoom) applyRemoteMusicState(data);
        return;
    }
    if (data.action === "leave" && pendingMusicInvite?.sender === data.sender) {
        pendingMusicInvite = null;
        if (musicInviteBanner) musicInviteBanner.classList.add("hidden");
        return;
    }
    if (data.action === "leave" && musicSyncActive && currentRoom === musicSyncRoom) {
        musicSyncActive = false;
        musicSyncRoom = "";
        musicSyncLeader = "";
        updateMusicShareControls();
        if (musicShareStatus) musicShareStatus.textContent = `${data.sender} đã rời phiên nghe/xem chung. Nhạc của bạn vẫn tiếp tục phát.`;
    }
}

if (musicShareButton) {
    musicShareButton.addEventListener("click", () => {
        if (!currentMusicTrack) return;
        if (!sendMusicSignal(getMusicSnapshot("invite"))) {
            if (musicShareStatus) musicShareStatus.textContent = "Hãy kết nối lại cuộc trò chuyện rồi thử mời lại.";
            return;
        }
        outgoingMusicInvite = true;
        if (musicShareStatus) musicShareStatus.textContent = `Đã gửi lời mời nghe/xem chung cho ${currentTargetUser}.`;
    });
}

if (musicLeaveShareButton) {
    musicLeaveShareButton.addEventListener("click", () => {
        sendMusicSignal({ action: "leave" });
        musicSyncActive = false;
        musicSyncRoom = "";
        musicSyncLeader = "";
        updateMusicShareControls();
        if (musicShareStatus) musicShareStatus.textContent = "Đã rời nghe/xem chung; nhạc của bạn vẫn tiếp tục phát.";
    });
}

if (musicInviteAcceptButton) {
    musicInviteAcceptButton.addEventListener("click", () => {
        if (!pendingMusicInvite || !currentTargetUser) return;
        const invite = pendingMusicInvite;
        pendingMusicInvite = null;
        if (musicInviteBanner) musicInviteBanner.classList.add("hidden");
        musicSyncActive = true;
        musicSyncRoom = currentRoom;
        musicSyncLeader = invite.sender;
        outgoingMusicInvite = false;
        if (musicModal) musicModal.classList.remove("hidden");
        const track = {
            key: `${invite.video_id || ""}:${invite.playlist_id || ""}`,
            videoId: invite.video_id || "",
            playlistId: invite.playlist_id || "",
            name: invite.title || "YouTube",
            sourceUrl: invite.video_id ?
                `https://www.youtube.com/watch?v=${encodeURIComponent(invite.video_id)}` :
                `https://www.youtube.com/playlist?list=${encodeURIComponent(invite.playlist_id)}`,
        };
        currentMusicTrack = track;
        currentMusicIndex = musicPlaylist.findIndex((item) => item.key === track.key);
        renderMusicPlaylist();
        updateMusicShareControls();
        loadMusicInPlayer(track, {
            position: invite.position,
            playbackState: invite.playback_state,
        }).catch((error) => {
            console.error("Không thể tham gia phiên nghe/xem chung:", error);
            showMusicPlaybackError(error.message || "Không thể tải video. Hãy thử mở video trực tiếp trên YouTube.");
        });
        sendMusicSignal({ action: "join" });
    });
}

if (musicInviteDeclineButton) {
    musicInviteDeclineButton.addEventListener("click", () => {
        if (pendingMusicInvite) sendMusicSignal({ action: "decline" });
        pendingMusicInvite = null;
        if (musicInviteBanner) musicInviteBanner.classList.add("hidden");
    });
}

window.setInterval(() => {
    if (!youtubePlayerReady || !youtubePlayer) return;
    const now = Date.now();
    const position = youtubePlayer.getCurrentTime() || 0;
    const state = youtubePlayer.getPlayerState();
    if (
        musicSyncActive &&
        now >= suppressMusicSyncUntil &&
        lastObservedMusicTime !== null &&
        state !== 1 &&
        Math.abs(position - lastObservedMusicTime) > 2
    ) {
        sendMusicState();
    } else if (
        musicSyncActive &&
        musicSyncLeader === currentUsername &&
        state === 1 &&
        now - lastMusicHeartbeatAt >= 5000
    ) {
        sendMusicState();
    }
    lastObservedMusicTime = position;
}, 1000);

function removeMusicTrack(index) {
    musicPlaylist.splice(index, 1);
    if (currentMusicIndex === index) {
        if (musicSyncActive) sendMusicSignal({ ...getMusicSnapshot("state"), playback_state: "ended" });
        currentMusicIndex = -1;
        currentMusicTrack = null;
        if (youtubePlayerReady && youtubePlayer) youtubePlayer.stopVideo();
        if (musicYouTubeFrame) musicYouTubeFrame.classList.add("hidden");
        if (musicEmbedEmpty) musicEmbedEmpty.classList.remove("hidden");
        if (musicOpenSource) musicOpenSource.classList.add("hidden");
        if (musicTrackName) musicTrackName.textContent = "Chưa chọn bài hát";
        if (musicPlaybackStatus) musicPlaybackStatus.textContent = "Chọn link đã lưu hoặc dán link mới.";
    } else if (currentMusicIndex > index) {
        currentMusicIndex--;
    }
    saveYouTubePlaylist();
    renderMusicPlaylist();
    updateMusicTransportControls();
    updateMusicShareControls();
}

function loadYouTubePlaylist(username) {
    musicPlaylist = [];
    currentMusicIndex = -1;
    currentMusicTrack = null;
    if (musicYouTubeFrame) {
        musicYouTubeFrame.classList.add("hidden");
    }
    if (youtubePlayerReady && youtubePlayer) youtubePlayer.stopVideo();
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
    updateMusicTransportControls();
    updateMusicShareControls();
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
        if (musicSyncActive) {
            sendMusicSignal({
                ...getMusicSnapshot("state"),
                playback_state: "ended",
            });
        }
        currentMusicIndex = -1;
        currentMusicTrack = null;
        if (youtubePlayerReady && youtubePlayer) youtubePlayer.stopVideo();
        if (musicYouTubeFrame) musicYouTubeFrame.classList.add("hidden");
        if (musicEmbedEmpty) musicEmbedEmpty.classList.remove("hidden");
        if (musicOpenSource) musicOpenSource.classList.add("hidden");
        if (musicTrackName) musicTrackName.textContent = "Chưa chọn bài hát";
        if (musicPlaybackStatus) musicPlaybackStatus.textContent = "Đã dừng phát nhạc.";
        renderMusicPlaylist();
        updateMusicTransportControls();
        updateMusicShareControls();
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