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

## Performance

Paste `npm run bench -w server` output here and the decision taken.