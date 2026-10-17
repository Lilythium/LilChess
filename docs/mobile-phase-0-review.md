# Mobile client: Phase 0 review

Architecture and compatibility review for the LilChess Mobile client (Capacitor).

- Reviewed: branch `feature/mobile-phase-0` at `fd8460e` (2026-10-16).
- Baseline before this change: `npm test` passed (100 files, 822 tests).
- Scope: findings and decisions only. No production behaviour changes in Phase 0.

## Summary

| Roadmap item | Finding | Owner |
|---|---|---|
| Native auth, bearer HTTP | Present and tested: `/api/native/register`, `/api/native/login`, `Authorization: Bearer`, revoke via `/api/logout`. Web cookie flow is untouched. Gap: no native guest endpoint. | Phase 3 |
| WebSocket upgrade auth | Server accepts a bearer header on upgrade, but a WebView `WebSocket` cannot set `Authorization` and sends the WebView's Origin, which the server rejects. | Phase 3 (decision below) |
| API and WS client assumptions | One raw `fetch`, three `location`-based WS URL builders, two `location.origin` invite links. All are small, replaceable seams. | Phases 3, 4, 6 |
| Shared modules | `shared/` has no DOM or Node dependencies and is importable as is. Browser-specific web modules are listed below. | none |
| CSRF and Origin | Behaviour pinned by `server/src/security/nativeClient.test.ts`. No global change, no CORS. | Phase 3 (scoped only) |
| Tracked test output | `web/test-results/.last-run.json` was already untracked in `6d14a8c`. Ignore rules added in this patch. | done |
| Compatibility versions | Policy below. | Phase 2 implements |

## 1. Authentication over HTTP

What exists (`server/src/auth/routes.ts`, `server/src/auth/sessionToken.ts`):

- `/api/native/register` and `/api/native/login` return `{ ok, user, sessionToken }` and set no cookie. The web endpoints `/api/register` and `/api/login` set the cookie and never return a token (pinned in `auth/case.test.ts`).
- `sessionTokenFromCredentials` uses the bearer token when an `Authorization` header is present and never falls back to the cookie. A malformed header is a 401, not a cookie lookup.
- `requireAuth` only clears the cookie on an invalid session when no `Authorization` header was sent, so native 401s carry no `Set-Cookie`.
- `/api/logout` revokes the session for either credential type.
- Native sessions last 30 days, the same as web sessions.

Gaps:

- `/api/guest` is cookie-only and returns no token. A native guest flow needs its own endpoint that returns a bearer token (Phase 3).
- Rate limits are per IP (login 10/min, registration 10/hour). Mobile users behind carrier NAT can share an IP. Watch this during device testing.

Rule kept: the web client stays on cookies. Bearer auth is additive.

## 2. WebSocket authentication

Facts:

- `authenticateUpgrade` (`server/src/ws/upgradeAuth.ts`) accepts a bearer header or the cookie. A bearer upgrade with no Origin works today (tested in `ws/spectate.test.ts`).
- A browser or WebView `WebSocket` cannot set `Authorization`. It does send an `Origin`: the WebView's own, such as `capacitor://localhost`. `isAllowedOrigin` rejects that with 403 whether or not `BASE_URL` is set.
- Tokens in the query string are not accepted (pinned by test). Keep it that way.
- Limits that matter for reconnect behaviour: 120 upgrades/min/IP and 20 sockets/user across all endpoints. Revisit in Phase 4.

Options for Phase 3:

| | A. Short-lived single-use ticket | B. Native WebSocket plugin |
|---|---|---|
| Transport | Same JS `WebSocket` on web, iOS and Android | Plugin per platform |
| Server change | New authenticated endpoint that issues tickets, plus a scoped Origin rule for ticketed upgrades | None: no Origin, bearer header works |
| Cost | Server work and careful tests | Extra native dependency to keep maintained, platform differences |

Phase 0 recommendation: A, with B as the fallback if a device spike shows A is unworkable. Sketch for A, to be refined in Phase 3:

