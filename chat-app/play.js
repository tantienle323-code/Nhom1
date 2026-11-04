const TOKEN_KEY = "chat_access_token";
const API_BASE = window.CHAT_API_URL || `${location.protocol === "https:" ? "https" : "http"}://${location.hostname || "127.0.0.1"}:8000`;
const WS_BASE = window.CHAT_WS_URL || `${API_BASE.startsWith("https:") ? "wss" : "ws"}://${new URL(API_BASE).host}/ws/games`;
const token = localStorage.getItem(TOKEN_KEY);
const game = new URLSearchParams(location.search).get("game");
const gameInfo = {
    gomoku: {
        title: "Cờ caro",
        subtitle: "Nối 5 quân liên tiếp trước đối thủ trên bàn cờ 15 × 15.",
        icon: "⭕",
        round: "15 × 15",
    },
    rps: {
        title: "Oẳn tù tì",
        subtitle: "Chọn bí mật, cùng mở. Ai thắng 2 vòng sẽ thắng trận.",
        icon: "✊",
        round: "THẮNG HAI VÒNG ĐỂ GIÀNH CHIẾN THẮNG",
    },
    duel: {
        title: "Đấu vui",
        subtitle: "Canh tín hiệu rồi phản xạ thật nhanh — chỉ là hoạt ảnh vui trong game.",
        icon: "🐔",
        round: "THẮNG HAI VÒNG ĐỂ GIÀNH CHIẾN THẮNG",
    },
};
const choiceLabels = { rock: "✊", paper: "✋", scissors: "✌️" };

const playerNameLabel = document.getElementById("player-name");
const boardPlayerName = document.getElementById("board-player-name");
const opponentNameLabel = document.getElementById("opponent-name");
const opponentStatus = document.getElementById("opponent-status");
const playerStatus = document.getElementById("player-status");
const opponentScoreLabel = document.getElementById("opponent-score");
const playerScoreLabel = document.getElementById("player-score");
const connectionStatus = document.getElementById("connection-status");
const overlay = document.getElementById("game-overlay");
const overlayIcon = document.getElementById("overlay-icon");
const overlayTitle = document.getElementById("overlay-title");
const gameMessage = document.getElementById("game-message");
const findMatchButton = document.getElementById("find-match-btn");
const gomokuView = document.getElementById("gomoku-view");
const rpsView = document.getElementById("rps-view");
const duelView = document.getElementById("duel-view");
const gomokuBoard = document.getElementById("gomoku-board");
const turnStatus = document.getElementById("turn-status");
const rpsStatus = document.getElementById("rps-status");
const duelStatus = document.getElementById("duel-status");
const readyButton = document.getElementById("ready-btn");
const duelArena = document.getElementById("duel-arena");

let socket = null;
let username = "";
let opponent = "";
let ownMark = "";
let currentTurn = false;
let gameResultReceived = false;
let choiceSubmitted = false;
const cells = [];

function showOverlay(title, message, buttonText = "Tìm trận") {
    overlayTitle.textContent = title;
    gameMessage.textContent = message;
    findMatchButton.textContent = buttonText;
    findMatchButton.disabled = false;
    overlay.classList.remove("hidden");
}

function resetViews() {
    gomokuView.classList.toggle("hidden", game !== "gomoku");
    rpsView.classList.toggle("hidden", game !== "rps");
    duelView.classList.toggle("hidden", game !== "duel");
    opponentNameLabel.textContent = "Đang chờ";
    opponentStatus.textContent = "Tìm người chơi để bắt đầu.";
    playerStatus.textContent = "Chưa vào trận.";
    opponentScoreLabel.textContent = "0";
    playerScoreLabel.textContent = "0";
    currentTurn = false;
    choiceSubmitted = false;
    readyButton.disabled = true;
    readyButton.textContent = "Sẵn sàng";
    readyButton.classList.remove("signal-ready");
    duelArena.classList.remove("signal");
    document.getElementById("your-avatar").className = "duel-avatar your-avatar";
    document.getElementById("opponent-avatar").className = "duel-avatar opponent-avatar";
    document.querySelectorAll("[data-choice]").forEach((button) => { button.disabled = true; });
    if (game === "gomoku") {
        cells.forEach((cell) => {
            cell.textContent = "";
            cell.className = "gomoku-cell";
            cell.disabled = true;
        });
        turnStatus.textContent = "Đang chờ trận...";
    } else if (game === "rps") {
        document.getElementById("rps-your-choice").textContent = "?";
        document.getElementById("rps-opponent-choice").textContent = "?";
        document.getElementById("rps-opponent-label").textContent = "Đối thủ";
        document.getElementById("rps-round").textContent = gameInfo.rps.round;
        rpsStatus.textContent = "Chọn một biểu tượng bên dưới.";
    } else if (game === "duel") {
        document.getElementById("duel-round").textContent = gameInfo.duel.round;
        duelStatus.textContent = "Nhấn sẵn sàng, chờ tín hiệu rồi phản xạ!";
    }
}

