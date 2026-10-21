# Mobile demo server (Phase 8)

A public LilChess server that app-store reviewers and first-time users can try without deploying anything or being
given credentials. It is a normal LilChess server with `DEMO_MODE=true`.

## What demo mode does

| | |
|---|---|
| Practice bot | A built-in account, `demo_bot`, with no usable password. It plays checkmate when it sees it, captures about half the time, and otherwise plays a random legal move. It declines draw and takeback offers. It is a practice opponent, not an engine. |
| Instant guest game | `POST /api/native/demo` creates a guest, a bearer session and a 10 minute casual game against the bot in one call. No account, no invite link, no credentials. The app shows it as "Play a demo game". |
| Advertised in health | `GET /api/health` reports `features.demo: true`. Older servers omit it, which the app reads as false. This is an additive field, so `apiVersion` stays 1. |
| Cleanup | Hourly, guests and their bot games older than `DEMO_RETENTION_HOURS` (default 24) are deleted, with their sessions and challenges. The demo session lasts exactly that long. |
| Limits | The start endpoint is rate limited (20 per hour per IP) and refuses new games at 100 running bot games or 5000 guest accounts (HTTP 503, "The demo is busy"). |

Demo guests are ordinary guests: they cannot create challenges, play rated games, join simuls or tournaments, or receive
notifications. Nothing in demo mode relaxes authentication, CSRF or Origin checks.

What cleanup never touches: registered accounts, games between real users, ratings, administrators. A guest who also
played a real user keeps that game and their account.

## Deploying it

Run the demo as **its own instance with its own data volume**. Do not turn `DEMO_MODE` on for a server that holds real
players, and do not point it at a copy of production data.

```env
DEMO_MODE=true
DEMO_RETENTION_HOURS=24
ALLOW_GUESTS=true
BASE_URL=https://demo.example.com
TRUST_PROXY=1
# Registration: "invite" keeps strangers from creating permanent accounts on the demo.
# Reviewers do not need one. Demo guests are not registered accounts.
REGISTRATION=invite
INVITE_CODE=<long random value you keep private>
# No ADMIN_USERNAME / ADMIN_PASSWORD, no SMTP_*, no WEBHOOK_URL, no DISCORD_WEBHOOK_URL.
LOG_LEVEL=info
```

- Serve it over HTTPS at a stable address behind a reverse proxy that forwards WebSocket upgrades (see the README's
  Reverse Proxy section). The mobile app refuses to treat a plain-HTTP address as the built-in demo.
- Leave out administrator and email settings: there is then no admin account to expose and nothing that can send mail.
- The startup log warns if `BASE_URL` is not https. `demo_bot` is created at startup. If a real account already uses that
  name, the server refuses to start rather than adopt it.
- Keep backups on if you like (`BACKUP_KEEP`), but know they will contain guest data until it ages out.

## Resetting

Automatic: the hourly sweep. Immediately:

```bash
docker compose exec -e DEMO_MODE=true lilchess node server/dist/scripts/reset-demo.js
```

From a source checkout: `DEMO_MODE=true npm run demo:reset -w server`. The script refuses to run unless
`DEMO_MODE=true`, so it cannot wipe guests on a normal server by mistake. It deletes every demo game and every guest
without other games, and prints the counts.

## Pointing the app at it

The server picker is pre-filled with the demo address when a build is made with:

```bash
cp web/.env.native.example web/.env.native   # git-ignored; set VITE_LILCHESS_DEMO_URL=https://demo.example.com
npm run sync -w mobile
```

Vite reads `.env.native` for the native build only. With it set, a first launch shows the demo address in the field and,
once any other address is entered, a "Use the demo server" button. People can always enter their own server. Without the
variable there is no demo shortcut. A non-https value is ignored.

## Before every store submission

1. Start from a clean slate (`demo:reset`) and confirm `GET https://<demo>/api/health` shows `features.demo: true`.
2. On a physical Android device and a physical iPhone with the release candidate: fresh install, connect to the demo,
   tap **Play a demo game**, play to a finish (checkmate, or resign), reopen the app and review the finished game.
3. In the same build, tap **Change server**, enter a second compatible server, and sign in there.
4. Confirm no administrator account exists on the demo and nothing from production is reachable from it.
5. Put the demo address and the steps above in the review notes (`docs/mobile-store-listing.md`).

Steps 2 and 3 on real devices are the "done when" for Phase 8; they have not been run by the automated tests.