- `POST /api/native/ws-ticket` (bearer-authenticated) returns an opaque ticket that lives about 30 seconds, is bound to the user, and is deleted on first use.
- The client presents the ticket outside the URL, for example as a `Sec-WebSocket-Protocol` value (the server must echo the selected protocol or browsers close the socket).
- Only an upgrade that presents a valid ticket may come from a Capacitor origin, and only from an explicit allow-list built from the app's pinned scheme and hostname. All other upgrades keep the existing Origin rule.
- Tickets and bearer tokens are never logged.

## 3. Web client assumptions

| Location | Assumption | Seam needed |
|---|---|---|
| `web/src/lib/api.ts` | Relative path, `credentials: "same-origin"`, no auth header. It is the only raw `fetch`, and 26 files import it. | Injectable base URL, header provider and transport. Web default behaviour unchanged. |
| `web/src/lib/ws/gameSocket.ts`, `userSocket.ts`, `simulSocket.ts` | URL from `location.protocol` and `location.host`; auth by cookie; resync on `document.visibilitychange`. Three near-duplicate reconnect loops. | One `wsUrl(path)` and one connect factory. Background and resume handling through the Capacitor App plugin. |
| `web/src/routes/Lobby.svelte:48`, `web/src/routes/SimulDetail.svelte:65` | Invite links built from `location.origin`. In the app that is the WebView origin. | Build from the configured server URL. |
| `web/src/lib/router.svelte.ts` | Hash router (`#/c/:id`, `#/s/:code`). Works in a WebView. | Deep links must map to hash routes (Phase 7). |
| `localStorage` / `sessionStorage` (simul auto-advance, analysis enabled and cache, local game, new-game sound key) | Fine for non-secret preferences. | Never store tokens here. Namespace by server where relevant. |
| `web/src/lib/analysis/cache.ts`, `loadedGame.ts` | Cache key is `game:<id>:<plies>`, not namespaced by server. | Namespace by server before multi-server switching ships. |
| `navigator.clipboard`, `navigator.share` (Lobby, SimulDetail, Admin) | Availability in a WebView varies. Share is already feature-detected. | Capacitor Clipboard and Share as fallback. |
| `web/src/lib/analysis/workerTransport.ts` | Web Worker loading `/stockfish/*` (copied by `web/scripts/copy-stockfish.mjs`). | Decide in Phase 1 whether to bundle the engine in the app. |
| `web/src/lib/audio/sounds.ts` | Absolute `/sounds/*.wav` paths. Fine if assets sit at the bundle root. Autoplay rules differ by platform. | Phase 6. |
| `web/src/lib/wakeLock.ts` | Feature-detected already. | none |

## 4. Shared and web module portability

- `shared/` imports only `chessops` and `zod` (and `vitest` in tests). It uses no Node or DOM globals, so it can be imported directly. It also holds the WS and event schemas (`ServerMessageSchema`, `UserEventSchema`, `SimulEventSchema`) that the mobile client must reuse.
- `web/src/lib/**/*.svelte.ts` (`auth`, `router`, `gameStore`, `simulStore`, `viewport`, `analysisSession`) use Svelte 5 runes and need the Svelte compiler.
- Other `web/src/lib` files that touch browser globals: `analysis/workerTransport.ts`, `wakeLock.ts`, and the three `ws/*.ts` clients.
- The mobile app reuses the web build output through Capacitor (`webDir`), so module sharing is not the problem. The seams above are runtime ones. Recommendation: select native behaviour with a build-time flag (for example `import.meta.env.VITE_TARGET`) plus dynamic imports, so Capacitor code never lands in the web bundle.

## 5. CSRF and Origin

| Client | Credential | Origin sent | State-changing HTTP | WS upgrade |
|---|---|---|---|---|
| Web browser | cookie | same origin | allowed | allowed |
| Native HTTP with bearer | bearer | none (verify per platform) | allowed | n/a |
| Capacitor WebView `fetch` / XHR | bearer | `capacitor://localhost`, `https://localhost`, ... | 403, and no CORS headers | n/a |
| Capacitor WebView `WebSocket` | cannot set header | WebView origin | n/a | 403 |
| Native WS plugin with bearer header | bearer | none | n/a | allowed |

Decisions:

