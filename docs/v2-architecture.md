# v2 architecture review

## Current status (2026-10-16)

- Ratings, tournament formats/pairings, simuls, and their persistence are implemented; the phase notes below are historical context, not a current task list.
- WebSockets use separate game, simul-overview, and per-user endpoints. Live tournament pairings push `pairing_ready` to players over `/ws/me` after the database transaction commits.
- Tournament lists and details still refresh by polling. There is no tournament-wide WebSocket channel for standings or other shared updates; this is a possible follow-up, not a prerequisite for tournament play.
- The 20-socket per-user limit applies across all WebSocket endpoints, so a user with many open game boards can hit it.

## Native client integration

The browser client continues to use an HTTP-only session cookie for HTTP requests and WebSocket upgrades. Native clients can register or log in through `/api/native/register` and `/api/native/login`, which return an opaque `sessionToken` without setting a cookie. Send it as `Authorization: Bearer <token>` for HTTP requests and WebSocket upgrades. Native bearer sessions use the existing 30-day lifetime and can be revoked through `/api/logout`; the client is responsible for storing the token securely. CSRF and origin checks remain in place. This adds native integration support without changing the browser security model.

## Historical planning notes

The schema and game-core sections retain findings from the original phased plan. Verify them against the implementation before treating any item as an open task.

## Schema

| Finding | Needed for | Action |
|---|---|---|
| `games` has no `rated` | Phase 1 | Migration 0007 |
| `challenges` has no `rated` | Phase 1 | Migration 0007 |
| No ratings / rating history tables | Phase 1 | Migration 0007 |
| Leaderboard needs `ratings(variant, rating DESC)` + `last_game_at` | Phase 6 | Index in 0007 (cheap now) |
| `games.variant` has no CHECK | Phase 2 | OK as is |
| `games.termination` CHECK list is closed | Phase 2 (variants with their own endings) | Table rebuild like 0006 when a variant needs a new termination |
| No `games.tournament_id` | Phase 4 | Nullable column in the Phase 4 migration |
| `idx_challenges_one_per_mode (from_user, mode)` | Phase 4/8 | Fine for challenges; tournament/simul games do not use `challenges` |

## Game core

- `replay.ts`, `fen.ts`, `gameEnd.ts` hardcode chessops `Chess`. Phase 2 needs a position
  factory keyed by `game.variant` (chessops `setupPosition`) used by all three.
- `rowToGameState` derives `turn` from ply parity (white always starts). Fine for Chess960.
- `buildPgn` is standard-only (no variant header). Phase 2.
- One move submission replays the game 3x (applyMove, sanForNextMove, updateGameState).
  See `npm run bench -w server`. `sanGuard.test.ts` pins the sanForNextMove call.

## WebSocket

- `/ws/games/:id` carries updates and player move submissions for one game; spectators may watch but cannot submit moves.
- `/ws/simuls/:id` pushes simul-overview events. Each board still uses its own game socket.
- `/ws/me` is an authenticated, server-push-only connection used for per-user notifications, including live tournament `pairing_ready` events. Tournament events are queued and sent after commit.
- These are separate endpoint-specific subscriptions, not a general multiplexed channel protocol. The 20-socket limit is per user across all endpoints.
- Tournament standings and detail views are not pushed on a tournament channel: the lobby refreshes every 3 seconds, tournament details every 5 seconds, and tournament lists every 10 seconds.

## Simuls

- **Game Association:** Each accepted player receives one ordinary game, linked back through `simul_players.game_id`.
- **Completion Logic:** Automatically managed via the `simuls_complete_after_game` trigger.
- **Host & Timing:** Live simuls are host-White only, utilizing an extended first-move window defined by `simulFirstMoveWindowMs`.
- **Visibility & Joining:** Simuls are public by default. Public simuls appear in the open list and can be joined by id; private simuls cannot be joined by id.
- **Invite Codes:** Each simul has its own `invite_code`, visible only to the host, who can reset it.
- **Acceptance:** Joining by invite code or by public simul id counts as accepting.
- **Real-time Communication:** Overview updates flow through `/ws/simuls/:id`, whereas individual board play leverages the existing `/ws/games/:id` game sockets.
- **Event Sinks:** Events are rebuilt from committed rows and flushed only after the transaction commits.

## Performance

┌─────────┬───────────┬─────────┬─────────────┬─────────────┬─────────────┬─────────────┐
│ (index) │ plies     │ samples │ move p50 ms │ move p95 ms │ load p50 ms │ load p95 ms │
├─────────┼───────────┼─────────┼─────────────┼─────────────┼─────────────┼─────────────┤
│ 0       │ '1-50'    │ 1000    │ 0.49        │ 1.07        │ 0.08        │ 0.15        │
│ 1       │ '51-100'  │ 1000    │ 0.92        │ 1.48        │ 0.11        │ 0.19        │
│ 2       │ '101-200' │ 1970    │ 1.54        │ 2.22        │ 0.14        │ 0.21        │
│ 3       │ '201-300' │ 1730    │ 2.39        │ 3.33        │ 0.18        │ 0.31        │
└─────────┴───────────┴─────────┴─────────────┴─────────────┴─────────────┴─────────────┘