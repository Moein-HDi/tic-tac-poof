// public/client.js
console.log("client.js loaded");
const socket = io();

// UI elements
const createRoomBtn = document.getElementById("createRoomBtn");
const roomIdInput = document.getElementById("roomIdInput");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const statusLabel = document.getElementById("statusLabel");
const yourSymbolSpan = document.getElementById("yourSymbol");
const roundSpan = document.getElementById("round");
// const lifetimeSpan = document.getElementById("lifetime");
const boardContainer = document.getElementById("board");
const errorMessage = document.getElementById("errorMessage");

// new elements for lobby/game separation & status bar
const lobby = document.getElementById("lobby");
const gameSection = document.getElementById("gameSection");
const statusSegment = document.getElementById("statusSegment");
const symbolSegment = document.getElementById("symbolSegment");
const roundSegment = document.getElementById("roundSegment");
const roomCodeDisplay = document.getElementById("roomCodeDisplay");
const roomCodeValue = document.getElementById("roomCodeValue");
const resultBar = document.getElementById("resultBar");
const resultMessage = document.getElementById("resultMessage");
const replayBtn = document.getElementById("replayBtn");

let currentRoomId = null;
let youAre = null;
let latestBoard = null;
let latestStatus = null;
let latestWinner = null;

// lifetimeSpan.textContent = "3"; // keep in sync with server MOVE_LIFETIME_ROUNDS

function showLobby() {
  lobby.classList.remove("hidden");
  gameSection.classList.add("hidden");
  resultBar.classList.add("hidden");
  roomCodeDisplay.classList.add("hidden");
}

function showGame() {
  lobby.classList.add("hidden");
  gameSection.classList.remove("hidden");
}

// initial view: lobby
showLobby();

// Create room via HTTP
createRoomBtn.addEventListener("click", async () => {
  try {
    const res = await fetch("/create-room");
    if (!res.ok) {
      throw new Error("Failed to create room");
    }
    const data = await res.json();
    currentRoomId = data.roomId;

    // show info in lobby
    roomIdInput.value = currentRoomId;
    statusLabel.textContent = "Room created. Share the code with your friend.";
    errorMessage.textContent = "";

    // show room code in game section (will show after gameState)
    roomCodeValue.textContent = currentRoomId;

    // auto-join as the first player
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
  roomCodeValue.textContent = currentRoomId;
  socket.emit("joinRoom", { roomId });
});

// Handle game state updates
socket.on("gameState", (state) => {
  currentRoomId = state.roomId;
  latestBoard = state.board;
  latestStatus = state.status;
  latestWinner = state.winner || null;

  // show game section once we have state
  showGame();

  // update round
  roundSpan.textContent = state.round;
  roundSegment.textContent = `Round: ${state.round}`;

  // symbol
  if (state.youAre) {
    youAre = state.youAre;
    yourSymbolSpan.textContent = youAre;
    symbolSegment.textContent = `Symbol: ${youAre}`;
  }

  // show/hide room code based on status
  if (state.status === "waiting") {
    roomCodeDisplay.classList.remove("hidden");
  } else {
    roomCodeDisplay.classList.add("hidden");
  }

  // update status bar segment
  statusSegment.classList.remove(
    "status-waiting",
    "status-your-turn",
    "status-opponent-turn",
    "status-finished"
  );

  if (state.status === "waiting") {
    statusSegment.textContent = "Waiting for second player...";
    statusSegment.classList.add("status-waiting");
  } else if (state.status === "playing") {
    if (youAre && state.currentPlayer === youAre) {
      statusSegment.textContent = "Your turn";
      statusSegment.classList.add("status-your-turn");
    } else {
      statusSegment.textContent = "Opponent's turn";
      statusSegment.classList.add("status-opponent-turn");
    }
  } else if (state.status === "finished") {
    statusSegment.textContent = "Game finished";
    statusSegment.classList.add("status-finished");
  }

  // legacy text status (optional, can be removed later)
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

  // result + rematch UI
  if (state.status === "finished") {
    resultMessage.classList.remove("result-win", "result-lose", "result-draw");

    if (latestWinner) {
      if (youAre && latestWinner === youAre) {
        resultMessage.textContent = "You won!";
        resultMessage.classList.add("result-win");
      } else {
        resultMessage.textContent = "You lost.";
        resultMessage.classList.add("result-lose");
      }
    } else {
      resultMessage.textContent = "Draw.";
      resultMessage.classList.add("result-draw");
    }

    resultBar.classList.remove("hidden");
  } else {
    resultBar.classList.add("hidden");
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

// Rematch (requires server-side resetGame handler)
replayBtn.addEventListener("click", () => {
  if (!currentRoomId) {
    errorMessage.textContent = "No active room to reset.";
    return;
  }
  socket.emit("resetGame", { roomId: currentRoomId });
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
        // Use background images only, no text
        div.textContent = "";

        // faded look for marks about to disappear
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