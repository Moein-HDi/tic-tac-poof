// server.js
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// ---- Game config ----
const BOARD_SIZE = 3;
const MAX_MARKS_PER_PLAYER = 3; // each player can have at most 3 marks on board

// rooms[roomId] = { players: { socketId: "X" | "O" }, board, currentPlayer, round }
const rooms = {};

// Helper to create empty board
function createEmptyBoard() {
    return Array.from({ length: BOARD_SIZE }, () =>
        Array.from({ length: BOARD_SIZE }, () => null)
    );
}

// Clean up expired marks based on current round
// function applyExpiry(room) {
//   const { board, round } = room;
//   for (let r = 0; r < BOARD_SIZE; r++) {
//     for (let c = 0; c < BOARD_SIZE; c++) {
//       const cell = board[r][c];
//       if (cell) {
//         const age = round - cell.placedRound;
//         if (age >= MOVE_LIFETIME_ROUNDS) {
//           board[r][c] = null;
//         }
//       }
//     }
//   }
// }

// Check win condition for a given player symbol ("X" or "O")
function checkWin(board, player) {
    // rows
    for (let r = 0; r < BOARD_SIZE; r++) {
        if (
            board[r][0]?.player === player &&
            board[r][1]?.player === player &&
            board[r][2]?.player === player
        ) {
            return true;
        }
    }

    // columns
    for (let c = 0; c < BOARD_SIZE; c++) {
        if (
            board[0][c]?.player === player &&
            board[1][c]?.player === player &&
            board[2][c]?.player === player
        ) {
            return true;
        }
    }

    // diagonals
    if (
        board[0][0]?.player === player &&
        board[1][1]?.player === player &&
        board[2][2]?.player === player
    ) {
        return true;
    }

    if (
        board[0][2]?.player === player &&
        board[1][1]?.player === player &&
        board[2][0]?.player === player
    ) {
        return true;
    }

    return false;
}

function updateExpiryFlags(room) {
    const { board, marksByPlayer } = room;

    // Clear previous flags
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = board[r][c];
            if (cell && cell.willExpireSoon) {
                delete cell.willExpireSoon;
            }
        }
    }

    // For each player, if they are at or above capacity, mark their oldest as "about to disappear"
    ["X", "O"].forEach((symbol) => {
        const list = marksByPlayer[symbol];
        if (list && list.length >= MAX_MARKS_PER_PLAYER) {
            const oldest = list[0]; // first is oldest
            const cell = board[oldest.row][oldest.col];
            if (cell && cell.player === symbol) {
                cell.willExpireSoon = true;
            }
        }
    });
}

// Generate a simple room code
function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

function resetRoomState(room) {
  room.board = createEmptyBoard();
  room.round = 0;
  room.currentPlayer = "X";
  room.status = "playing"; // or "waiting" if you want ready checks
  room.marksByPlayer = {
    X: [],
    O: []
  };
  updateExpiryFlags(room); // clear any flags
}

// HTTP endpoint to create a room (for invite links)
app.get("/create-room", (req, res) => {
    let roomId;
    do {
        roomId = generateRoomCode();
    } while (rooms[roomId]);

    rooms[roomId] = {
        players: {}, // socketId -> "X" or "O"
        board: createEmptyBoard(),
        currentPlayer: "X",
        round: 0,
        status: "waiting", // "waiting" | "playing" | "finished"
        marksByPlayer: {
            X: [],
            O: []
        } // each entry: { row, col, placedRound }
    };

    res.json({ roomId });
});

