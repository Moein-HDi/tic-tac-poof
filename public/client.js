// public/client.js
console.log("client.js loaded");
const socket = io();

// UI elements
const createRoomBtn = document.getElementById("createRoomBtn");
const createdRoomLabel = document.getElementById("createdRoomLabel");
const roomIdInput = document.getElementById("roomIdInput");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const statusLabel = document.getElementById("statusLabel");
const yourSymbolSpan = document.getElementById("yourSymbol");
const currentPlayerSpan = document.getElementById("currentPlayer");
const roundSpan = document.getElementById("round");
const lifetimeSpan = document.getElementById("lifetime");
const boardContainer = document.getElementById("board");
const errorMessage = document.getElementById("errorMessage");

let currentRoomId = null;
let youAre = null;
let latestBoard = null;
let latestStatus = null;
let latestWinner = null;

lifetimeSpan.textContent = "3"; // keep in sync with server MOVE_LIFETIME_ROUNDS

// Create room via HTTP
createRoomBtn.addEventListener("click", async () => {
  try {
    const res = await fetch("/create-room");
    if (!res.ok) {
      throw new Error("Failed to create room");
    }
    const data = await res.json();
    currentRoomId = data.roomId;
    createdRoomLabel.textContent = `Room code: ${currentRoomId}`;
    roomIdInput.value = currentRoomId;
    statusLabel.textContent = "Room created. Share the code with your friend.";
    errorMessage.textContent = "";

    // NEW: auto-join as the first player
    socket.emit("joinRoom", { roomId: currentRoomId });
  } catch (err) {
    console.error(err);
    errorMessage.textContent = "Error creating room";
  }
});

// Join room via Socket.IO
joinRoomBtn.addEventListener("click", () => {
  const roomId = roomIdInput.value.trim();
  if (!roomId) {
    errorMessage.textContent = "Enter a room code first.";
    return;
  }

  currentRoomId = roomId;
  socket.emit("joinRoom", { roomId });
});

// Handle game state updates
socket.on("gameState", (state) => {
  currentRoomId = state.roomId;
  latestBoard = state.board;
  latestStatus = state.status;
  latestWinner = state.winner || null;

  roundSpan.textContent = state.round;
  currentPlayerSpan.textContent =
    state.status === "playing" ? state.currentPlayer : "-";

  if (state.youAre) {
    youAre = state.youAre;
    yourSymbolSpan.textContent = youAre;
  }

  if (state.status === "waiting") {
    statusLabel.textContent = "Waiting for second player to join...";
  } else if (state.status === "playing") {
    statusLabel.textContent = "Game in progress.";
  } else if (state.status === "finished") {
    if (latestWinner) {
      statusLabel.textContent = `Game finished. Winner: ${latestWinner}`;
    } else {
      statusLabel.textContent = "Game finished. Draw (no winner).";
    }
  }

  errorMessage.textContent = "";
  renderBoard(latestBoard);
});

// Player joined / left info
socket.on("playerJoined", ({ players, status }) => {
  if (status === "playing") {
    statusLabel.textContent = "Both players joined. Game started.";
  }
});

socket.on("playerLeft", ({ players, status }) => {
  statusLabel.textContent = "Other player left. You can close the tab.";
});

// Error messages from server
socket.on("errorMessage", (msg) => {
  errorMessage.textContent = msg;
});

// Render board and attach click handlers
function renderBoard(board) {
  boardContainer.innerHTML = "";

  board.forEach((rowArr, rowIdx) => {
    rowArr.forEach((cell, colIdx) => {
      const div = document.createElement("div");
      div.classList.add("cell");

      if (!cell) {
        // Empty cell
        div.classList.add("empty");
        div.textContent = "";
      } else {
        // Occupied cell
        div.classList.add(cell.player); // "X" or "O"
        div.textContent = cell.player;

        // NEW: faded look for marks about to disappear
        if (cell.willExpireSoon) {
          div.classList.add("willExpireSoon");
        }
      }

      div.addEventListener("click", () => {
        if (!currentRoomId) {
          errorMessage.textContent = "Join a room first.";
          return;
        }
        if (latestStatus !== "playing") {
          errorMessage.textContent = "Game is not active.";
          return;
        }
        if (cell !== null) {
          errorMessage.textContent = "Cell already occupied.";
          return;
        }
        errorMessage.textContent = "";
        socket.emit("makeMove", {
          roomId: currentRoomId,
          row: rowIdx,
          col: colIdx
        });
      });

      boardContainer.appendChild(div);
    });
  });
}