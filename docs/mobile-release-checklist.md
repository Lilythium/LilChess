# Mobile release checklist

Run this for every app release, Android and iOS. Copy the "Release record" block at the bottom into the release notes or
issue for that version. Compatibility rules are in `docs/mobile-compatibility.md`; server requirements are in
`docs/mobile-server-requirements.md`.

## 1. Before cutting a release

- [ ] The release branch is up to date with `main` and CI is green: lint, `npm run check:leaks`, build, tests, the mobile
      type-check, the Android build and the Docker image check
- [ ] `git status` is clean after `npm run sync -w mobile` (the native projects are committed in sync)
- [ ] `mobile/version.json`: `versionName` set, `buildNumber` raised (it only ever increases), then
      `npm run version:sync -w mobile` and commit
- [ ] No keystores, provisioning profiles, `key.properties` or service-account files are staged
- [ ] Dependencies are current (see section 4), or the exceptions are written down

## 2. Compatibility

- [ ] The numbers in `docs/mobile-compatibility.md` match the code (the contract test enforces this)
- [ ] If the server API changed: additive changes need no bump; a breaking change followed the rules in the policy
- [ ] Every server generation we still support has a recorded `/api/health` in `mobile/src/compat/health/`
- [ ] A build is tried against the oldest supported server release and the newest, by hand:
  - [ ] Connect, sign in, play a move, background and resume
  - [ ] Features the older server lacks show an explanation instead of failing (for example account deletion)
- [ ] The release does not need a newer server than the public demo server runs
- [ ] The store listing's compatibility statement matches `docs/mobile-compatibility.md`

## 3. Platform checks

Android:

- [ ] The signed release `.aab` builds locally and in CI
- [ ] `targetSdk` meets Google Play's current requirement (check Play Console, not memory)
- [ ] Installed from the Play track, not a local APK: HTTPS works, plain HTTP is refused, app links open invites
- [ ] The Play App Signing SHA-256 fingerprint is in the server's `MOBILE_ANDROID_CERT_SHA256`

iOS:

- [ ] Xcode and the iOS SDK meet Apple's current upload requirement
- [ ] Archive built and uploaded to TestFlight
- [ ] Swift Package Manager dependencies were checked by hand (automatic update PRs do not cover them)
- [ ] Universal links open invites with the app installed, and the web page opens without it

Both:

- [ ] Run the device test plan on physical devices: login, guest, WebSocket upgrade and reconnect, background and
      resume, invite links with the app closed, open and not installed
- [ ] Token leak check: logs, URLs, crash reports and stored state contain no session token or ticket
- [ ] Privacy policy and the store's data disclosures still describe what the build stores and sends

## 4. Keeping dependencies current

Dependabot opens grouped pull requests every week (`.github/dependabot.yml`). The Capacitor core, platform and plugin
packages arrive together in one pull request because they have to move together.

For a Capacitor or plugin update:

- [ ] Merge only with CI green, then run `npm run sync -w mobile` and commit what it changes under `mobile/android` and
      `mobile/ios`
- [ ] Read the Capacitor release notes for native project changes (Gradle, AGP, minimum OS versions) and apply them
- [ ] Re-check the pinned WebView origin in `mobile/capacitor.config.ts`: the server's Origin handling depends on it
- [ ] Re-test WebSocket authentication and secure storage on a physical device. A plugin update can change either
- [ ] Update the iOS Swift packages manually, and the Android Gradle and `compileSdk` versions when the notes call for it

Every quarter, regardless of pull requests: open the project in current Android Studio and Xcode, check the store policy
pages for new target-level deadlines, and write down the dates.

## 5. Periodic server compatibility check

Monthly, or whenever a server release is made:

- [ ] `npm test` passes, including the recorded health responses and WebSocket events
- [ ] The oldest supported release still connects (section 2)
- [ ] Anything dropped from support is announced in the release notes before the server drops it

## Release record

```
App version:            versionName 1.0.0 (buildNumber N)
Commit:
Date:
Tracks / rollout:       internal -> closed -> production 5% / 20% / 100%
Supported servers:      apiVersion 1 to 1 (see docs/mobile-compatibility.md)
Oldest server tested:
Newest server tested:
Devices tested:
Issues found:
```
