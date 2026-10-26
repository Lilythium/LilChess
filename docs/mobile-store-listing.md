# Store listing and review instructions (draft)

Text and checklists for the Apple App Store, Google Play and F-Droid listings. Nothing here promises approval: review outcomes and
requirements change, so check the current guidelines when you submit.

## F-Droid

F-Droid publishes the text and images that are committed in the repository, from the tagged commit. The files are the
source of truth for that listing; this document is the source for the stores that need pasted text.

| Listing field | File (`fastlane/metadata/android/en-US/`) | Limit |
|---|---|---|
| Name | `title.txt` | 30 characters |
| Summary | `short_description.txt` | 80 characters |
| Description | `full_description.txt` | 4000 characters, only the tags `b big blockquote br cite em i li ol small strike strong sub sup tt u ul` |
| What's new | `changelogs/<versionCode>.txt` | 500 bytes, file named after `buildNumber`, no padding |
| Icon | `images/icon.png` | 512 x 512 PNG |
| Screenshots | `images/phoneScreenshots/1.png`, `2.png`, ... | PNG or JPEG; shown in file-name order |

Rules the checker enforces (`node mobile/scripts/check-fastlane.mjs`, part of `npm test`; `--release` is run by the tag
workflow): limits above; the description says the app needs self-hosted servers, offers the demo, has no analytics, refuses
plain HTTP and links to `docs/mobile-privacy.md`; it does not promise tournaments on the demo and does not name other chess
services. A tag is refused while the description still holds `REPLACE_WITH_DEMO_ADDRESS` or fewer than two screenshots exist.

Before the first tag:

1. Put the real https demo address into `full_description.txt` (same address as `VITE_LILCHESS_DEMO_URL`).
2. Capture the screenshots listed below on the demo server, and save them as `images/phoneScreenshots/1.png` and so on. They
   must show only your own UI and demo data: no other product's logo or name, nothing that suggests an official service.
3. Each release adds `changelogs/<new buildNumber>.txt`. Keep the description in step with `docs/mobile-compatibility.md`.

Anti-features: none declared. The app contains no ads, tracking or non-free dependencies as far as the repository shows,
and it depends on LilChess servers, which are free software (GPL-3.0), not on a non-free network service. Re-check the
anti-feature list at https://f-droid.org/docs/Anti-Features/ when submitting, and declare honestly anything that has changed.

## Short description (Google Play, 80 characters)

Play chess on any LilChess server, or try the free demo.

## Full description

LilChess Mobile is the app for LilChess, the lightweight self-hosted chess server.

- Connect to any compatible LilChess server, or try the built-in demo with no account.
- Live games and correspondence games.
- Open challenges and invite links that open straight in the app.
- Standard chess, Chess960, Crazyhouse, Three-check and Antichess.
- Ratings, profiles, game history, PGN export and on-device analysis with Stockfish.
- Tournaments and simuls.
- Your server, your data. Passwords are never stored on the device and each server keeps its own sign-in.

LilChess Mobile needs a LilChess server. Try the demo server in the app, or run your own: see the project page. Servers
must meet the requirements on the project page to work with the app.

Keep this list in step with `docs/mobile-compatibility.md`, and drop any line that a build does not deliver.

## Screenshots to capture

On the release candidate, on at least a small phone, a large phone, and one tablet if the build supports tablets:

1. Server picker with the demo address filled in.
2. The demo sign-in screen ("Play a demo game").
3. A game in progress (board, both clocks, move list collapsed).
4. Lobby with open challenges.
5. A finished game with its move history.
6. Profile or rating history.
7. Landscape game screen, if landscape is supported.

Use the demo server and demo guests only: no real usernames, emails or production data in any image.

## Review notes (paste into App Store Connect / Play Console)

> LilChess Mobile connects to a LilChess chess server that the user chooses. No account or login is required to review it.
>
> 1. Open the app. The server field is pre-filled with our demo server, https://[demo address]. Tap "Test and select server".
> 2. Tap "Play a demo game". You are signed in automatically as a temporary guest and a 10 minute game against a practice bot starts.
> 3. Play the game to the end (or tap Resign). The bot answers within a couple of seconds. Reopen the app afterwards and open the finished game from your game history.
> 4. To check connecting to another server, sign out, tap "Change server" on the sign-in screen and enter any other compatible LilChess server. We can provide one on request: [contact].
>
> Demo guests cannot create challenges, play rated games or receive notifications. Demo data is deleted automatically after 24 hours. The app contains no ads, analytics or in-app purchases.

Delete the sentence about in-app purchases, ads or analytics if that ever stops being true. Add the account-deletion
location here once it exists (see `docs/mobile-privacy.md`).

## Per-release checklist

- [ ] Edit `mobile/version.json` (raise `buildNumber`), run `npm run version:sync -w mobile`, commit.
- [ ] `npm test`, `npm run check -w web`, `npm run check -w mobile` pass; CI is green, including the Android release build.
- [ ] Release build uses `web/.env.native` with the https demo address (`docs/mobile-demo-server.md`).
- [ ] Android: signed with the upload key via `android/keystore.properties` (never committed); app links host set if used.
- [ ] iOS: archive with the distribution profile on a Mac; check the privacy report.
- [ ] Demo server reset and verified on physical devices (`docs/mobile-demo-server.md`, "Before every store submission").
- [ ] Privacy policy URL live and matching `docs/mobile-privacy.md`; store privacy forms answered from it.
- [ ] Listing text matches what the build does; compatibility statement matches `docs/mobile-compatibility.md`.
