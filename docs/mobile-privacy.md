# LilChess Mobile: privacy disclosure (draft)

Source material for the store privacy forms (Apple "App Privacy", Google Play "Data safety"), for the privacy policy
page the stores require, and for the F-Droid listing, which links straight to this file
(`fastlane/metadata/android/en-US/full_description.txt`). F-Droid has no privacy form: what this page says is what users
see, so the listing text must never say less than it does. It describes what the code in this repository does today. **It is not legal advice**: have the
final policy reviewed, fill in the `[bracketed]` items, and re-check it whenever the app or server changes.

## Who holds what

LilChess Mobile is a client for a LilChess server the person chooses. Two different parties can be involved:

- **The app (this project)** keeps a little data on the device and sends nothing to the developer.
- **The server operator** receives and stores account and game data. For the built-in demo server that is the app's
  developer. For any other server it is whoever runs that server, who sets their own retention and policy. The app cannot
  see or promise anything about those.

## On the device (the app)

| Data | Where | Why |
|---|---|---|
| Selected server address (origin only, no credentials, query or path) | App local storage | Reconnect to the same server |
| Session token, one per server | iOS Keychain / Android Keystore (secure storage plugin). Never in preferences, URLs, WebSocket query strings or logs | Stay signed in |
| App preferences (sound, board settings and similar) | App local storage | Remember settings |

- No analytics, advertising, attribution or crash-reporting SDK is included. (There is no such dependency in the
  workspace; re-check after every dependency change.)
- No device identifiers (advertising ID, device ID) are read or sent by the app's own code.
- The clipboard is only written to, when the person taps copy on an invite link. The app does not read it.
- Signing out deletes that server's session token from the device and asks the server to revoke the session. If the
  server cannot be reached, the token is still deleted locally and the app says revocation was not confirmed.
- A fresh install clears any session tokens left in secure storage by a previous install (iOS Keychain survives uninstall).

## On the server (what the app sends to it)

Collected only if the person uses the matching feature:

| Data | When | Notes |
|---|---|---|
| Username and password | Register / sign in | Password is stored as a salted scrypt hash, never in plain text |
| Guest name (random, `guest_xxxxxx`) | Guest or demo play | No password, no email |
| Email address | Only if added in Settings, for email notifications | Optional, unverified |
| Discord user ID | Only if added in Settings, for Discord mentions | Optional, unverified |
| Games, moves, clocks, game history, ratings, profile statistics | Playing | Game history is visible to other players on that server as the server shows it |
| IP address, request method and URL | Every request, in server logs | Headers, cookies, bodies and passwords are not logged. Log retention is up to the operator: demo server `[N days]` |

Demo server specifics: demo guests and their games against the practice bot are deleted automatically after
`[24 hours]` (`DEMO_RETENTION_HOURS`). The demo has no administrator account and does not send email or webhooks.

Data is sent over HTTPS. Android release builds refuse plain-HTTP servers. iOS allows plain HTTP only to local-network addresses, and
debug builds allow it for development. The app labels any HTTP connection as unencrypted.

## Deleting an account

Settings has a delete-account control when the server reports `accountDeletion` (the server exposes `POST /api/me/delete`;
older servers do not, and the app then says so). A registered user must enter their password; a guest's signed-in session
is the confirmation. Deletion is permanent and is refused while the person has a game in progress, a running tournament,
or an open tournament or simul they host (administrators must first have their administrator access removed).

What happens (`server/src/auth/deletion.ts`):

- **Removed:** sessions, open challenges, password-reset tokens, notification settings and log, ratings and rating history,
  imported games, a seat in tournaments that have not started, and unaccepted simul invitations. The username can be
  registered again.
- **Kept, anonymised:** the user row stays as a tombstone (`deleted_xxxxxxxx`, shown as "Deleted user") with the name,
  password hash, email and Discord ID removed, and it can never sign in. Finished games, moves and tournament results stay,
  because other players' history points at them.

Say this plainly wherever deletion is described: games played against other people remain, without the person's name.
Self-hosted operators can change their own retention, so the app can only vouch for servers running this code.

## Answers for the store forms

Apple App Privacy / Google Data safety. Treat the **demo server** as the developer's own collection, since the developer
runs it; self-hosted servers are the operators' collection.

| Category | Collected? | Linked to the person? | Purpose |
|---|---|---|---|
| Contact info: username, optional email | Yes (account holders) | Yes | App functionality, notifications |
| User content: games and moves | Yes | Yes | App functionality |
| Identifiers: user ID / username | Yes | Yes | App functionality |
| Usage data, diagnostics | Server logs only (IP, URL) | `[decide]` | Security, operation |
| Location, contacts, photos, health, financial, browsing history | No | n/a | n/a |
| Advertising, analytics, tracking | No | n/a | n/a |

Encryption in transit: yes (HTTPS). Data deletion: in-app account deletion (next section).

## Open items before submission

1. ~~In-app account deletion~~ Done: see "Deleting an account". For the Apple and Google forms, check the current store rules
   when you submit (Apple 5.1.1(v) and Google's account-deletion requirement). F-Droid has no equivalent requirement.
2. The privacy policy URL for the stores must be stable HTTPS and match this document. For F-Droid the listing links to this
   file on the `main` branch of the repository; keep the file path stable (the metadata test checks that it exists).
3. Fill in the log-retention and contact placeholders above (`[N days]`, `[24 hours]`, `[decide]`, `[contact]`). They are
   deliberately not filled in by the code: only the demo operator knows them. The F-Droid listing says "currently after 24
   hours" for demo data, so keep that sentence in step with `DEMO_RETENTION_HOURS`.
4. Self-hosted servers: say in the policy that their operators are separate controllers.
5. Re-check the Xcode privacy report on the release archive (Product > Archive > Distribute > the privacy report) for
   anything a plugin or dependency declares that is not in this document.
6. F-Droid: re-run `npm run check:leaks` and re-read the dependency list for analytics or crash SDKs before each tag. Any
   such SDK needs this document updated first, and F-Droid would flag it as an anti-feature anyway.
