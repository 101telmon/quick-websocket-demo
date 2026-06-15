"use strict";

// Offline Mode Constants
const offlineModeSelect = document.getElementById('offline-mode-select');
const computerDifficultySelect = document.getElementById('computer-difficulty-select');
const startGameBtn = document.getElementById('start-game-btn');

// Online Mode Constants
const onlineStatus = document.getElementById('online-status');
const connectionStatus = document.getElementById('connection-status');
const playerName = document.getElementById('player-name');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');

// Grid Constants
const gameBoard = document.getElementById('game-board');
const reset = document.getElementById('reset-btn');
const turnStatus = document.getElementById('turn-status');
const gameLog = document.getElementById('game-log');
const gameStatus = document.getElementById('game-status');

// Database Constants
const tableBody = document.getElementById('highscores-table-body');
const tableMessage = document.getElementById('table-message');

// Grid Variables and Constants
const TOTAL_ROWS = 6;
const TOTAL_COLS = 7;
const TOTAL_BUTTONS = TOTAL_ROWS * TOTAL_COLS;
let grid = Array(TOTAL_ROWS).fill().map(() => Array(TOTAL_COLS).fill(null));

// Online Mode Variables
let onlinePlayerColour = "";
let onlinePlayerName = "";
let isOnline = false;
let ws;

// Offline Mode Variables
let aiDifficulty = "";
let isPlayingAI = false;

// Both Mode Variables
let currentPlayerColour = 'R';
let disableGridBtns = true;
let onlineGameEnded = false;
let gameStartTime = null;

// WebSocket Server Setup
function wsOpen() {
    if (playerName.value.trim() === "") {
        showMessage("Player name cannot be empty, please enter a name and try to connect again");
        return;
    }

    if (ws) {
        return;
    }

    ws = new WebSocket(`ws://127.0.0.1:3000`);
    isOnline = true;

    ws.onmessage = function (event) {
        ws.onerror = ws.onopen = null;
        let payload = JSON.parse(event.data);
        switch (payload.type) {
            case 'server-filled':
                showMessage(`WebSocket Error: ${payload.data}`);
                wsClose();
                break;
            case 'name-taken':
                showMessage(`WebSocket Error: ${payload.data}`);
                wsClose();
                break;
            case 'colour-assign':
                onlinePlayerColour = payload.data;
                showMessage(`WebSocket Success: You have been assigned as ${payload.data}!`);
                break;
            case 'game-start':
                showMessage(`WebSocket Notice: ${payload.data}`);
                resetGame();
                if (onlinePlayerColour === 'R') {
                    disableGridBtns = false;
                } else {
                    disableGridBtns = true;
                }
                onlineGameEnded = false;
                break;
            case 'successful-move':
                showMessage(`WebSocket Notice: Player ${payload.sender} made a move in column ${payload.data.col + 1}`);
                disableGridBtns = false
                makeMove(payload.data.row, payload.data.col);
                if (!disableGridBtns) {
                    disableGridBtns = (currentPlayerColour !== onlinePlayerColour);
                }
                break;
            case 'invalid-move':
                showMessage(`WebSocket Error: ${payload.data}`);
                break;
            case 'player-disconnect':
                resetGame();
                disableGridBtns = true;
                showMessage(`WebSocket Notice: ${payload.data}`);
                break;
            case 'play-again':
                showMessage(`WebSocket Notice: ${payload.data}`);
                onlineGameEnded = true;
                break;
            case 'request-rematch':
                showMessage(`WebSocket Notice: ${payload.data}`);
                break;
            case 'send-highscores':
                addHighscoreData(payload);
                break;
        }
    }
    ws.onerror = function () {
        showMessage("WebSocket Error: Unable to connect to server.");
    }
    ws.onopen = function () {
        showMessage("WebSocket Success: Connected to server.");
        connectionStatus.textContent = "Connected!";
        onlinePlayerName = playerName.value.trim();
        wsSend({
            type: 'player-connect',
            sender: onlinePlayerName,
            data: null
        });
        wsSend({
            type: 'get-highscores',
            sender: null,
            data: null
        })
    }
    ws.onclose = function () {
        showMessage("WebSocket Closed: Connection to server closed.");
        connectionStatus.textContent = "Disconnected!";
        ws = null;
    }
}

