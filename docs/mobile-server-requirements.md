# Server requirements for LilChess Mobile

What a self-hosted server needs so the mobile app can use it. The compatibility rules (which versions work) are in
`docs/mobile-compatibility.md`.

## Checklist

- [ ] Reachable over HTTPS with a certificate the phone trusts (not self-signed)
- [ ] `BASE_URL` set to the public origin, for example `https://chess.example.com`
- [ ] The reverse proxy forwards WebSocket upgrades for `/ws/*`
- [ ] `TRUST_PROXY` set to the number of proxy hops, so per-IP rate limits see real addresses
- [ ] `GET /api/health` returns `app`, `version`, `apiVersion` and `features`
- [ ] Guest play enabled (`ALLOW_GUESTS=true`, registration not `closed`) if invite links should work without an account

## HTTPS

Android release builds refuse plain HTTP. iOS enforces its own transport rules. HTTP only works for a server the person
types in explicitly with `http://`, on a trusted local network, in builds that allow it. The app never retries over HTTP
when HTTPS fails. Public servers should use HTTPS only.

## Reverse proxy and WebSockets

Live games, the user socket and simul pages use WebSockets at `/ws/games/:id`, `/ws/me` and `/ws/simuls/:id`. The server
sends a ping every 30 seconds, so proxy idle timeouts above about a minute are enough.

Caddy forwards WebSockets without extra settings:

```caddyfile
chess.example.com {
  reverse_proxy localhost:3000
}
```

nginx needs the upgrade headers:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 120s;
}
```

Do not strip or rewrite the `Sec-WebSocket-Protocol` header. The app uses it to present a one-time ticket.

Limits worth knowing when many people share one network (a carrier gateway, a club Wi-Fi):

| Limit | Value |
|---|---|
| WebSocket upgrades per IP | 120 per minute |
| Open sockets per user | 20 |
| Native login | 10 per minute per IP |
| Native registration | 10 per hour per IP |
| Native guest creation | 10 per hour per IP |

## Endpoints the app uses

The app calls the same REST API as the website, plus these native endpoints. They authenticate with an
`Authorization: Bearer` header and never set cookies.

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Identity and compatibility check before a server is saved |
| `POST /api/native/login`, `POST /api/native/register` | Sign in or create an account, returns a session token |
| `POST /api/native/guest` | Guest session for a specific open challenge |
| `POST /api/native/ws-ticket` | A single-use ticket, valid for 30 seconds, for opening a WebSocket |
| `GET /api/me` | Restore a saved session |
| `POST /api/logout` | Revoke the current session |

A proxy that filters paths must allow all of them.

## Guests

- A guest session is created only from an invite link to an open (not player-targeted) challenge, or on a demo server.
- Guests cannot create challenges or play rated games.
- Guest play is refused when `ALLOW_GUESTS=false` or `REGISTRATION=closed`.

## Links that open the app

Optional. Set these so `https://` invite links open the app instead of the browser. When empty, both files return 404.

| Variable | Value |
|---|---|
| `MOBILE_ANDROID_CERT_SHA256` | SHA-256 fingerprint(s) of the app signing certificate, comma-separated. Include the Play App Signing fingerprint as well as the upload and debug ones |
| `MOBILE_IOS_APP_ID` | `<TeamID>.<bundle id>`, comma-separated |
| `MOBILE_ANDROID_PACKAGE` | Only if you build and sign the app under your own package id |

The server serves `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association` from these. Check them
with `curl -i https://your.server/.well-known/assetlinks.json`: expect `200` and JSON, never an HTML page.

## Verify a server

```bash
curl -s https://chess.example.com/api/health
```

Expect something like:

```json
{
  "ok": true,
  "app": "lilchess",
  "version": "1.0.0",
  "apiVersion": 1,
  "minClientApiVersion": 1,
  "features": { "guests": true, "registration": "open", "demo": false, "accountDeletion": true }
}
```

A server whose response has no `apiVersion` is too old for the app.

Then check the WebSocket path from outside your network. Without credentials, an upgrade request to `/ws/me` should
be answered `401 Unauthorized` by LilChess itself. `404`, `502` or `400` means the proxy is not forwarding upgrades.

```bash
curl -i -N https://chess.example.com/ws/me \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=="
```
