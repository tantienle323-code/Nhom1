const TOKEN_KEY = "chat_access_token";
const API_BASE = window.CHAT_API_URL || `${location.protocol === "https:" ? "https" : "http"}://${location.hostname || "127.0.0.1"}:8000`;
const WS_BASE = window.CHAT_WS_URL || `${API_BASE.startsWith("https:") ? "wss" : "ws"}://${new URL(API_BASE).host}/ws/tetris`;
const token = localStorage.getItem(TOKEN_KEY);

const boardCanvas = document.getElementById("game-board");
const boardContext = boardCanvas.getContext("2d");
const nextCanvas = document.getElementById("next-piece");
const nextContext = nextCanvas.getContext("2d");
const overlay = document.getElementById("game-overlay");
const overlayTitle = document.getElementById("overlay-title");
const gameMessage = document.getElementById("game-message");
const findMatchButton = document.getElementById("find-match-btn");
const connectionStatus = document.getElementById("connection-status");
const playerScoreLabel = document.getElementById("player-score");
const playerLinesLabel = document.getElementById("player-lines");
const opponentScoreLabel = document.getElementById("opponent-score");
const opponentNameLabel = document.getElementById("opponent-name");
const opponentStatus = document.getElementById("opponent-status");
const matchStatus = document.getElementById("match-status");
const playerNameLabel = document.getElementById("player-name");
const boardPlayerName = document.getElementById("board-player-name");

const WIDTH = 10;
const HEIGHT = 20;
const CELL = 30;
const COLORS = ["#55d6be", "#64a9ff", "#ffcb62", "#ae8bff", "#ff6d91", "#f38b55", "#71d47b"];
const SHAPES = [
    [[1, 1, 1, 1]],
    [[1, 0, 0], [1, 1, 1]],
    [[0, 0, 1], [1, 1, 1]],
    [[1, 1], [1, 1]],
    [[0, 1, 1], [1, 1, 0]],
    [[0, 1, 0], [1, 1, 1]],
    [[1, 1, 0], [0, 1, 1]],
];

let socket = null;
let username = "";
let opponent = "";
let board = [];
let currentPiece = null;
let nextPiece = null;
let score = 0;
let clearedLines = 0;
let level = 1;
let running = false;
let gameResultReceived = false;
let lastDrop = 0;
let dropInterval = 750;

function makePiece() {
    const shapeIndex = Math.floor(Math.random() * SHAPES.length);
    const shape = SHAPES[shapeIndex].map((row) => [...row]);
    return {
        shape,
        color: COLORS[shapeIndex],
        x: Math.floor((WIDTH - shape[0].length) / 2),
        y: 0,
    };
}

function newBoard() {
    return Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(null));
}

function drawCell(context, x, y, color, size = CELL) {
    context.fillStyle = color;
    context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
    context.fillStyle = "rgba(255,255,255,.13)";
    context.fillRect(x * size + 3, y * size + 3, size - 6, 3);
}

function drawBoard() {
    boardContext.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
    boardContext.fillStyle = "#0c131c";
    boardContext.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
    boardContext.strokeStyle = "rgba(145,165,184,.08)";
    boardContext.lineWidth = 1;
    for (let x = 0; x <= WIDTH; x++) {
        boardContext.beginPath();
        boardContext.moveTo(x * CELL + 0.5, 0);
        boardContext.lineTo(x * CELL + 0.5, boardCanvas.height);
        boardContext.stroke();
    }
    for (let y = 0; y <= HEIGHT; y++) {
        boardContext.beginPath();
        boardContext.moveTo(0, y * CELL + 0.5);
        boardContext.lineTo(boardCanvas.width, y * CELL + 0.5);
        boardContext.stroke();
    }
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            if (board[y]?.[x]) drawCell(boardContext, x, y, board[y][x]);
        }
    }
    if (currentPiece) {
        currentPiece.shape.forEach((row, y) => row.forEach((filled, x) => {
            if (filled) drawCell(boardContext, currentPiece.x + x, currentPiece.y + y, currentPiece.color);
        }));
    }
}

function drawNextPiece() {
    nextContext.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (!nextPiece) return;
    const size = 20;
    const offsetX = Math.floor((nextCanvas.width / size - nextPiece.shape[0].length) / 2);
    const offsetY = Math.floor((nextCanvas.height / size - nextPiece.shape.length) / 2);
    nextPiece.shape.forEach((row, y) => row.forEach((filled, x) => {
        if (filled) drawCell(nextContext, offsetX + x, offsetY + y, nextPiece.color, size);
    }));
}

