import type { CapacitorConfig } from "@capacitor/cli";

// The native app ships the web client's build output. It is built in Vite's "native" mode
// (`npm run build:native -w web`) into web/dist-native so the server's web/dist is never touched.
const config: CapacitorConfig = {
  appId: "io.github.lilythium.lilchess",
  appName: "LilChess",
  webDir: "../web/dist-native",
  server: {
    // Pinned explicitly (they are Capacitor's defaults today). The server's Origin handling
    // depends on the WebView origin these produce: capacitor://localhost on iOS and
    // https://localhost on Android. See docs/mobile-phase-0-review.md, sections 5 and 8.
    iosScheme: "capacitor",
    androidScheme: "https",
    hostname: "localhost",
    // No server.url (the app must not load a remote site) and no cleartext: HTTP access for
    // local servers is configured deliberately in Phase 7.
  },
};

export default config;
