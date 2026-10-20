# Mobile Phase 7: Android and iOS platform integration

Status of the policy for how the native apps talk to servers, store credentials and open invite links. Behaviour that
only a device can prove is listed in the checklist at the end; `mobile/src/platformConfig.test.ts` guards the rest.

## Network policy

| | Android debug | Android release | iOS (all builds) |
|---|---|---|---|
| HTTPS, public CA | yes | yes | yes |
| HTTPS, user-installed CA | yes | no | no (install and trust the profile system-wide) |
| HTTP to a LAN server | yes, any host | **no** | yes: unqualified names, `.local` names and IP addresses (`NSAllowsLocalNetworking`) |
| HTTP to a public hostname | yes (debug only) | no | no |
| `ws://` from the app page | yes (debug only, `MainActivity.java`) | no | to be confirmed on device |

Why Android release is HTTPS-only: the realtime connection is a WebSocket opened from the app page (`https://localhost`),
and Android's WebView blocks `ws://` from a secure page. Allowing cleartext REST would let login succeed and games fail.
Android's network security config also matches hostnames, not IP ranges, so "private networks only" cannot be expressed.
Self-hosters who want the release app on a LAN should put the server behind HTTPS (reverse proxy with a certificate from
a CA the device trusts, or a tunnel/VPN that provides one).

iOS differs deliberately. `NSAllowsLocalNetworking` is the only App Transport Security exception. Per Apple it covers
IP addresses in general, not only private ranges. Never add `NSAllowsArbitraryLoads` or `NSAllowsArbitraryLoadsInWebContent`.
iOS asks for the Local Network permission the first time the app reaches a LAN host.

Do not raise `targetSdkVersion` past 36 without adding and requesting `android.permission.ACCESS_LOCAL_NETWORK`:
apps targeting Android 17 lose LAN access otherwise. `platformConfig.test.ts` enforces this.

## Credentials

- Session tokens live only in platform secure storage (`secureSession.ts`), keyed per server.
- iOS Keychain items survive uninstall. On the first launch of a fresh install (no marker in WebView storage) the app
  clears all stored tokens before anything reads them (`installMarker.ts`). Failure always means "signed out".
- Android: `allowBackup="false"`, so tokens are not copied to cloud backup or device transfer.
- The app asks for the INTERNET permission only and has no analytics, advertising id or tracking declarations.

## Invite links

- `lilchess://invite?server=<url>&c=<id>` works for any server, on both platforms.
- Android verified App Links cover **one host per build**: `./gradlew assembleRelease -PlilchessAppLinkHost=chess.example.com`.
  Without the property the alias is disabled. The host must serve `/.well-known/assetlinks.json`.
- iOS universal links are not enabled in the committed project (the Associated Domains capability cannot be signed with a
  free Apple team). To enable for a build: Xcode > App target > Signing & Capabilities > + Associated Domains >
  `applinks:chess.example.com`. Do not commit that entitlement unless the team is the project's own.
- Server side, set `MOBILE_ANDROID_CERT_SHA256` and/or `MOBILE_IOS_APP_ID` (see `.env.example`). Unset means both files 404.
  Invites are hash routes, so Android matches the path `/` (any link to the site root opens the app) while the iOS file
  limits matching to the `#/c/*` and `#/s/*` fragments.
- A link only names a server and a target. The app confirms the server and the server enforces the invite.

## Release builds

Android (`mobile/android`):
1. Create a keystore outside the repo; copy `keystore.properties.example` to `keystore.properties` and fill it in.
2. `npm run build:native -w web && npm run sync -w mobile`
3. `./gradlew bundleRelease -PlilchessVersionCode=<n> -PlilchessVersionName=<x.y.z> [-PlilchessAppLinkHost=<host>]`
4. Without `keystore.properties` the release build is unsigned. Fingerprint for the server:
   `keytool -list -v -keystore <file>` (use the Play App Signing fingerprint if Play signs the app).

iOS: open `mobile/ios/App/App.xcodeproj`, set the team and version/build, then Product > Archive.
Signing keys, keystores and provisioning profiles are git-ignored and must never be committed.

Icons and splash are generated from `web/public/LJicon.svg` by `mobile/scripts/generate-assets.mjs` (instructions in the
file header). Launch background is `#161512`, matching the web theme; a test keeps the values in sync.

## Device checklist

Run on physical Android and iOS devices before merging; see the pull request description for the full list.