function collides(piece, dx = 0, dy = 0, shape = piece.shape) {
    return shape.some((row, y) => row.some((filled, x) => {
        if (!filled) return false;
        const nextX = piece.x + x + dx;
        const nextY = piece.y + y + dy;
        return nextX < 0 || nextX >= WIDTH || nextY >= HEIGHT ||
            (nextY >= 0 && board[nextY][nextX] !== null);
    }));
}

function spawnPiece() {
    currentPiece = nextPiece || makePiece();
    currentPiece.x = Math.floor((WIDTH - currentPiece.shape[0].length) / 2);
    currentPiece.y = 0;
    nextPiece = makePiece();
    drawNextPiece();
    if (collides(currentPiece)) finishGame();
}

function lockPiece() {
    currentPiece.shape.forEach((row, y) => row.forEach((filled, x) => {
        if (!filled) return;
        const targetY = currentPiece.y + y;
        if (targetY < 0) {
            finishGame();
            return;
        }
        board[targetY][currentPiece.x + x] = currentPiece.color;
    }));
    if (!running) return;

    let rows = 0;
    for (let y = HEIGHT - 1; y >= 0; y--) {
        if (board[y].every(Boolean)) {
            board.splice(y, 1);
            board.unshift(Array(WIDTH).fill(null));
            rows++;
            y++;
        }
    }
    if (rows) {
        clearedLines += rows;
        score += [0, 100, 300, 500, 800][rows] * level;
        level = Math.floor(clearedLines / 10) + 1;
        dropInterval = Math.max(100, 750 - (level - 1) * 55);
        playerScoreLabel.textContent = score.toLocaleString();
        playerLinesLabel.textContent = String(clearedLines);
        sendGameEvent({ type: "score", score });
    }
    spawnPiece();
    drawBoard();
}

function stepDown(points = 0) {
    if (!running) return;
    if (!collides(currentPiece, 0, 1)) {
        currentPiece.y++;
        if (points) {
            score += points;
            playerScoreLabel.textContent = score.toLocaleString();
            sendGameEvent({ type: "score", score });
        }
    } else {
        lockPiece();
    }
    drawBoard();
}

function moveHorizontal(distance) {
    if (running && !collides(currentPiece, distance, 0)) {
        currentPiece.x += distance;
        drawBoard();
    }
}

function rotatePiece() {
    if (!running) return;
    const rotated = currentPiece.shape[0].map((_, index) =>
        currentPiece.shape.map((row) => row[index]).reverse()
    );
    for (const kick of [0, -1, 1, -2, 2]) {
        if (!collides(currentPiece, kick, 0, rotated)) {
            currentPiece.x += kick;
            currentPiece.shape = rotated;
            drawBoard();
            return;
        }
    }
}

function hardDrop() {
    if (!running) return;
    let distance = 0;
    while (!collides(currentPiece, 0, 1)) {
        currentPiece.y++;
        distance++;
    }
    score += distance * 2;
    playerScoreLabel.textContent = score.toLocaleString();
    sendGameEvent({ type: "score", score });
    lockPiece();
}

function handleAction(action) {
    if (action === "left") moveHorizontal(-1);
    else if (action === "right") moveHorizontal(1);
    else if (action === "down") stepDown(1);
    else if (action === "rotate") rotatePiece();
    else if (action === "drop") hardDrop();
}

function gameLoop(timestamp) {
    if (!running) return;
    if (timestamp - lastDrop >= dropInterval) {
        stepDown();
        lastDrop = timestamp;
    }
    if (running) requestAnimationFrame(gameLoop);
}

function startGame() {
    board = newBoard();
    currentPiece = null;
    nextPiece = makePiece();
    score = 0;
    clearedLines = 0;
    level = 1;
    dropInterval = 750;
    running = true;
    gameResultReceived = false;
    playerScoreLabel.textContent = "0";
    playerLinesLabel.textContent = "0";
    opponentScoreLabel.textContent = "0";
    spawnPiece();
    drawBoard();
    lastDrop = performance.now();
    requestAnimationFrame(gameLoop);
}

function finishGame() {
    if (!running) return;
    running = false;
    currentPiece = null;
    drawBoard();
    connectionStatus.textContent = "Bạn đã hết chỗ — đang chờ kết quả trận đấu.";
    sendGameEvent({ type: "game_over", score });
}

function sendGameEvent(event) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}

function showOverlay(title, message, buttonText = "Tìm trận") {
    overlayTitle.textContent = title;
    gameMessage.textContent = message;
    findMatchButton.textContent = buttonText;
    findMatchButton.disabled = false;
    overlay.classList.remove("hidden");
}

