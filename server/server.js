const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const BOARD_SIZE = 10;
const SHIP_CONFIG = [
  { name: 'Carrier', size: 5 },
  { name: 'Battleship', size: 4 },
  { name: 'Cruiser', size: 3 },
  { name: 'Submarine', size: 3 },
  { name: 'Destroyer', size: 2 }
];

// roomCode -> { players: [socketId], state: {...} }
const rooms = new Map();

app.use(express.static(path.join(__dirname, '..', 'client')));

function createEmptyGrid(fill = null) {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(fill));
}

function getOpponentId(room, playerId) {
  return room.players.find((id) => id !== playerId) || null;
}

function randomRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function createRoomState() {
  return {
    phase: 'lobby',
    currentTurn: null,
    winner: null,
    rematchVotes: new Set(),
    players: new Map()
  };
}

function createPlayerState() {
  return {
    ready: false,
    board: createEmptyGrid(null),
    shotsReceived: createEmptyGrid(null),
    shotsMade: createEmptyGrid(null),
    ships: new Map(),
    shipCount: 0
  };
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

function validatePlacement(ships) {
  if (!Array.isArray(ships) || ships.length !== SHIP_CONFIG.length) {
    return { valid: false, message: 'Invalid number of ships.' };
  }

  const usedCells = new Set();
  const seenShips = new Set();

  for (const ship of ships) {
    const expected = SHIP_CONFIG.find((cfg) => cfg.name === ship.name);
    if (!expected || seenShips.has(ship.name)) {
      return { valid: false, message: 'Invalid ship set.' };
    }

    if (!Array.isArray(ship.cells) || ship.cells.length !== expected.size) {
      return { valid: false, message: `${ship.name} must have ${expected.size} cells.` };
    }

    const xs = ship.cells.map((cell) => cell.x);
    const ys = ship.cells.map((cell) => cell.y);
    const sameRow = ys.every((y) => y === ys[0]);
    const sameCol = xs.every((x) => x === xs[0]);
    if (!sameRow && !sameCol) {
      return { valid: false, message: `${ship.name} must be straight.` };
    }

    const ordered = sameRow ? [...xs].sort((a, b) => a - b) : [...ys].sort((a, b) => a - b);
    for (let i = 1; i < ordered.length; i += 1) {
      if (ordered[i] !== ordered[i - 1] + 1) {
        return { valid: false, message: `${ship.name} cells must be contiguous.` };
      }
    }

    for (const cell of ship.cells) {
      if (
        typeof cell.x !== 'number' ||
        typeof cell.y !== 'number' ||
        cell.x < 0 ||
        cell.y < 0 ||
        cell.x >= BOARD_SIZE ||
        cell.y >= BOARD_SIZE
      ) {
        return { valid: false, message: 'Ship placement out of bounds.' };
      }
      const key = `${cell.x},${cell.y}`;
      if (usedCells.has(key)) {
        return { valid: false, message: 'Ships cannot overlap.' };
      }
      usedCells.add(key);
    }

    seenShips.add(ship.name);
  }

  return { valid: true };
}

function applyPlacement(playerState, ships) {
  playerState.ready = true;
  playerState.board = createEmptyGrid(null);
  playerState.shotsReceived = createEmptyGrid(null);
  playerState.shotsMade = createEmptyGrid(null);
  playerState.ships = new Map();

  ships.forEach((ship, index) => {
    const shipId = `s${index}`;
    playerState.ships.set(shipId, {
      id: shipId,
      name: ship.name,
      size: ship.cells.length,
      hits: 0,
      sunk: false,
      cells: ship.cells
    });

    ship.cells.forEach((cell) => {
      playerState.board[cell.y][cell.x] = shipId;
    });
  });

  playerState.shipCount = ships.length;
}

function roomPayload(roomCode, socketId) {
  const room = rooms.get(roomCode);
  const opponentId = room ? getOpponentId(room, socketId) : null;

  return {
    roomCode,
    phase: room?.state.phase || 'lobby',
    currentTurn: room?.state.currentTurn || null,
    winner: room?.state.winner || null,
    you: socketId,
    opponentConnected: Boolean(opponentId),
    playersConnected: room?.players.length || 0,
    yourReady: room?.state.players.get(socketId)?.ready || false,
    opponentReady: opponentId ? room.state.players.get(opponentId)?.ready || false : false
  };
}

function emitRoomState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }

  room.players.forEach((playerId) => {
    io.to(playerId).emit('roomState', roomPayload(roomCode, playerId));
  });
}

function startGameIfReady(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.players.length !== 2) {
    return;
  }

  const allReady = room.players.every((id) => room.state.players.get(id)?.ready);
  if (!allReady) {
    return;
  }

  room.state.phase = 'battle';
  room.state.winner = null;
  room.state.rematchVotes.clear();
  room.state.currentTurn = room.players[Math.floor(Math.random() * 2)];

  room.players.forEach((playerId) => {
    io.to(playerId).emit('gameStart', {
      yourTurn: room.state.currentTurn === playerId,
      currentTurn: room.state.currentTurn,
      shipConfig: SHIP_CONFIG
    });
  });

  emitRoomState(roomCode);
}