function initializeGomokuBoard() {
    for (let row = 0; row < 15; row++) {
        for (let column = 0; column < 15; column++) {
            const cell = document.createElement("button");
            cell.type = "button";
            cell.className = "gomoku-cell";
            cell.setAttribute("role", "gridcell");
            cell.setAttribute("aria-label", `Hàng ${row + 1}, cột ${column + 1}`);
            cell.disabled = true;
            cell.addEventListener("click", () => {
                if (!currentTurn || socket?.readyState !== WebSocket.OPEN || cell.textContent) return;
                cell.disabled = true;
                socket.send(JSON.stringify({ type: "move", row, column }));
            });
            cells.push(cell);
            gomokuBoard.append(cell);
        }
    }
}

function setTurn(isYourTurn) {
    currentTurn = isYourTurn;
    turnStatus.textContent = isYourTurn ? `Lượt của bạn (${ownMark})` : `Đang đánh ${opponent}...`;
    cells.forEach((cell) => {
        cell.disabled = !isYourTurn || cell.textContent !== "";
    });
}

function handleMove(data) {
    const cell = cells[data.row * 15 + data.column];
    if (!cell || cell.textContent) return;
    cell.textContent = data.mark === "X" ? "×" : "○";
    cell.classList.add(data.mark === "X" ? "mark-x" : "mark-o");
    cell.disabled = true;
    if (data.username === username) playerStatus.textContent = "Bạn vừa đánh quân " + data.mark + ".";
    else opponentStatus.textContent = "Đối thủ vừa đánh quân " + data.mark + ".";
}

function handleRoundResult(data) {
    playerScoreLabel.textContent = String(data.your_round_wins);
    opponentScoreLabel.textContent = String(data.opponent_round_wins);
    if (game === "rps") {
        document.getElementById("rps-your-choice").textContent = choiceLabels[data.your_choice] || "?";
        document.getElementById("rps-opponent-choice").textContent = choiceLabels[data.opponent_choice] || "?";
        rpsStatus.textContent = data.round_winner === username ? "Bạn thắng vòng này!" :
            data.round_winner ? `${opponent} thắng vòng này.` : "Hòa vòng này!";
        choiceSubmitted = true;
        document.querySelectorAll("[data-choice]").forEach((button) => { button.disabled = true; });
    } else if (game === "duel") {
        duelStatus.textContent = data.reason === "false_start" ?
            (data.winner === username ? "Đối thủ nhấn quá sớm — bạn thắng vòng này!" : "Bạn nhấn quá sớm — mất vòng này.") :
            (data.winner === username ? "Phản xạ nhanh! Bạn thắng vòng này." : `${opponent} phản xạ nhanh hơn.`);
        const winnerAvatar = data.winner === username ?
            document.getElementById("your-avatar") : document.getElementById("opponent-avatar");
        winnerAvatar.classList.add("winner");
        readyButton.disabled = true;
        readyButton.classList.remove("signal-ready");
        duelArena.classList.remove("signal");
    }
}