function joinMatchmaking() {
    if (!token) {
        location.href = "index.html";
        return;
    }
    if (socket && socket.readyState <= WebSocket.OPEN && !running) {
        socket.close();
        socket = null;
        connectionStatus.textContent = "Đã hủy tìm trận.";
        opponentNameLabel.textContent = "Đang chờ đối thủ";
        opponentStatus.textContent = "Hãy nhấn tìm trận để bắt đầu.";
        matchStatus.textContent = "Chưa vào trận";
        showOverlay("Sẵn sàng chưa?", "Tìm một người chơi khác đang trực tuyến để đấu 1v1.");
        return;
    }

    findMatchButton.disabled = true;
    showOverlay("Đang tìm đối thủ...", "Bạn sẽ được ghép với người chơi đầu tiên đang chờ.", "Đang tìm...");
    connectionStatus.textContent = "Đang kết nối máy chủ trò chơi...";
    const nextSocket = new WebSocket(WS_BASE, [`bearer.${token}`, "tetris"]);
    socket = nextSocket;
    nextSocket.onopen = () => {
        connectionStatus.textContent = "Đã vào hàng chờ...";
        findMatchButton.textContent = "Hủy tìm trận";
        findMatchButton.disabled = false;
    };
    nextSocket.onmessage = (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch {
            connectionStatus.textContent = "Máy chủ gửi dữ liệu trò chơi không hợp lệ.";
            return;
        }
        if (data.type === "waiting") {
            connectionStatus.textContent = data.players_waiting > 1 ?
                `Đang tìm trận · ${data.players_waiting} người trong hàng chờ` : "Đang chờ người chơi khác...";
        } else if (data.type === "matched") {
            opponent = data.opponent;
            opponentNameLabel.textContent = opponent;
            boardPlayerName.textContent = username;
            opponentStatus.textContent = "Trận đấu đang diễn ra!";
            matchStatus.textContent = "Đang chơi";
            connectionStatus.textContent = "Trận bắt đầu! Xếp gạch nhanh tay.";
            overlay.classList.add("hidden");
            startGame();
        } else if (data.type === "opponent_score") {
            opponentScoreLabel.textContent = Number(data.score).toLocaleString();
        } else if (data.type === "result") {
            running = false;
            gameResultReceived = true;
            matchStatus.textContent = "Đã kết thúc";
            opponentStatus.textContent = data.reason === "opponent_disconnected" ?
                "Đối thủ đã rời trận." : "Trận đấu đã kết thúc.";
            connectionStatus.textContent = data.result === "win" ? "Bạn đã chiến thắng!" : "Bạn đã thua trận này.";
            showOverlay(
                data.result === "win" ? "Chiến thắng! 🎉" : "Hết chỗ rồi!",
                data.reason === "opponent_disconnected" ?
                    "Đối thủ đã rời trận, bạn thắng ván này." :
                    `Tỉ số đối thủ: ${Number(data.opponent_score || 0).toLocaleString()}.`,
                "Tìm trận mới"
            );
        } else if (data.type === "error") {
            connectionStatus.textContent = data.message;
            showOverlay("Không thể vào trận", data.message, "Thử lại");
        }
    };
    nextSocket.onclose = (event) => {
        if (socket !== nextSocket) return;
        socket = null;
        if (gameResultReceived) return;
        if (event.code === 4401) {
            localStorage.removeItem(TOKEN_KEY);
            location.href = "index.html";
            return;
        }
        if (running) {
            running = false;
            connectionStatus.textContent = "Mất kết nối với máy chủ trò chơi.";
            showOverlay("Mất kết nối", "Hãy kết nối lại để tìm trận mới.", "Thử lại");
        } else if (findMatchButton.disabled || matchStatus.textContent === "Chưa vào trận") {
            connectionStatus.textContent = "Kết nối trò chơi đã đóng.";
            findMatchButton.disabled = false;
            findMatchButton.textContent = "Tìm trận";
        }
    };
    nextSocket.onerror = () => {
        connectionStatus.textContent = "Không thể kết nối trò chơi. Hãy thử lại.";
    };
}

findMatchButton.addEventListener("click", joinMatchmaking);
document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button.dataset.action));
});

document.addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(event.key)) event.preventDefault();
    if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") handleAction("left");
    else if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") handleAction("right");
    else if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") handleAction("down");
    else if (event.key === "ArrowUp" || event.key.toLowerCase() === "w") handleAction("rotate");
    else if (event.key === " ") handleAction("drop");
});

window.addEventListener("beforeunload", () => socket?.close());

async function initialize() {
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

drawBoard();
initialize();