function wsClose() {
    if (ws) {
        showMessage("WebSocket Closing: Closing connection to server.");
        wsSend({
            type: 'player-disconnect',
            sender: playerName.value.trim(),
            data: onlinePlayerColour
        });
        ws.close();
    }
    resetGame();
}

function wsSend(payload) {
    if (!ws) {
        showMessage("WebSocket Error: Not connected to server.");
        return;
    }
    ws.send(JSON.stringify(payload));
}

function showMessage(message) {
    onlineStatus.textContent = message;
}

// Database Setup
function addHighscoreData(payload) {
    if (payload.data.length === 0) {
        tableMessage.textContent = "No highscores yet. Play a game to get on the board!";
        return;
    }
    tableMessage.textContent = "Top 10 Highscores:";
    let rowsHtml = "";
    payload.data.forEach((score, index) => {
        rowsHtml += `
        <tr class="score-row"> <td>${index + 1}</td>
            <td>${score.player_name}</td>
            <td>${score.game_mode}</td>
            <td>${formatTime(score.time)}</td>
        </tr>
        `;
    });
    tableBody.innerHTML = rowsHtml;
}

function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const paddedMinutes = String(minutes).padStart(2, '0');
    const paddedSeconds = String(seconds).padStart(2, '0');
    return `${paddedMinutes}:${paddedSeconds}`;
}

// HTML Element Event Listeners
startGameBtn.addEventListener('click', () => {
    let offlineMode = offlineModeSelect.value;
    if (offlineMode === "pvp") {
        isPlayingAI = false;
        startOfflineGame();
    } else if (offlineMode === "pvc") {
        let difficulty = computerDifficultySelect.value;
        isPlayingAI = true;
        startAIGame(difficulty);
    }
});

connectBtn.addEventListener('click', () => {
    wsOpen();
});

disconnectBtn.addEventListener('click', () => {
    wsClose();
});

gameBoard.addEventListener('click', (event) => {
    if (event.target.classList.contains('grid-btn')) {
        if (disableGridBtns) { return; }
        let col = parseInt(event.target.id) % TOTAL_COLS;
        let row = checkEmptyInColumn(col);
        if (row === -1) { return; }
        if (isOnline) {
            wsSend({
                type: 'make-move',
                sender: onlinePlayerName,
                data: { row, col }
            });
            disableGridBtns = true;
            return;
        }
        makeMove(row, col);
    }
});

reset.addEventListener('click', () => {
    if (isOnline && onlineGameEnded) {
        wsSend({
            type: 'request-rematch',
            sender: onlinePlayerName,
            data: null
        });
        return;
    }
    resetGame();
});

// Start Functions
function startAIGame(difficulty) {
    aiDifficulty = difficulty;
    if (!isPlayingAI) { return; }
    if (difficulty === "") {
        showMessage("Please choose an AI difficulty.");
        return;
    }
    isOnline = false;
    resetGame();
    gameStatus.textContent = "Offline Player vs Computer";
    showMessage(`Starting Player vs Computer game. Difficulty: ${aiDifficulty}`);
}

function startOfflineGame() {
    isOnline = false;
    resetGame();
    gameStatus.textContent = "Offline Player vs Player"
    showMessage("Starting Offline Player vs Player game.");
}

function resetGame() {
    grid = Array(TOTAL_ROWS).fill().map(() => Array(TOTAL_COLS).fill(null));
    let gridBtns = document.querySelectorAll('.grid-btn');
    gridBtns.forEach(btn => btn.style.backgroundColor = '#ffffff');
    currentPlayerColour = 'R';
    turnStatus.textContent = `Player R's turn`;
    gameLog.value = '';
    disableGridBtns = false;
    gameStartTime = Date.now();
}

