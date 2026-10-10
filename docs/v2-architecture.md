# v2 architecture review

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

- Hub is keyed by gameId only; only `/ws/games/:id` exists.
- `MAX_SOCKETS_PER_USER = 20` caps a simul host at 20 boards (Phase 8).
- `ClientMessage` has no `gameId` (socket is bound to one game), so multiplexing needs a protocol change.
- Tournaments (Phase 4/5) need a `tournament:<id>` channel (standings) and a `user:<id>`
  channel ("your pairing is ready"). Lobby currently polls every 3s.
- Plan: generalise hub keys to channel strings in Phase 4; add a per-user multiplexed
  socket for simuls in Phase 8. No change in Phase 0/1.

## Simuls

- **Game Association:** Each accepted player receives one ordinary game, linked back through `simul_players.game_id`.
- **Completion Logic:** Automatically managed via the `simuls_complete_after_game` trigger.
- **Host & Timing:** Live simuls are host-White only, utilizing an extended first-move window defined by `simulFirstMoveWindowMs`.
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