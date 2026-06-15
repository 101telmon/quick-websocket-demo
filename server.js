const WebSocket = require("ws");
const express = require("express");
const wss = new WebSocket.Server({ noServer: true });
const app = express();
const sqlite3 = require("sqlite3").verbose();

let players = [];
let gameStarted = false;
let isRedTaken = false;
let isYellowTaken = false;
let rematchVotes = 0;

let grid = createGrid();

// JSON payloads format for WebSocket messages
// {
//    type: ,
//    sender: ,
//    data: ,
// }

// Database Setup
let db = new sqlite3.Database("highscores.db", (err) => {
    if (err) {
        console.error("Error opening database: " + err.message);
        return;
    }
    const createTableQuery = "CREATE TABLE IF NOT EXISTS highscores (id INTEGER PRIMARY KEY AUTOINCREMENT, player_name TEXT NOT NULL, game_mode TEXT NOT NULL, time TIME NOT NULL)";
    db.run(createTableQuery, (err) => {
        if (err) {
            console.error("Error creating table: " + err.message);
        } else {
            console.log("highscores.db loaded successfully.");
        }
    });
});

function addNewHighscore(playerName, gameMode, time) {
    const insertQuery = "INSERT INTO highscores (id, player_name, game_mode, time) VALUES (null, ?, ?, ?)";
    const values = [playerName, gameMode, time];
    db.run(insertQuery, values, function (err) {
        if (err) {
            console.error("Error inserting highscore: " + err.message);
        } else {
            console.log(`New highscore added: ${playerName} | ${gameMode} | ${time}`);
            updateHighscores();
        }
    });
}

function updateHighscores() {
    const selectQuery = "SELECT * FROM highscores ORDER BY time ASC LIMIT 10";
    db.all(selectQuery, (err, rows) => {
        if (err) {
            console.error("Error retrieving highscores: " + err.message);
        } else {
            console.log("Highscores retrieved successfully.");
            wsSendToAll(null, {
                type: 'send-highscores',
                sender: null,
                data: rows
            });
        }
    });
}

// HTTP Request Handlers
function handleGet(req, res, file) {
    console.log(`Handling a GET /${file}`);
    res.sendFile(__dirname + `/${file}`, function (err) {
        if (err) {
            console.log(err);
        } else {
            console.log(`Sent: ${file}`);
        }
    });
}

app.get("/", (req, res) => {
    handleGet(req, res, "index.html");
});

app.get("/styles.css", (req, res) => {
    handleGet(req, res, "styles.css");
});

app.get("/client.js", (req, res) => {
    handleGet(req, res, "client.js");
});

const server = app.listen(3000, () => {
    console.log("Server running at http://127.0.0.1:3000/");
});

// WebSocket Handlers
server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
    });
});

wss.on("connection", (ws, req) => {
    console.log("WebSocket Connected!");
    ws.on("message", (message) => {
        let payload = JSON.parse(message);
        switch (payload.type) {
            case 'player-connect':
                if (!canPlayerJoin(ws, payload)) { return; }
                assignColour(ws, payload.sender);
                players.push(payload.sender);
                if (players.length === 2 && !gameStarted) {
                    console.log(`2 players in server. Starting game!`);
                    wsSendToAll(null, {
                        type: 'game-start',
                        sender: null,
                        data: "We have found a match! Starting game..."
                    });
                    gameStarted = true;
                }
                break;
            case 'player-disconnect':
                payload.data === 'R' ? isRedTaken = false : isYellowTaken = false;
                // Removes disconnected player by checking who sent the payload
                players = players.filter(player => player !== payload.sender);
                console.log(`Disconnected: ${payload.sender} | Remaining player: ${players[0]} | Player count: ${players.length}`);
                wsSendToAll(ws, {
                    type: 'player-disconnect',
                    sender: payload.sender,
                    data: `${payload.sender} has disconnected. Waiting for new player...`
                });
                gameStarted = false;
                break;
            case 'make-move':
                if (!gameStarted) { return; }
                if (grid[payload.data.row][payload.data.col] !== null) {
                    console.log("WebSocket Error: Invalid move.");
                    ws.send(JSON.stringify({
                        type: 'invalid-move',
                        sender: null,
                        data: "Invalid move."
                    }));
                    break;
                }
                console.log(`Player ${payload.sender} made move in ${payload.data}`);
                grid[payload.data.row][payload.data.col] = payload.sender;
                wsSendToAll(null, {
                    type: 'successful-move',
                    sender: payload.sender, data: { row: payload.data.row, col: payload.data.col }
                });
                break;
            case 'game-end':
                console.log(`Game ended! Requesting rematch.`);
                gameStarted = false;
                grid = createGrid();
                addNewHighscore(payload.sender.name, payload.data.gamemode, payload.data.time);
                wsSendToAll(null, {
                    type: 'play-again',
                    sender: null,
                    data: `The winner is ${payload.sender.colour}! Do you want to play again?`
                })
                break;
            case 'request-rematch':
                rematchVotes += 1;
                if (rematchVotes === 2) {
                    console.log("Both players agreed for rematch. Starting rematch!");
                    wsSendToAll(null, {
                        type: 'game-start',
                        sender: null,
                        data: "Starting rematch!"
                    });
                    gameStarted = true;
                    rematchVotes = 0;
                    break;
                }
                wsSendToAll(ws, {
                    type: 'request-rematch',
                    sender: payload.sender,
                    data: `${payload.sender} has requested a rematch. Do you accept?`
                });
                break;
            case 'get-highscores':
                updateHighscores();
                break;
        }
    });
    ws.on("close", () => {
        console.log("WebSocket Disconnected!");
    });
});


// ignoreWs: if you choose to ignore a specific player (e.g. the one who sent the message), pass their ws as the second argument and they will not receive the message
function wsSendToAll(ignoreWs = null, payload) {
    wss.clients.forEach(client => {
        if (client !== ignoreWs && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(payload));
        }
    });
}

// Helper Functions
function createGrid() { return Array(6).fill().map(() => Array(7).fill(null)); }

function canPlayerJoin(ws, payload) {
    if (players.length >= 2) {
        console.log("WebSocket Error: Maximum player limit reached.");
        ws.send(JSON.stringify({
            type: 'server-filled',
            sender: null,
            data: "Maximum player limit reached."
        }));
        return false;
    }
    if (players.includes(payload.sender)) {
        console.log("WebSocket Error: Player name already taken.");
        ws.send(JSON.stringify({
            type: 'name-taken',
            sender: payload.sender,
            data: "Player name already taken."
        }));
        return false;
    }
    return true;
}

function assignColour(ws, name) {
    if (isRedTaken === false) {
        ws.send(JSON.stringify({
            type: 'colour-assign',
            sender: name,
            data: 'R'
        }));
        isRedTaken = true;
    } else if (isYellowTaken === false) {
        ws.send(JSON.stringify({
            type: 'colour-assign',
            sender: name,
            data: 'Y'
        }));
        isYellowTaken = true;
    }
}