function handleEvent(data, activeSocket) {
    if (data.type === "waiting") {
        connectionStatus.textContent = data.players_waiting > 1 ?
            `Đang tìm trận · ${data.players_waiting} người trong hàng chờ` : "Đang chờ đối thủ...";
    } else if (data.type === "matched") {
        opponent = data.opponent;
        ownMark = data.mark || "";
        opponentNameLabel.textContent = opponent;
        document.getElementById("rps-opponent-label").textContent = opponent;
        opponentStatus.textContent = "Đang thi đấu";
        playerStatus.textContent = "Trận đấu bắt đầu!";
        connectionStatus.textContent = `Đã ghép trận với ${opponent}.`;
        overlay.classList.add("hidden");
        if (game === "gomoku") setTurn(data.your_turn);
    } else if (data.type === "round_started") {
        choiceSubmitted = false;
        document.getElementById("rps-round").textContent = `VÒNG ${data.round} · THẮNG HAI VÒNG`;
        document.getElementById("rps-your-choice").textContent = "?";
        document.getElementById("rps-opponent-choice").textContent = "?";
        rpsStatus.textContent = "Chọn bí mật — chờ đối thủ chọn.";
        document.querySelectorAll("[data-choice]").forEach((button) => { button.disabled = false; });
    } else if (data.type === "waiting_choice") {
        choiceSubmitted = true;
        document.querySelectorAll("[data-choice]").forEach((button) => { button.disabled = true; });
        rpsStatus.textContent = "Đã chọn. Đang chờ đối thủ...";
    } else if (data.type === "round_result") {
        handleRoundResult(data);
    } else if (data.type === "move") {
        handleMove(data);
    } else if (data.type === "turn") {
        setTurn(data.your_turn);
    } else if (data.type === "ready_required") {
        document.getElementById("duel-round").textContent = `VÒNG ${data.round} · THẮNG HAI VÒNG`;
        readyButton.disabled = false;
        readyButton.textContent = "Sẵn sàng";
        readyButton.classList.remove("signal-ready");
        duelArena.classList.remove("signal");
        document.getElementById("your-avatar").classList.remove("winner");
        document.getElementById("opponent-avatar").classList.remove("winner");
        duelStatus.textContent = "Cả hai đã sẵn sàng? Nhấn nút, rồi chờ tín hiệu.";
    } else if (data.type === "waiting_ready") {
        readyButton.disabled = true;
        readyButton.textContent = "Đang chờ đối thủ...";
        duelStatus.textContent = "Đã sẵn sàng. Đối thủ đang chuẩn bị.";
    } else if (data.type === "countdown") {
        readyButton.disabled = true;
        readyButton.textContent = "Chờ tín hiệu...";
        duelStatus.textContent = "Đừng nhấn vội — chờ nền sáng!";
        document.getElementById("your-avatar").classList.add("ready");
        document.getElementById("opponent-avatar").classList.add("ready");
    } else if (data.type === "signal") {
        readyButton.disabled = false;
        readyButton.textContent = "NHẤN NGAY!";
        readyButton.classList.add("signal-ready");
        duelArena.classList.add("signal");
        duelStatus.textContent = "TÍN HIỆU! Ai nhấn trước thắng vòng.";
    } else if (data.type === "result") {
        gameResultReceived = true;
        currentTurn = false;
        cells.forEach((cell) => { cell.disabled = true; });
        readyButton.disabled = true;
        opponentStatus.textContent = data.reason === "opponent_disconnected" ?
            "Đối thủ đã rời trận." : "Trận đấu đã kết thúc.";
        playerStatus.textContent = data.result === "win" ? "Bạn chiến thắng!" :
            data.result === "draw" ? "Trận đấu hòa." : "Bạn đã thua trận này.";
        connectionStatus.textContent = playerStatus.textContent;
        showOverlay(
            data.result === "win" ? "Chiến thắng! 🎉" : data.result === "draw" ? "Hòa!" : "Kết thúc trận",
            data.reason === "opponent_disconnected" ? "Đối thủ đã rời trận." : "Bạn có thể tìm trận mới để chơi tiếp.",
            "Tìm trận mới"
        );
    } else if (data.type === "error") {
        connectionStatus.textContent = data.message;
        if (activeSocket.readyState === WebSocket.OPEN && !opponent) {
            showOverlay("Không thể vào trận", data.message, "Thử lại");
        } else if (game === "gomoku") {
            setTurn(true);
            turnStatus.textContent = data.message;
        } else if (game === "duel") {
            duelStatus.textContent = data.message;
        }
    }
}

