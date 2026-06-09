const socket = io();

const BOARD_SIZE = 10;
const SHIPS = [
  { name: 'Carrier', size: 5 },
  { name: 'Battleship', size: 4 },
  { name: 'Cruiser', size: 3 },
  { name: 'Submarine', size: 3 },
  { name: 'Destroyer', size: 2 }
];

const ui = {
  createRoom: document.getElementById('create-room'),
  joinRoom: document.getElementById('join-room'),
  roomCodeInput: document.getElementById('room-code'),
  statusRoom: document.getElementById('status-room'),
  statusPlayers: document.getElementById('status-players'),
  statusPhase: document.getElementById('status-phase'),
  statusTurn: document.getElementById('status-turn'),
  message: document.getElementById('message'),
  setup: document.getElementById('setup'),
  battle: document.getElementById('battle'),
  placementBoard: document.getElementById('placement-board'),
  myBoard: document.getElementById('my-board'),
  enemyBoard: document.getElementById('enemy-board'),
  rotateShip: document.getElementById('rotate-ship'),
  ready: document.getElementById('ready'),
  shipList: document.getElementById('ship-list'),
  rematch: document.getElementById('rematch')
};

const state = {
  roomCode: null,
  phase: 'lobby',
  myId: null,
  currentTurn: null,
  yourTurn: false,
  orientation: 'horizontal',
  activeShipIndex: 0,
  placements: [],
  myBoardShips: createGrid(null),
  myShotsReceived: createGrid(null),
  enemyShots: createGrid(null),
  gameOver: false
};

function createGrid(value) {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(value));
}

function setMessage(message, isError = false) {
  ui.message.textContent = message;
  ui.message.style.color = isError ? '#fca5a5' : '#2dd4bf';
}

function renderShipList() {
  ui.shipList.innerHTML = '';
  SHIPS.forEach((ship, index) => {
    const placed = state.placements[index];
    const li = document.createElement('li');
    li.textContent = `${ship.name} (${ship.size}) ${placed ? '✓' : ''}`;
    li.classList.toggle('placed', Boolean(placed));
    li.classList.toggle('active', index === state.activeShipIndex);
    ui.shipList.appendChild(li);
  });
}

function allShipsPlaced() {
  return state.placements.filter(Boolean).length === SHIPS.length;
}

function getPreviewCells(x, y) {
  const ship = SHIPS[state.activeShipIndex];
  if (!ship || state.placements[state.activeShipIndex]) {
    return [];
  }

  const cells = [];
  for (let i = 0; i < ship.size; i += 1) {
    const cx = state.orientation === 'horizontal' ? x + i : x;
    const cy = state.orientation === 'vertical' ? y + i : y;
    cells.push({ x: cx, y: cy });
  }
  return cells;
}

function canPlace(cells) {
  return cells.every(({ x, y }) => {
    if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) {
      return false;
    }
    return !state.myBoardShips[y][x];
  });
}

function clearPreviews() {
  ui.placementBoard.querySelectorAll('.cell').forEach((cell) => {
    cell.classList.remove('valid-preview', 'invalid-preview');
  });
}

function renderPlacementBoard() {
  ui.placementBoard.innerHTML = '';

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);

      if (state.myBoardShips[y][x]) {
        cell.classList.add('ship');
      }

      cell.addEventListener('mouseenter', () => {
        clearPreviews();
        const preview = getPreviewCells(x, y);
        if (!preview.length) {
          return;
        }
        const valid = canPlace(preview);
        preview.forEach((p) => {
          const el = ui.placementBoard.querySelector(`.cell[data-x="${p.x}"][data-y="${p.y}"]`);
          if (el) {
            el.classList.add(valid ? 'valid-preview' : 'invalid-preview');
          }
        });
      });

      cell.addEventListener('mouseleave', clearPreviews);

      cell.addEventListener('click', () => {
        const preview = getPreviewCells(x, y);
        if (!preview.length || !canPlace(preview)) {
          setMessage('Invalid ship placement.', true);
          return;
        }

        const ship = SHIPS[state.activeShipIndex];
        preview.forEach(({ x: px, y: py }) => {
          state.myBoardShips[py][px] = ship.name;
        });

        state.placements[state.activeShipIndex] = {
          name: ship.name,
          cells: preview
        };

        while (state.activeShipIndex < SHIPS.length && state.placements[state.activeShipIndex]) {
          state.activeShipIndex += 1;
        }

        ui.ready.disabled = !allShipsPlaced();
        renderShipList();
        renderPlacementBoard();
      });

      ui.placementBoard.appendChild(cell);
    }
  }
}

function renderMyBattleBoard() {
  ui.myBoard.innerHTML = '';
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      if (state.myBoardShips[y][x]) {
        cell.classList.add('ship');
      }
      if (state.myShotsReceived[y][x] === 'hit') {
        cell.classList.add('hit');
      }
      if (state.myShotsReceived[y][x] === 'miss') {
        cell.classList.add('miss');
      }
      ui.myBoard.appendChild(cell);
    }
  }
}

function renderEnemyBoard() {
  ui.enemyBoard.innerHTML = '';
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell enemy';
      const shot = state.enemyShots[y][x];
      if (shot === 'hit') {
        cell.classList.add('hit');
      }
      if (shot === 'miss') {
        cell.classList.add('miss');
      }
      if ((shot === 'hit' || shot === 'miss') || !state.yourTurn || state.gameOver) {
        cell.disabled = true;
      }

      cell.addEventListener('click', () => {
        if (!state.yourTurn || state.gameOver || state.enemyShots[y][x]) {
          return;
        }
        socket.emit('attack', { x, y });
      });
      ui.enemyBoard.appendChild(cell);
    }
  }
}

