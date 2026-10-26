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
| No prebuilt binaries | Pipeline written (see "Stockfish from source"). **Not yet proven**: needs the NNUE net committed and one build with emscripten 3.1.7 |
| Fastlane store metadata in the repo | Not started |
| `fdroiddata` metadata file and merge request | Not started |

## Stockfish from source

The native bundle ships a Stockfish WASM engine for on-device analysis. F-Droid's scanner (`fdroidserver` 2.4.5,
`scan_source`) rejects a prebuilt one:

    Found WebAssembly binary file at mobile/android/app/src/main/assets/public/stockfish/stockfish-18-lite-single.wasm

(The `stockfish` npm package ships that `.wasm` inside its tarball; its install script only creates symlinks. So
`npm ci --ignore-scripts` does not remove it.) F-Droid builds must therefore compile the engine themselves.

Everything the build uses is pinned in `web/stockfish-source/pins.json`:

| Pin | Value |
|---|---|
| Source | `nmrugg/stockfish.js` tag `v18.0.8`, commit `93c994592dcf3b4b21052ab925e9b534df9c0918` (the version of the `stockfish` npm devDependency) |
| Toolchain | emscripten `3.1.7` (checked strictly; the build refuses any other version unless `--allow-em-mismatch`) |
| Flavor | `node build.js --single-threaded --lite`, producing `stockfish-18-lite-single.{js,wasm}` |
| Net | `nn-9067e33176e8.nnue`, committed in `web/stockfish-source/nets/`, checked against the first 12 hex digits of its SHA-256 |

### One-off: commit the net

The net is not in the repository yet. Download it once, verify it and commit it:

```bash
node web/scripts/build-stockfish.mjs --fetch-net   # downloads, verifies the checksum, saves, then continues to the build
git add web/stockfish-source/nets/nn-9067e33176e8.nnue
```

(`--fetch-net` needs network access to `tests.stockfishchess.org`. A download that fails the checksum is not saved. The net is saved before the toolchain check, so on a machine without emscripten the run stops at that check, with the net already in place.)

### Build and use

```bash
emcc --version                                  # must report 3.1.7
npm run build:stockfish -w web                  # web/stockfish-build/out/stockfish-18-lite-single.{js,wasm} + manifest.json
LILCHESS_STOCKFISH_SOURCE=compiled npm run sync -w mobile
```

`LILCHESS_STOCKFISH_SOURCE` picks what `web/scripts/copy-stockfish.mjs` copies into the bundle: `npm` (default, the
prebuilt package files; web, Docker and CI) or `compiled`. A missing or stale compiled engine is an error, never a silent
fallback or a build without the engine.

### Compare before switching

```bash
node web/scripts/compare-stockfish.mjs 16        # nodes per second, compiled vs npm, same searches
LILCHESS_STOCKFISH_ENGINE=$PWD/web/stockfish-build/out/stockfish-18-lite-single.js \
  npx vitest run web/src/lib/analysis            # the analysis tests, against the compiled engine
```

Record the numbers in the pull request. Decision still open: whether every build (web, Docker, Android) uses the compiled
engine, or only the F-Droid build. Until the comparison is done the default stays `npm`, and the F-Droid recipe sets
`LILCHESS_STOCKFISH_SOURCE=compiled`.

### Things to confirm, not assume

- That F-Droid accepts the `.nnue` file in the repository (it is data, not code, but it is a large binary blob).
- That F-Droid's build server can provide emscripten 3.1.7 (see `docs/fdroid/`; ask in the merge request if unsure).
- That F-Droid's APK scan accepts a `.wasm` in the assets when it was compiled during the build. As far as I know the
  source scan runs before the `build:` steps, which is why the engine is compiled there rather than in `prebuild:`;
  confirm with a local `fdroid build`.

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