1. Mobile HTTP uses native HTTP, never WebView `fetch`, so no Origin or CORS changes are needed.
2. The server does not add CORS.
3. Capacitor origins are not added to a global allow-list. `BASE_URL` pinning and the host check stay as they are.
4. If WebView origins are needed for WebSockets, they are allowed only for upgrades that present a valid ticket (section 2), with the matching test updated in the same change.
5. In Phase 3, verify on real Android and iOS devices that native HTTP sends neither `Origin` nor `Sec-Fetch-Site`. If either platform does, handle it with a scoped rule, not a global one.

A request with no Origin is already allowed today, and bearer headers are not ambient credentials, so none of this weakens the cookie flow.

`server/src/security/nativeClient.test.ts` pins all of the above. Its two `it.todo` entries mark the Phase 3 gaps.

## 6. Test output hygiene

`web/test-results/.last-run.json` was removed from tracking in `6d14a8c`. This patch adds `test-results/`, `playwright-report/`, `blob-report/` and `playwright/.cache/` to the root `.gitignore` so it cannot come back. Check with `git ls-files | grep test-results` (expect no output).

## 7. Compatibility policy (first mobile release)

Why this matters: the web bundle is served by the server, so web and server always match. The mobile app ships its own copy of the bundle, so it can be older or newer than the server it talks to.

Proposed policy:

- Phase 2 extends `GET /api/health` to `{ ok, app: "lilchess", version, apiVersion, features }`.
- `apiVersion` is an integer. Version 1 is the contract on this branch plus the additive mobile changes through Phase 3 (health fields, native guest endpoint, WS ticket).
- Additive changes (new endpoints, optional fields, new event types) do not bump it. Removing or renaming something, or changing its meaning, does, and is noted here.
- The app defines `MIN_API_VERSION = 1` and `MAX_API_VERSION = 1`. A server without `apiVersion` (any pre-Phase-2 server, or a non-LilChess host) is reported as unsupported. Below the minimum: ask the server admin to update. Above the maximum: update the app.
- `features` reports what server configuration controls so the UI adapts instead of failing: guests (`ALLOW_GUESTS`) and registration mode (`open`, `invite`, `closed`).
- Unknown or unparseable game events already trigger a REST resync in `gameSocket.ts`. Keep that degrade path. The user and simul sockets currently ignore them.
- There are no git tags and package versions are placeholders (root `1.0.0`, others `0.0.0`). Phase 2 must choose the source of `version` (suggest the root `package.json`) and tagging should start with the first mobile-compatible server release.
- Where practical, a breaking change keeps the old behaviour for one release.

The contract the app depends on: `/api/health`, `/api/native/register`, `/api/native/login`, `/api/logout`, `/api/me`, the challenge, game, tournament and simul REST endpoints, and `/ws/games/:id`, `/ws/me`, `/ws/simuls/:id`.

## 8. Hand-offs to later phases

Phase 1 (Docker and CI):

- `Dockerfile` copies each workspace `package.json` before `npm ci`. A new `mobile` workspace needs its `COPY mobile/package.json ./mobile/` line.
- There is no `.dockerignore`, so `COPY . .` sends host `node_modules` and would send `mobile/android`, `mobile/ios` and their build output. Add one.
- `npm prune --omit=dev` keeps the `dependencies` of every workspace, and the production stage copies all of `/app/node_modules`. Mobile packages must be `devDependencies`, or the build must scope installs with `--workspace`, so they do not reach the image.
- Add mobile type-check and build steps to `.github/workflows/ci.yml`.
- Pin `server.iosScheme`, `server.androidScheme` and `server.hostname` explicitly in the Capacitor config. Documented defaults have differed between Capacitor versions, and the server's Origin handling depends on them.

Phase 2: health fields and server selection (section 7). Namespace the analysis cache by server.

Phase 3: native guest endpoint, WebSocket ticket, secure token storage keyed by server, device verification of Origin headers.

Phase 4: shared WS connect factory and App-plugin resume handling. Check reconnect behaviour against the upgrade and per-user socket limits.

Phase 7: deep links mapped to `#/c/:id` and `#/s/:code`.

## 9. To verify on real devices

- Headers sent by native HTTP on Android and iOS (`Origin`, `Sec-Fetch-Site`).
- The actual WebView origin for the pinned Capacitor scheme config.
- `navigator.clipboard` and `navigator.share` inside each WebView.
- Audio autoplay and `visibilitychange` against the App plugin's state events.