function renderStatus() {
  ui.statusRoom.textContent = state.roomCode || '-';
  ui.statusPhase.textContent = state.phase;
  ui.statusTurn.textContent = state.phase !== 'battle' ? '-' : state.yourTurn ? 'Your turn' : 'Opponent turn';
}

function updateSections() {
  ui.setup.classList.toggle('hidden', !(state.roomCode && state.phase === 'lobby'));
  ui.battle.classList.toggle('hidden', state.phase === 'lobby');
  ui.rematch.classList.toggle('hidden', state.phase !== 'finished');
}

function resetClientBoards() {
  state.activeShipIndex = 0;
  state.placements = [];
  state.myBoardShips = createGrid(null);
  state.myShotsReceived = createGrid(null);
  state.enemyShots = createGrid(null);
  state.gameOver = false;
  ui.ready.disabled = true;
  renderShipList();
  renderPlacementBoard();
  renderMyBattleBoard();
  renderEnemyBoard();
}

ui.createRoom.addEventListener('click', () => {
  socket.emit('createRoom');
});

ui.joinRoom.addEventListener('click', () => {
  const code = ui.roomCodeInput.value.trim().toUpperCase();
  socket.emit('joinRoom', code);
});

ui.rotateShip.addEventListener('click', () => {
  state.orientation = state.orientation === 'horizontal' ? 'vertical' : 'horizontal';
  ui.rotateShip.textContent = `Rotate: ${state.orientation === 'horizontal' ? 'Horizontal' : 'Vertical'}`;
});

ui.ready.addEventListener('click', () => {
  if (!allShipsPlaced()) {
    setMessage('Place all ships first.', true);
    return;
  }
  socket.emit('submitPlacement', state.placements);
  setMessage('Placement submitted. Waiting for opponent.');
});

ui.rematch.addEventListener('click', () => {
  socket.emit('requestRematch');
  setMessage('Rematch requested. Waiting for opponent.');
});

socket.on('roomJoined', (payload) => {
  state.roomCode = payload.roomCode;
  state.myId = payload.you;
  state.phase = payload.phase;
  state.currentTurn = payload.currentTurn;
  state.yourTurn = payload.currentTurn === state.myId;
  ui.statusPlayers.textContent = `${payload.playersConnected}/2`;
  resetClientBoards();
  updateSections();
  renderStatus();
  setMessage(`Joined room ${payload.roomCode}.`);
});

socket.on('roomState', (payload) => {
  state.roomCode = payload.roomCode;
  state.phase = payload.phase;
  state.currentTurn = payload.currentTurn;
  state.yourTurn = payload.currentTurn === state.myId;
  ui.statusPlayers.textContent = `${payload.playersConnected}/2`;
  updateSections();
  renderStatus();

  if (!payload.opponentConnected) {
    setMessage('Waiting for opponent to join...');
  } else if (state.phase === 'lobby') {
    const readiness = payload.yourReady ? 'ready' : 'not ready';
    setMessage(`Both players connected. You are ${readiness}.`);
  }
});

socket.on('gameStart', ({ yourTurn }) => {
  state.phase = 'battle';
  state.gameOver = false;
  state.yourTurn = yourTurn;
  setMessage(yourTurn ? 'Game started. Your turn!' : 'Game started. Opponent begins.');
  updateSections();
  renderStatus();
  renderMyBattleBoard();
  renderEnemyBoard();
});

socket.on('attackResult', ({ x, y, outcome, sunkShip }) => {
  state.enemyShots[y][x] = outcome === 'miss' ? 'miss' : 'hit';
  state.yourTurn = false;
  renderEnemyBoard();
  renderStatus();
  if (outcome === 'sunk') {
    setMessage(`Hit and sunk ${sunkShip}!`);
  } else {
    setMessage(outcome === 'hit' ? 'Hit!' : 'Miss.');
  }
});

socket.on('defenseResult', ({ x, y, outcome, sunkShip }) => {
  state.myShotsReceived[y][x] = outcome === 'miss' ? 'miss' : 'hit';
  renderMyBattleBoard();
  if (outcome === 'sunk') {
    setMessage(`Your ${sunkShip} was sunk!`, true);
  } else if (outcome === 'hit') {
    setMessage('Your ship was hit!', true);
  } else {
    setMessage('Opponent missed.');
  }
});

socket.on('turnChanged', ({ yourTurn }) => {
  state.yourTurn = yourTurn;
  renderEnemyBoard();
  renderStatus();
  if (yourTurn) {
    setMessage('Your turn. Choose a target.');
  }
});

socket.on('gameOver', ({ youWon }) => {
  state.phase = 'finished';
  state.gameOver = true;
  state.yourTurn = false;
  updateSections();
  renderStatus();
  renderEnemyBoard();
  setMessage(youWon ? 'You won! Request a new game?' : 'You lost. Request a new game?');
});

socket.on('rematchStatus', ({ votes, required }) => {
  setMessage(`Rematch votes: ${votes}/${required}`);
});

socket.on('actionError', (message) => {
  setMessage(message, true);
});

renderShipList();
renderPlacementBoard();
renderMyBattleBoard();
renderEnemyBoard();
renderStatus();
