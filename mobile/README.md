# LilChess Mobile

Capacitor shell that packages the existing Svelte web client as an Android and iOS app.
There is no second UI: the app ships a build of `web/` and talks to any compatible LilChess server.

Status: Phase 1 (project scaffold). The app opens the web client inside the native shell. Server selection,
native authentication and the WebSocket changes arrive in Phases 2 to 4, so it cannot play games yet.

## Layout

| Path | What it is |
|---|---|
| `capacitor.config.ts` | App id, name, pinned WebView origin, `webDir` |
| `android/`, `ios/` | Generated native projects. Committed, so edit them deliberately |
| `src/config.test.ts` | Guards the config, the app id and the server/mobile dependency boundary |
| `../web/dist-native/` | Web build the app embeds. Git-ignored, never served by the server |

## How the web build is shared

`npm run build:native -w web` runs `vite build --mode native --outDir dist-native`. It is the same source and the same
bundle as the website, written to a separate folder so `web/dist` (served by the Docker image) is never overwritten.

Native-only behaviour in later phases is selected at build time with Vite's mode:

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

`npm test` at the root also runs `mobile/src/config.test.ts`.

After changing `capacitor.config.ts` or adding a Capacitor plugin, run `npm run sync -w mobile` and commit the
resulting changes under `android/` and `ios/` (for example `capacitor.settings.gradle` and `Package.swift`).

## Requirements

- Node.js 22+ and npm (same as the rest of the repo).
- Android: Android Studio with SDK 36, and JDK 21. The Gradle wrapper downloads Gradle itself.
- iOS (macOS only): Xcode 26 or newer. The project uses Swift Package Manager, so CocoaPods is not needed.

Release builds, signing, icons and deep links are Phase 7. Until then use debug builds.

## Rules

- Mobile packages stay in `devDependencies`. The server image must not contain Capacitor.
- Never commit keystores, provisioning profiles, certificates or `key.properties`. `mobile/.gitignore` blocks the
  common names, but check `git status` before committing.
- Do not point `server.url` at a live site or enable cleartext traffic globally. See
  `docs/mobile-phase-0-review.md` for the Origin and CSRF decisions behind the pinned schemes.
- The app id (`io.github.lilythium.lilchess`) is baked into both native projects. To change it, edit
  `capacitor.config.ts`, delete `android/` and `ios/`, and run `npx cap add android` and `npx cap add ios` again.