function findMatch() {
    if (!token) {
        location.href = "index.html";
        return;
    }
    if (socket && socket.readyState <= WebSocket.OPEN && !gameResultReceived) {
        socket.close();
        socket = null;
        connectionStatus.textContent = "Đã hủy tìm trận.";
        resetViews();
        showOverlay("Sẵn sàng chưa?", "Tìm đối thủ để chơi trực tuyến.");
        return;
    }
    resetViews();
    gameResultReceived = false;
    findMatchButton.disabled = true;
    showOverlay("Đang tìm đối thủ...", "Bạn sẽ được ghép với người chơi đầu tiên đang chờ.", "Đang tìm...");
    connectionStatus.textContent = "Đang kết nối máy chủ trò chơi...";
    const activeSocket = new WebSocket(`${WS_BASE}/${game}`, [`bearer.${token}`, "arcade"]);
    socket = activeSocket;
    activeSocket.onopen = () => {
        findMatchButton.textContent = "Hủy tìm trận";
        findMatchButton.disabled = false;
        connectionStatus.textContent = "Đã vào hàng chờ...";
    };
    activeSocket.onmessage = (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch {
            connectionStatus.textContent = "Dữ liệu trò chơi không hợp lệ.";
            return;
        }
        handleEvent(data, activeSocket);
    };
    activeSocket.onclose = (event) => {
        if (socket !== activeSocket || gameResultReceived) return;
        socket = null;
        if (event.code === 4401) {
            localStorage.removeItem(TOKEN_KEY);
            location.href = "index.html";
            return;
        }
        if (event.code === 4409) {
            connectionStatus.textContent = "Tài khoản này đã tham gia trò chơi ở cửa sổ khác.";
            showOverlay("Đã tham gia trò chơi", "Thoát trận ở cửa sổ kia rồi thử lại.", "Thử lại");
        } else if (opponent) {
            connectionStatus.textContent = "Đã mất kết nối trận đấu.";
            showOverlay("Mất kết nối", "Hãy tìm trận mới để chơi lại.", "Tìm trận mới");
        } else {
            connectionStatus.textContent = "Đã rời hàng chờ.";
            showOverlay("Sẵn sàng chưa?", "Tìm đối thủ để chơi trực tuyến.");
        }
    };
    activeSocket.onerror = () => {
        connectionStatus.textContent = "Không kết nối được máy chủ trò chơi.";
    };
}

function chooseRps(choice) {
    if (choiceSubmitted || socket?.readyState !== WebSocket.OPEN) return;
    choiceSubmitted = true;
    document.getElementById("rps-your-choice").textContent = choiceLabels[choice];
    socket.send(JSON.stringify({ type: "choice", choice }));
}

findMatchButton.addEventListener("click", findMatch);
document.querySelectorAll("[data-choice]").forEach((button) => {
    button.addEventListener("click", () => chooseRps(button.dataset.choice));
});
readyButton.addEventListener("click", () => {
    if (socket?.readyState !== WebSocket.OPEN || readyButton.disabled) return;
    if (readyButton.classList.contains("signal-ready")) {
        readyButton.disabled = true;
        duelStatus.textContent = "Phản xạ của bạn đã gửi...";
        socket.send(JSON.stringify({ type: "react" }));
    } else {
        readyButton.disabled = true;
        readyButton.textContent = "Đang chờ đối thủ...";
        socket.send(JSON.stringify({ type: "ready" }));
    }
});

async function initialize() {
    if (!gameInfo[game]) {
        location.replace("arcade.html");
        return;
    }
    document.title = `${gameInfo[game].title} - Chat Realtime`;
    document.getElementById("game-title").textContent = gameInfo[game].title;
    document.getElementById("game-subtitle").textContent = gameInfo[game].subtitle;
    document.getElementById("overlay-icon").textContent = gameInfo[game].icon;
    document.getElementById("gomoku-round").textContent = gameInfo.gomoku.round;
    resetViews();
    if (game === "gomoku") initializeGomokuBoard();
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
        username = user.username;
        playerNameLabel.textContent = username;
        boardPlayerName.textContent = username;
        connectionStatus.textContent = "Đã sẵn sàng.";
    } catch {
        connectionStatus.textContent = "Không kết nối được máy chủ. Hãy thử tải lại trang.";
    }
}

initialize();
