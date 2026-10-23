# Mobile compatibility policy

The mobile app ships its own copy of the web client, so it can be older or newer than the server it connects to. The web
site never has this problem: the server serves the bundle, so both always match. This page is the contract between the
two, what the app tells people when a server does not fit, and the rules for changing the server without breaking apps
that are already installed.

What the server needs in order to work with the app (HTTPS, WebSocket proxying, endpoints, guests) is in
`docs/mobile-server-requirements.md`. The release routine is in `docs/mobile-release-checklist.md`.

## The numbers

These three lines are checked against the code by `mobile/src/compat/healthContract.test.ts`. Change the code and this
page together, or CI fails.

- Current server API version: **1**
- Oldest app API level the server serves: **1**
- App supports server API versions: **1** to **1**

## How a server describes itself

`GET /api/health` is the only thing the app trusts to decide whether a server can be used. `{ "ok": true }` alone is
never proof of support.

| Field | Meaning |
|---|---|
| `app` | Always `"lilchess"`. Anything else is rejected as not a LilChess server |
| `version` | The server release (the root `package.json` version). Shown to people, never used to decide compatibility |
| `apiVersion` | Integer. The API contract the server offers. Raised only by a breaking change |
| `minClientApiVersion` | Integer, at most `apiVersion`. The oldest app API level the server still serves. Servers that predate it omit it, and the app then treats it as equal to `apiVersion` |
| `features` | What this server's configuration or release provides, so the UI adapts instead of failing. See below |

An app has a range: `MIN_API_VERSION` is the oldest server `apiVersion` it works with, and `MAX_API_VERSION` is the
newest one it was built against (both in `mobile/src/serverSelection.ts`). The app accepts a server when

1. `apiVersion` is at least `MIN_API_VERSION`, and
2. `minClientApiVersion` is at most `MAX_API_VERSION`.

So a newer server stays usable by older apps for as long as it keeps `minClientApiVersion` low, and an older app is only
turned away when the server says it has dropped that app's level.

### Features

| Feature | Meaning | Missing means |
|---|---|---|
| `guests` | Guest play is allowed | Required field. A server without it is rejected as an invalid response |
| `registration` | `open`, `invite` or `closed` | Required field |
| `demo` | A public demo server with a practice bot | `false` |
| `accountDeletion` | The server has `POST /api/me/delete` | `false`: the app shows a message instead of the delete button |

Unknown fields and unknown features are ignored, so a newer server can add them without breaking an older app.

## Rules for changing the server

**Additive changes never change `apiVersion`.** That covers a new endpoint, a new optional request or response field, a
new event type, and a new `features` entry.

- An older app must be able to ignore the addition. The WebSocket clients already resynchronise from the REST API when
  they receive an event they do not understand, and `shared/src/ws/eventCompat.test.ts` pins this.
- If the app needs an additive endpoint for a feature, add a flag to `features`. An older server will not report it, and
  the app treats a missing flag as unavailable. Do not probe the endpoint and interpret a 404.

**Breaking changes bump `apiVersion`.** That covers removing or renaming an endpoint, field or event, and changing what
one means.

1. Keep the old behaviour for at least one server release where that is practical, and say so in the release notes.
2. Raise `SERVER_API_VERSION` in `server/src/compat.ts`. Keep `MIN_CLIENT_API_VERSION` where it is while the old
   behaviour still works.
3. Release an app that understands the new version and raise its `MAX_API_VERSION`.
4. Only when the old behaviour is really removed, raise `MIN_CLIENT_API_VERSION`. Every installed app below that level is
   then told to update, so do this after most people have moved.
5. Update the numbers at the top of this page and the recorded responses in `mobile/src/compat/health/`.

**Never replace a documented API with a mobile-only workaround.** If the app needs something the contract does not
offer, extend the contract (additively where possible) and write it down here.

## What the app tells people

| Situation | Message (summary) | Who acts |
|---|---|---|
| No `apiVersion`, or below the app's minimum | The server is too old; ask its administrator to update LilChess, or choose another server | Server administrator |
| `minClientApiVersion` above the app's newest level | The server needs a newer app; update LilChess Mobile from the app store, or choose another server | The person |
| Not a LilChess server | The address did not identify itself as LilChess | The person |
| Malformed or incomplete response | The health response is invalid (the body is never repeated in the message) | The person |
| Optional feature missing | The feature is unavailable on this server, and what to do | Server administrator |

Errors never suggest downgrading from HTTPS to HTTP.

## Supported servers

| App | Servers it works with |
|---|---|
| 1.0.x | LilChess servers whose `/api/health` reports `app: "lilchess"`, a semantic `version`, `apiVersion` 1 (or a newer one with `minClientApiVersion` 1), and `features` with `guests` and `registration` |

- Servers older than the first mobile-compatible release, and anything that is not LilChess, are rejected at the server
  picker with an actionable message.
- Do not claim in store listings or release notes that all self-hosted servers work. Say that servers must meet the
  requirements in `docs/mobile-server-requirements.md`.
- Server releases are tagged `v<version>`, matching the root `package.json`. Record the first mobile-compatible tag
  here when it exists: _not tagged yet_.

## Features that differ in the app

| Feature | In the app |
|---|---|
| Account and game features | Same as the website, using the server's own rules |
| Guests | Only through an invite link, or "Play a demo game" on a demo server. They cannot create challenges or play rated games |
| Notifications | Email and Discord work as on the web. Browser push is for the website only; the app has none |
| Background play | A WebSocket does not stay alive in the background. The app resynchronises from the server when it returns |
| Server choice | One server at a time. Sessions are kept separately for each server |
| Account deletion | In Settings, when the server reports `accountDeletion`. Otherwise the app explains that the server does not support it |

## Automated checks

| Check | Where | What it catches |
|---|---|---|
| Health response shape | `server/src/health.test.ts` | A new top-level health field, or a range that is not coherent |
| Recorded `/api/health` responses | `mobile/src/compat/healthContract.test.ts`, `mobile/src/compat/health/*.json` | The app's rules changing for an older or newer server, and this page drifting from the code |
| Recorded WebSocket events | `shared/src/ws/eventCompat.test.ts` | A schema change that would reject what an older server sends, or crash on what a newer one adds |
| Unknown events resynchronise | `web/src/lib/ws/unknownEvents.test.ts` | The user and simul sockets silently ignoring events they do not understand |

Add a recorded response to `mobile/src/compat/health/` for each server generation you want to keep supporting, with its
expected outcome in `healthContract.test.ts`. Once the project has tagged releases, a scheduled job that runs the app's
contract tests against the previous tagged server image can be added on top.
