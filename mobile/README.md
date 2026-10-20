# LilChess Mobile

Capacitor shell that packages the existing Svelte web client as an Android and iOS app.
The game UI stays shared with `web/`; a small native-only bootstrap screen selects and verifies the LilChess server.

Status: Phase 7 (Android and iOS platform integration). Phase 6 added core gameplay and guest access. The app picks and verifies a server, restores or creates a
session (login, registration, or a guest session for a challenge invite), then mounts the shared game UI. Challenge
and simul invites open from `lilchess://` links, from pasted links, and from invite links shared inside the app.
Phase 7 platform policy, release steps and the device test checklist are in `docs/mobile-phase-7-platform.md`.

## Layout

| Path | What it is |
|---|---|
| `capacitor.config.ts` | App id, name, pinned WebView origin, `webDir` |
| `android/`, `ios/` | Generated native projects. Committed, so edit them deliberately |
| `src/config.test.ts` | Guards the config, the app id and the server/mobile dependency boundary |
| `src/serverSelection.ts` | Pure URL normalization, compatibility validation and connection-error mapping |
| `../web/src/native/` | Native-only server selection screen and Capacitor HTTP probe, imported only by native builds |
| `../web/dist-native/` | Web build the app embeds. Git-ignored, never served by the server |

## How the web build is shared

`npm run build:native -w web` runs `vite build --mode native --outDir dist-native`. It is the same source and the same
bundle as the website, written to a separate folder so `web/dist` (served by the Docker image) is never overwritten.

Native-only behaviour is selected at build time with Vite's mode:

```ts
if (import.meta.env.MODE === "native") {
  const { startNative } = await import("./native/start");
  await startNative();
}
```

Keep Capacitor imports behind dynamic imports like this so they never reach the web bundle.

The embedded Stockfish (lite, single-threaded, about 7 MB) ships inside the app, so analysis works offline.

## Commands

Run from the repository root.

| Command | What it does |
|---|---|
| `npm run build:web -w mobile` | Build `shared`, then the native-mode web bundle |
| `npm run sync -w mobile` | `build:web`, then `cap sync` (copy the bundle and update both native projects) |
| `npm run check -w mobile` | Type-check `capacitor.config.ts` and the mobile tests |
| `npm run open:android -w mobile` | Open `android/` in Android Studio |
| `npm run open:ios -w mobile` | Open `ios/` in Xcode (macOS only) |
| `npm run run:android -w mobile` | Sync, then build and run on a device or emulator |
| `npm run run:ios -w mobile` | Sync, then build and run on a device or simulator (macOS only) |

`npm test` at the root also runs the mobile server-selection and config tests.

After changing `capacitor.config.ts` or adding a Capacitor plugin, run `npm run sync -w mobile` and commit the
resulting changes under `android/` and `ios/` (for example `capacitor.settings.gradle` and `Package.swift`).

## Requirements

- Node.js 22+ and npm (same as the rest of the repo).
- Android: Android Studio with SDK 36, and JDK 21. The Gradle wrapper downloads Gradle itself.
- iOS (macOS only): Xcode 26 or newer. The project uses Swift Package Manager, so CocoaPods is not needed.

Release builds, signing, network policy, icons and app links are documented in `docs/mobile-phase-7-platform.md`.
In short: debug builds can reach plain-HTTP development servers; Android release builds are HTTPS-only.
The `lilchess://` scheme is registered in both projects.

## Rules

- Mobile packages stay in `devDependencies`. The server image must not contain Capacitor.
- Never commit keystores, provisioning profiles, certificates or `key.properties`. `mobile/.gitignore` blocks the
  common names, but check `git status` before committing.
- Do not point `server.url` at a live site or enable cleartext traffic globally. The health probe uses the explicit
  `CapacitorHttp` native API instead of WebView `fetch`, preserving the server's Origin and CSRF policy. See
  `docs/mobile-phase-0-review.md` for the compatibility and Origin decisions.
- Bare addresses default to HTTPS. HTTP is allowed only when explicitly entered and is labelled unencrypted; whether
  HTTP works depends on native platform policy. HTTPS failures never trigger an automatic HTTP retry.
- The stored server URL is a non-secret local preference and is separate from authentication credentials. It stores
  only the normalized origin, not credentials, query parameters or a URL path.
- The app id (`io.github.lilythium.lilchess`) is baked into both native projects. To change it, edit
  `capacitor.config.ts`, delete `android/` and `ios/`, and run `npx cap add android` and `npx cap add ios` again.