// Socket.IO handling
io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    socket.on("joinRoom", ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) {
            socket.emit("errorMessage", "Room not found");
            return;
        }

        // Enforce max 2 players
        const playerCount = Object.keys(room.players).length;
        if (playerCount >= 2 && !room.players[socket.id]) {
            socket.emit("errorMessage", "Room is full");
            return;
        }

        // Assign symbol
        if (!room.players[socket.id]) {
            const existingSymbols = Object.values(room.players);
            const symbol = existingSymbols.includes("X") ? "O" : "X";
            room.players[socket.id] = symbol;
            console.log(`Assigned ${symbol} to ${socket.id} in room ${roomId}`);
        }

        socket.join(roomId);

        // Update status when second player joins
        if (Object.keys(room.players).length === 2 && room.status === "waiting") {
            room.status = "playing";
        }
        updateExpiryFlags(room);
        // NEW: send full gameState to EVERY socket in the room
        io.in(roomId).fetchSockets().then((socketsInRoom) => {
            socketsInRoom.forEach((sock) => {
                const symbol = room.players[sock.id] || null;
                sock.emit("gameState", {
                    roomId,
                    board: room.board,
                    currentPlayer: room.currentPlayer,
                    round: room.round,
                    players: room.players,
                    status: room.status,
                    youAre: symbol
                });
            });
        }).catch((err) => {
            console.error("Error fetching sockets in room:", err);
        });

        // Send current state to this player
        socket.emit("gameState", {
            roomId,
            board: room.board,
            currentPlayer: room.currentPlayer,
            round: room.round,
            players: room.players,
            status: room.status,
            youAre: room.players[socket.id]
        });

        // Notify others that someone joined
        socket.to(roomId).emit("playerJoined", {
            players: room.players,
            status: room.status
        });
    });

    socket.on("makeMove", ({ roomId, row, col }) => {
        const room = rooms[roomId];
        if (!room) {
            socket.emit("errorMessage", "Room not found");
            return;
        }

        const playerSymbol = room.players[socket.id];
        if (!playerSymbol) {
            socket.emit("errorMessage", "You are not part of this room");
            return;
        }

        if (room.status !== "playing") {
            socket.emit("errorMessage", "Game is not in playing state");
            return;
        }

        if (playerSymbol !== room.currentPlayer) {
            socket.emit("errorMessage", "Not your turn");
            return;
        }

        // Bounds check
        if (
            row < 0 ||
            row >= BOARD_SIZE ||
            col < 0 ||
            col >= BOARD_SIZE
        ) {
            socket.emit("errorMessage", "Invalid position");
            return;
        }

        // Cell must be empty
        if (room.board[row][col] !== null) {
            socket.emit("errorMessage", "Cell already occupied");
            return;
        }

        // Capacity-based expiry per player
        const playerMarks = room.marksByPlayer[playerSymbol];

        // If player already has MAX_MARKS_PER_PLAYER marks, remove the oldest
        if (playerMarks.length >= MAX_MARKS_PER_PLAYER) {
            const oldest = playerMarks.shift(); // remove first (oldest) entry
            room.board[oldest.row][oldest.col] = null;
        }

        // Place new move
        room.board[row][col] = {
            player: playerSymbol,
            placedRound: room.round
        };

        // Track in marksByPlayer
        playerMarks.push({ row, col, placedRound: room.round });

        // Advance round
        room.round += 1;

        // NEW: update expiry flags
        updateExpiryFlags(room);

        // Check for win
        const hasWon = checkWin(room.board, playerSymbol);
        if (hasWon) {
            room.status = "finished";
        } else {
            const anyEmpty = room.board.some((rowArr) =>
                rowArr.some((cell) => cell === null)
            );
            if (!anyEmpty) {
                room.status = "finished"; // draw
            }
        }

        // Switch current player if game still going
        if (room.status === "playing") {
            room.currentPlayer = room.currentPlayer === "X" ? "O" : "X";
        }

        // Broadcast updated state
        io.to(roomId).emit("gameState", {
            roomId,
            board: room.board,
            currentPlayer: room.currentPlayer,
            round: room.round,
            players: room.players,
            status: room.status,
            winner: hasWon ? playerSymbol : null
        });
    });

    socket.on("resetGame", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit("errorMessage", "Room not found");
      return;
    }

    // Optional: restrict who can reset (e.g., only one of the players)
    if (!room.players[socket.id]) {
      socket.emit("errorMessage", "You are not part of this room");
      return;
    }

    resetRoomState(room);

    io.to(roomId).emit("gameState", {
      roomId,
      board: room.board,
      currentPlayer: room.currentPlayer,
      round: room.round,
      players: room.players,
      status: room.status,
      winner: null
    });
  });

    socket.on("disconnect", () => {
        console.log("Socket disconnected:", socket.id);

        // Remove player from any rooms they were in
        for (const [roomId, room] of Object.entries(rooms)) {
            if (room.players[socket.id]) {
                delete room.players[socket.id];
                // If room empties, you might clean it up
                if (Object.keys(room.players).length === 0) {
                    delete rooms[roomId];
                    console.log("Deleted empty room:", roomId);
                } else {
                    // Notify remaining player
                    io.to(roomId).emit("playerLeft", {
                        players: room.players,
                        status: room.status
                    });
                }
            }
        }
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Listening on http://localhost:${PORT}`);
});