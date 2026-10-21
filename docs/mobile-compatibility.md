# Mobile compatibility and supported servers

The mobile app ships its own copy of the web client, so it can be older or newer than the server it connects to. This page
is what the app supports and what it tells people when a server does not fit. The mechanics are in
`docs/mobile-phase-0-review.md` section 7.

## Supported servers

| App | Supported servers |
|---|---|
| 1.0.x | LilChess servers whose `GET /api/health` reports `app: "lilchess"`, `apiVersion: 1`, a semantic `version`, and `features` with `guests` and `registration` |

- The server release that first reports this is the first one the app can use. Servers older than that, and anything that
  is not LilChess, are rejected at the server picker with an actionable message ("update the server", or "update the app"
  for a server newer than the app understands).
- Additive changes (new endpoints, optional fields such as `features.demo`) do not change `apiVersion`.
- A server's `version` alone is never treated as proof of support; the app checks `apiVersion`.
- The root `package.json` `version` is the server version shown in health. When the first mobile-compatible server is
  released, tag it and record the tag here.

Servers that omit `features.demo` are simply not demo servers.

## Server requirements for mobile

- HTTPS in production. Android release builds cannot connect over plain HTTP. HTTP is for explicitly entered trusted local
  networks and development builds.
- A reverse proxy that forwards WebSocket upgrades for `/ws/*`, and `BASE_URL` set to the public origin.
- The native endpoints: `/api/native/login`, `/api/native/register`, `/api/native/guest`, `/api/native/ws-ticket`,
  `/api/logout`, `/api/me`.
- For app links from the web: `MOBILE_ANDROID_CERT_SHA256` and `MOBILE_IOS_APP_ID` (see `.env.example`).
- Guest play (`ALLOW_GUESTS=true`, registration not closed) if invite links should be playable without an account.

## Features that differ in the app

| Feature | In the app |
|---|---|
| Account and game features | Same as the website, using the server's own rules |
| Guests | Only via an invite link, or "Play a demo game" on a demo server. They cannot create challenges or play rated games |
| Notifications | Email and Discord notifications work as on the web. There are no push notifications |
| Background play | A WebSocket does not stay alive in the background. The app resynchronizes from the server when it returns |
| Server choice | One server at a time; sessions are kept separately per server |
| Account deletion | Not available yet (see `docs/mobile-privacy.md`) |

Do not state in store listings or release notes that "all self-hosted servers" work: say that servers must meet the
requirements above.