// In-Game Functions (making moves, finding winner etc.)
function makeMove(row, col) {
    grid[row][col] = currentPlayerColour;
    let gridBtn = document.getElementById((row * TOTAL_COLS) + col);
    // If currentPlayerColour is 'R', set btn color to red, otherwise yellow
    gridBtn.style.backgroundColor = currentPlayerColour === 'R' ? 'red' : 'yellow';
    if (foundWinner(row, col)) { return; }
    gameLog.value += `Player ${currentPlayerColour} placed a piece in column ${col + 1} (Grid space: [${row}, ${col}])\n`;
    currentPlayerColour = currentPlayerColour === 'R' ? 'Y' : 'R';
    turnStatus.textContent = `Player ${currentPlayerColour}'s turn`;
}

function foundWinner(row, col) {
    if (checkVertical(row, col) || checkHorizontal(row, col) ||
        checkDownDiagonal(row, col) || checkUpDiagonal(row, col)) {
        const gameEndTime = Date.now();
        let timeTaken = Math.floor((gameEndTime - gameStartTime) / 1000);
        turnStatus.textContent = `Player ${currentPlayerColour} wins! Time taken: ${timeTaken} seconds`;
        gameLog.value += `Player ${currentPlayerColour} wins!\n`;
        disableGridBtns = true
        if (isOnline && onlinePlayerColour === currentPlayerColour) {
            wsSend({
                type: 'game-end',
                sender: { colour: currentPlayerColour, name: onlinePlayerName },
                data: { time: timeTaken, gamemode: "Online Player vs Player" }
            });
        }
        return true;
    }
}

// Winner Checks
function checkVertical(row, col) {
    let count = 1;
    for (let r = row + 1; r < TOTAL_ROWS; r++) {
        if (grid[r][col] !== currentPlayerColour) { break; }
        count++;
    }
    for (let r = row - 1; r >= 0; r--) {
        if (grid[r][col] !== currentPlayerColour) { break; }
        count++;
    }
    return count >= 4;
}

function checkHorizontal(row, col) {
    let count = 1;
    for (let c = col + 1; c < TOTAL_COLS; c++) {
        if (grid[row][c] !== currentPlayerColour) { break; }
        count++;
    }
    for (let c = col - 1; c >= 0; c--) {
        if (grid[row][c] !== currentPlayerColour) { break; }
        count++;
    }
    return count >= 4;
}

function checkDownDiagonal(row, col) {
    let count = 1;
    for (let r = row + 1, c = col + 1; r < TOTAL_ROWS && c < TOTAL_COLS; r++, c++) {
        if (grid[r][c] !== currentPlayerColour) { break; }
        count++;
    }
    for (let r = row - 1, c = col - 1; r >= 0 && c >= 0; r--, c--) {
        if (grid[r][c] !== currentPlayerColour) { break; }
        count++;
    }
    return count >= 4;
}

function checkUpDiagonal(row, col) {
    let count = 1;
    for (let r = row + 1, c = col - 1; r < TOTAL_ROWS && c >= 0; r++, c--) {
        if (grid[r][c] !== currentPlayerColour) { break; }
        count++;
    }
    for (let r = row - 1, c = col + 1; r >= 0 && c < TOTAL_COLS; r--, c++) {
        if (grid[r][c] !== currentPlayerColour) { break; }
        count++;
    }
    return count >= 4;
}

function checkEmptyInColumn(col) {
    for (let row = TOTAL_ROWS - 1; row >= 0; row--) {
        if (grid[row][col] === null) {
            return row;
        }
    }
    return -1;
}

// On Page Load
function createBoard() {
    for (let i = 0; i < TOTAL_BUTTONS; i++) {
        let btn = document.createElement('button');
        btn.classList.add('grid-btn');
        btn.id = i;
        gameBoard.appendChild(btn);
    }
}

createBoard();