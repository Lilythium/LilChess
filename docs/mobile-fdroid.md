# F-Droid distribution

LilChess Mobile (Android) is distributed through F-Droid instead of Google Play. F-Droid builds the app itself from a
tagged commit and signs it with its own key, so there is no upload key, no `.aab` and no Play Console. Check F-Droid's
current documentation (https://f-droid.org/docs/Inclusion_Policy and the build metadata reference) before submitting;
requirements change.

## Status

| Requirement | State |
|---|---|
| Free-software license | GPL-3.0 (`LICENSE`) |
| No Google Play Services / Firebase | Done: the `com.google.gms` plugin was removed from both Gradle files, and `mobile/src/releaseConfig.test.ts` fails if it comes back |
| No prebuilt binaries | **Blocked**: the native bundle ships a prebuilt Stockfish WASM (see below) |
| Fastlane store metadata in the repo | Not started |
| `fdroiddata` metadata file and merge request | Not started |

## Blocker: prebuilt Stockfish WASM

`web/scripts/copy-stockfish.mjs` copies `stockfish-18-lite-single.wasm` out of the `stockfish` npm package (the package
downloads it from the stockfish.js GitHub release at install time) into the web bundle, and `cap sync` copies it into
the Android assets. F-Droid's own scanner (`fdroidserver` 2.4.5, `scan_source`) reports it as an error:

    Found WebAssembly binary file at mobile/android/app/src/main/assets/public/stockfish/stockfish-18-lite-single.wasm

F-Droid will not accept the app with that file in the build. The ways out are:

1. Build the engine from source in the F-Droid build (stockfish.js documents emscripten 3.1.7 plus its `build.js`).
2. Leave the engine out of the F-Droid build (F-Droid's `scandelete` option removes the file), with the analysis UI
   hidden or disabled when the engine is absent.

Neither is done yet. Normal builds are unchanged.

## Run F-Droid's scanner locally

```bash
pip install fdroidserver
npm ci --ignore-scripts && npm run sync -w mobile
python3 - <<'PY'
import argparse, logging
import fdroidserver.common as common, fdroidserver.scanner as scanner, fdroidserver.metadata as metadata
logging.basicConfig(level=logging.INFO)
common.config = {'sdk_path': '/tmp/none', 'scanner_cache': False}
common.options = argparse.Namespace(verbose=True, json=False)
build = metadata.Build(); build.subdir = 'mobile/android'
print("PROBLEMS:", scanner.scan_source('.', build))
PY
```

Run it from a copy of the repo without `node_modules` (F-Droid removes that directory before scanning). Note that the
scanner deletes `gradlew` and `gradle-wrapper.jar` in the directory it scans, as F-Droid's build does.

## Releases

Tag the release commit `mobile-v<versionName>-<buildNumber>` (for example `mobile-v1.0.0-1`) after updating
`mobile/version.json` and running `npm run version:sync -w mobile`. `.github/workflows/mobile-tag-check.yml` fails the
tag if it does not match `version.json` or if `buildNumber` (the Android `versionCode`) is not higher than every earlier
`mobile-v*` tag.

## Signing and app links

F-Droid signs its APK with its own key (unless you set up reproducible builds). Android App Links only verify against
certificates listed in the server's `MOBILE_ANDROID_CERT_SHA256`, so add F-Droid's certificate fingerprint there once
the app is published. An APK from GitHub (signed with another key) cannot be installed over an F-Droid build or the
other way round.