function resetForRematch(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }

  room.state.phase = 'lobby';
  room.state.currentTurn = null;
  room.state.winner = null;
  room.state.rematchVotes.clear();

  room.players.forEach((playerId) => {
    room.state.players.set(playerId, createPlayerState());
  });

  emitRoomState(roomCode);
}

io.on('connection', (socket) => {
  socket.on('createRoom', () => {
    let code = randomRoomCode();
    while (rooms.has(code)) {
      code = randomRoomCode();
    }

    const state = createRoomState();
    state.players.set(socket.id, createPlayerState());

    rooms.set(code, {
      players: [socket.id],
      state
    });

    socket.join(code);
    socket.data.roomCode = code;
    socket.emit('roomJoined', roomPayload(code, socket.id));
    emitRoomState(code);
  });

  socket.on('joinRoom', (rawCode) => {
    const code = normalizeCode(rawCode);
    const room = rooms.get(code);

    if (!code || !room) {
      socket.emit('actionError', 'Room does not exist.');
      return;
    }

    if (room.players.length >= 2) {
      socket.emit('actionError', 'Room is full.');
      return;
    }

    room.players.push(socket.id);
    room.state.players.set(socket.id, createPlayerState());

    socket.join(code);
    socket.data.roomCode = code;
    socket.emit('roomJoined', roomPayload(code, socket.id));
    emitRoomState(code);
  });

  socket.on('submitPlacement', (ships) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit('actionError', 'Join a room first.');
      return;
    }

    const playerState = room.state.players.get(socket.id);
    if (!playerState) {
      socket.emit('actionError', 'Player state missing.');
      return;
    }

    if (room.state.phase !== 'lobby') {
      socket.emit('actionError', 'Cannot place ships right now.');
      return;
    }

    const validation = validatePlacement(ships);
    if (!validation.valid) {
      socket.emit('actionError', validation.message);
      return;
    }

    applyPlacement(playerState, ships);
    emitRoomState(roomCode);
    startGameIfReady(roomCode);
  });

  socket.on('attack', ({ x, y }) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit('actionError', 'Join a room first.');
      return;
    }

    if (room.state.phase !== 'battle') {
      socket.emit('actionError', 'The game is not in battle phase.');
      return;
    }

    if (room.state.currentTurn !== socket.id) {
      socket.emit('actionError', 'It is not your turn.');
      return;
    }

    if (typeof x !== 'number' || typeof y !== 'number' || x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) {
      socket.emit('actionError', 'Invalid target cell.');
      return;
    }

    const opponentId = getOpponentId(room, socket.id);
    if (!opponentId) {
      socket.emit('actionError', 'Opponent is not connected.');
      return;
    }

    const attacker = room.state.players.get(socket.id);
    const defender = room.state.players.get(opponentId);

    if (defender.shotsReceived[y][x]) {
      socket.emit('actionError', 'This cell was already attacked.');
      return;
    }

    const shipId = defender.board[y][x];
    let outcome = 'miss';
    let sunkShip = null;

    if (shipId) {
      outcome = 'hit';
      defender.shotsReceived[y][x] = 'hit';
      attacker.shotsMade[y][x] = 'hit';
      const ship = defender.ships.get(shipId);
      ship.hits += 1;

      if (ship.hits >= ship.size) {
        ship.sunk = true;
        outcome = 'sunk';
        sunkShip = ship.name;
      }
    } else {
      defender.shotsReceived[y][x] = 'miss';
      attacker.shotsMade[y][x] = 'miss';
    }

    const allSunk = Array.from(defender.ships.values()).every((ship) => ship.sunk);

    io.to(socket.id).emit('attackResult', {
      x,
      y,
      outcome,
      sunkShip,
      yourTurn: false
    });

    io.to(opponentId).emit('defenseResult', {
      x,
      y,
      outcome,
      sunkShip
    });

    if (allSunk) {
      room.state.phase = 'finished';
      room.state.winner = socket.id;
      room.state.currentTurn = null;

      room.players.forEach((playerId) => {
        io.to(playerId).emit('gameOver', {
          winner: socket.id,
          youWon: playerId === socket.id
        });
      });

      emitRoomState(roomCode);
      return;
    }

    room.state.currentTurn = opponentId;
    room.players.forEach((playerId) => {
      io.to(playerId).emit('turnChanged', {
        currentTurn: room.state.currentTurn,
        yourTurn: playerId === room.state.currentTurn
      });
    });

    emitRoomState(roomCode);
  });

  socket.on('requestRematch', () => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    if (!room || room.state.phase !== 'finished') {
      socket.emit('actionError', 'Rematch is not available now.');
      return;
    }

    room.state.rematchVotes.add(socket.id);
    room.players.forEach((playerId) => {
      io.to(playerId).emit('rematchStatus', {
        votes: room.state.rematchVotes.size,
        required: room.players.length
      });
    });

    if (room.state.rematchVotes.size === room.players.length) {
      resetForRematch(roomCode);
    }
  });

  socket.on('disconnect', () => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    if (!room) {
      return;
    }

    room.players = room.players.filter((id) => id !== socket.id);
    room.state.players.delete(socket.id);
    room.state.rematchVotes.delete(socket.id);

    if (room.players.length === 0) {
      rooms.delete(roomCode);
      return;
    }

    room.players.forEach((playerId) => {
      io.to(playerId).emit('actionError', 'Opponent disconnected. Waiting for new player.');
    });

    resetForRematch(roomCode);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
