# LilChess

Self-hosted, lightweight chess server with accounts, live and correspondence play, and per-opponent game history.

## Features

* User accounts and authentication
* Live multiplayer chess
* Correspondence games
* Open challenges
* Time controls and chess clocks
* Player profiles and statistics
* Per-opponent game history
* WebSocket-based live games
* SQLite database
* Automatic database backups
* Configurable registration
* Rate limiting
* Health check endpoint
* Docker support

## Tech Stack

* **Frontend:** Svelte 5, TypeScript, Vite
* **Backend:** Node.js, Fastify, WebSockets
* **Chess:** chessops, Chessground
* **Database:** SQLite
* **Validation:** Zod
* **Testing:** Vitest
* **Deployment:** Docker

## Requirements

### Docker

* Docker Engine 22+ recommended

### Local Development

* Node.js 22+
* npm

## Installation

### Docker

Clone the repository and build the image:

```bash
git clone [https://github.com/Lilythium/LilChess.git](https://github.com/Lilythium/LilChess.git)
cd LilChess
docker build -t lilchess .
