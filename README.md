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
```

Create a data directory and start the server:

```bash
mkdir data
docker run -d \
  --name lilchess \
  --restart unless-stopped \
  -p 3000:3000 \
  -v "$(pwd)/data:/data" \
  lilchess
```

LilChess will be available at `http://localhost:3000`.

The database and backups are stored in the mounted `data` directory.

### Windows PowerShell

```powershell
git clone [https://github.com/Lilythium/LilChess.git](https://github.com/Lilythium/LilChess.git)
cd LilChess
docker build -t lilchess .
mkdir data
docker run -d --name lilchess --restart unless-stopped -p 3000:3000 -v "${PWD}/data:/data" lilchess
```

## Local Development

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

The development setup starts both the Fastify server and Svelte frontend.

### Other Commands

```bash
npm run build    # Build all workspaces
npm test         # Run tests
npm run lint     # Run ESLint
```

## Configuration

LilChess can be configured with environment variables.

| Variable          | Default             | Description                                   |
| ----------------- | ------------------- | --------------------------------------------- |
| `PORT`            | `3000`              | Server port                                   |
| `HOST`            | `0.0.0.0`           | Server host                                   |
| `DATA_DIR`        | `./data`            | Database/data directory                       |
| `REGISTRATION`    | `open`              | `open`, `invite`, or `closed`                 |
| `INVITE_CODE`     | —                   | Required when registration is set to `invite` |
| `BASE_URL`        | —                   | Public HTTP(S) URL                            |
| `TRUST_PROXY`     | —                   | Configure proxy trust                         |
| `LOG_LEVEL`       | `info`              | Logging level                                 |
| `BACKUP_DIR`      | `$DATA_DIR/backups` | Backup location                               |
| `BACKUP_KEEP`     | `7`                 | Number of backups to retain                   |
| `BACKUP_HOUR_UTC` | `3`                 | Daily backup hour in UTC                      |
| `LEADERBOARD_MIN_GAMES` | `5`           | Minimum rated games required for leaderboard eligibility |
| `LEADERBOARD_INACTIVE_DAYS` | `30`      | Hide inactive players from the rating leaderboard after this many days; `0` disables hiding |
| `WEBHOOK_URL`     | —                   | Optional notification webhook                 |
| `WEBHOOK_KIND`    | —                   | Webhook type, such as `ntfy` or `discord`     |
| `ALLOW_GUESTS`    | `true`              | Let invite-link visitors play as guests       |
| `SMTP_HOST`       | —                   | SMTP server; enables email (needs `SMTP_FROM` and `BASE_URL`) |
| `SMTP_PORT`       | `587`               | SMTP port                                     |
| `SMTP_SECURE`     | `false`             | `true` for implicit TLS (port 465)            |
| `SMTP_USER`       | —                   | SMTP login (set with `SMTP_PASS`)             |
| `SMTP_PASS`       | —                   | SMTP password                                 |
| `SMTP_FROM`       | —                   | From address, e.g. `noreply@chess.example.com`|

See `.env.example` for the available configuration options.

## Registration

Registration can be configured with:

* `open` — Anyone can register
* `invite` — Registration requires an invite code
* `closed` — New registrations are disabled

Example:

```env
REGISTRATION=invite
INVITE_CODE=your-secret-code
```

## Email

Email is optional. Without `SMTP_HOST` the server never sends anything. With it, users can add an
email address in Settings (it isn't verified) to get notifications for challenges, their turn in
correspondence games, and finished correspondence games, and to reset a forgotten password.
`BASE_URL` must be set so links in emails point at your server.

## Health Check

The server provides a health endpoint:

```text
/api/health
```

Docker also uses this endpoint for its container health check.

## Data & Backups

LilChess stores its SQLite database and other persistent data inside `DATA_DIR`.

When running with Docker, `/data` should be mounted to a persistent host directory:

```bash
-v "$(pwd)/data:/data"
```

Automatic backups are stored in:

```text
/data/backups
```

By default, the server keeps the last 7 backups.

## Updating

Pull the latest changes, rebuild the image, and recreate the container:

```bash
git pull
docker build -t lilchess .
docker stop lilchess
docker rm lilchess
docker run -d \
  --name lilchess \
  --restart unless-stopped \
  -p 3000:3000 \
  -v "$(pwd)/data:/data" \
  lilchess
```

Your database remains intact because it is stored in the mounted `data` directory.

## Reverse Proxy

For public deployments, place LilChess behind a reverse proxy such as nginx or Caddy and configure `BASE_URL` to match the public address.

Example:

```env
BASE_URL=[https://chess.example.com](https://chess.example.com)
```

The reverse proxy must support WebSocket connections for live games.

### Restoring a backup

Stop the container, replace the database with a backup, and start it again:

```bash
docker stop lilchess
cp data/backups/lilchess-YYYYMMDD-HHMMSS.db data/lilchess.db
rm -f data/lilchess.db-wal data/lilchess.db-shm
docker start lilchess
```

To check a backup before restoring it:

```bash
docker exec lilchess node server/dist/scripts/check-db.js /data/backups/lilchess-YYYYMMDD-HHMMSS.db --deep
```

## Project Structure

```text
LilChess/
├── server/       # Fastify backend
├── shared/       # Shared types and chess logic
├── web/          # Svelte frontend
├── Dockerfile
├── package.json
└── .env.example
```

## Development

Build the project:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Run linting:

```bash
npm run lint
```

## Third-Party Assets

### Sound Effects

LilChess uses sound effects from the Chess Analyzer Pro project.

**Author**
The sound effects were synthesized from scratch for Chess Analyzer Pro by its project author.

**Source**
The original sound effects are available in the following repository:
https://github.com/imutkarsht/Chess_analyzer
Original directory:
https://github.com/imutkarsht/Chess_analyzer/tree/master/assets/sounds

**License**
The sound effects are dedicated to the public domain under the CC0 1.0 Universal license.
License information:
https://creativecommons.org/publicdomain/zero/1.0/

The sound effects included in this directory are third-party assets. LilChess is not the original author.

Additional attribution information is available in [`web/public/sounds/ATTRIBUTION.md`](web/public/sounds/ATTRIBUTION.md).

## Contributing

Issues and pull requests are welcome.

For larger changes, please open an issue first to discuss the proposed change.

## License

LilChess is licensed under the **GNU General Public License v3.0**.
