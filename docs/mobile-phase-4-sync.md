# Mobile Phase 4: WebSocket reliability and game synchronization

Scope: the shared web client's realtime layer plus the native glue. No server, protocol or schema changes, and the
browser build behaves as before (same-origin sockets, cookie session, retry forever, same backoff).

## Design

One reconnecting-socket core (`web/src/lib/ws/reconnectingSocket.ts`) now backs the game, simul and user sockets,
which used to be three hand-copied state machines. How a socket is obtained and how hard it retries are injected
(`web/src/lib/ws/runtime.ts`), so the browser and the native app share every reliability rule.

| Roadmap item | Where it is handled |
| --- | --- |
| Reuse `shared/` protocol types and schemas | `gameSocket`, `userSocket`, `simulSocket` still validate with `ServerMessageSchema`, `UserEventSchema`, `SimulEventSchema`. Nothing is duplicated. |
| Authenticated connections, clean disposal | `mobile/src/nativeRealtime.ts` opens ticket-authenticated sockets (a fresh single-use ticket per connection, via the Phase 3 `connectNativeWebSocket`). `close()` bumps a generation counter, unsubscribes lifecycle listeners and closes the socket. |
| No duplicate connections while connecting | Only one attempt exists at a time, including while the asynchronous ticket request is running. Foreground, online and retry are ignored while an attempt is pending. |
| Stale callbacks cannot overwrite a replacement | Every listener captures its attempt's generation and does nothing once it is stale. A socket whose `open()` promise resolves late (after dispose or a newer attempt) is closed, never attached. |
| Bounded reconnects with backoff, visible status | Native policy: 8 attempts, exponential backoff with 25% downward jitter, then status `failed`. Foreground, the network returning, or the Retry button start over. Status values: `connecting`, `open`, `closed`, `failed`, `unauthorized`, shown by `ConnectionBanner` (a pill that never moves the board, appears after 1.5 s of trouble). |
| Authoritative state after connect/reconnect | `onOpen` and foreground both call `onResyncNeeded`, which `GET /api/games/:id`. |
| Resync on event gap or foreground | Gap detection already existed (`applyGameEvent` returns `resync` when ply skips). Foreground resyncs with a live socket; a socket hidden for 20 s or more is replaced rather than trusted (the OS may have killed it silently), and its `onOpen` resyncs. User and simul sockets refetch after 15 s in the background. |
| No duplicated subscriptions or stale moves | The old socket is retired (listeners dead, closed) before a replacement opens. Events for ply <= current are ignored, and events for another game id are dropped. |
| Network loss, restarts, expired sessions, server switch | Network loss and server restarts: backoff, then `failed`; `online` reconnects at once. Expired or revoked session: a 401 on the ticket or REST request latches `nativeRealtime`, status becomes `unauthorized`, and nothing retries. Switching server: `setSocketRuntime` closes every socket opened under the previous runtime. |
| Respect background suspension | Native policy stops scheduling reconnects while hidden and reconnects on return. |

REST resyncs are coalesced (`web/src/lib/game/resyncRunner.ts`): at most one request is in flight, a second request or an
applied move event marks it dirty, its possibly-older answer is discarded, and one fresh request runs (after 3 discards
the latest answer is applied so a busy game cannot starve it). Previously a reconnect plus a foreground return could race
and an older response could overwrite a newer one.

A failed resync no longer replaces a loaded board with an error screen; the banner explains the connection instead.

Moves are not retried: `sendMove` still posts `{ply, uci}` once; on any failure it resyncs and resets the board. The
server's ply check is the idempotency guard.

## Wiring the native app (Phase 6)

`activateNativeServer(serverUrl, onSessionExpired)` in `web/src/native/activate.ts` points `api()` and every socket at the
selected server; call it after login or session restore and whenever the user picks another server.
`deactivateNativeServer()` on sign-out. Nothing calls them yet because `startNative()` still mounts only the server
selector and sign-in screens; the full game UI arrives in Phase 6.

Limits to know about:
- `nativeRequest` accepts only `[a-z0-9/_-]` paths, so `api()` calls with query strings (some list endpoints) need that
  validation extended before Phase 6 uses them.
- The default lifecycle uses `visibilitychange` and `online`. A Capacitor `App` lifecycle (needs `@capacitor/app`) can be
  supplied through `SocketRuntime.lifecycle` if the WebView proves unreliable at reporting backgrounding.
- In the browser, a rejected upgrade (401) is indistinguishable from a network error, so the web build keeps retrying
  forever as before.

## Verification

Automated: `npm run check -w web`, `npm run check -w mobile`, `npm run lint`, `npm test`. New suites: `reconnectingSocket`,
`runtime`, `resyncRunner`, `api`, `activate`, `nativeRealtime`. The existing `gameSocket.test.ts` passes unchanged.

Roadmap "Done when" needs real devices once Phase 6 wires the game UI: during a live game and a correspondence game,
(1) toggle airplane mode, (2) background the app for 5 s and for over a minute, (3) kill and reopen the app, (4) restart the
server, (5) revoke the session from another device, (6) switch servers. Each time the board, move list, clocks and turn
must match the server, with no duplicate move and the banner clearing by itself.
