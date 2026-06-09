# Lodíčky (Multiplayer Battleship)

A two-player online Battleship game built with HTML, CSS, vanilla JavaScript, Node.js, Express, and Socket.IO.

## Features

- Two-player online gameplay
- Create/join room lobby with 6-character room code
- 10x10 board per player
- Pre-game ship placement with rotation (horizontal/vertical)
- Standard ships:
  - Carrier (5)
  - Battleship (4)
  - Cruiser (3)
  - Submarine (3)
  - Destroyer (2)
- Turn-based attacks with real-time updates
- Hit / miss / sunk states
- Turn enforcement (can’t shoot out of turn)
- Game-over detection and winner display
- Rematch flow (both players confirm)
- Room/player connection indicators and basic invalid action/disconnect handling
- Responsive modern UI

## Project structure

- `client/` – frontend (HTML, CSS, JS)
- `server/` – backend (Node.js + Express + Socket.IO)

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the server:

   ```bash
   npm start
   ```

3. Open your browser at:

   ```
   http://localhost:3000
   ```

4. Open the app in two browser tabs/windows:
   - Player 1 creates a room
   - Player 2 joins with the room code
   - Both place ships and start battle

## Notes

- This project uses in-memory room/game state, so active games reset when the server restarts.
