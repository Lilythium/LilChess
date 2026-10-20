import type { CapacitorConfig } from "@capacitor/cli";

// The native app ships the web client's build output. It is built in Vite's "native" mode
// (`npm run build:native -w web`) into web/dist-native so the server's web/dist is never touched.
const config: CapacitorConfig = {
  appId: "io.github.lilythium.lilchess",
  appName: "LilChess",
  webDir: "../web/dist-native",
  // Same colour as the web client's --bg. Shown before the page paints and behind the keyboard.
  backgroundColor: "#161512",
  // Capacitor's own native logging: debug builds only. The app never logs credentials itself; this keeps
  // plugin and bridge logging out of release builds as well.
  loggingBehavior: "debug",
  server: {
    // Pinned explicitly (they are Capacitor's defaults today). The server's Origin handling
    // depends on the WebView origin these produce: capacitor://localhost on iOS and
    // https://localhost on Android. See docs/mobile-phase-0-review.md, sections 5 and 8.
    iosScheme: "capacitor",
    androidScheme: "https",
    hostname: "localhost",
    // No server.url (the app must not load a remote site) and no `cleartext`: that option is global and applies to
    // release builds too. HTTP to local servers is handled per platform instead; see docs/mobile-phase-7-platform.md.
  },
  android: {
    // Explicitly false. Debug builds relax this at runtime in MainActivity.java so that ws:// works against a
    // development server; release builds never do.
    allowMixedContent: false,
  },
  plugins: {
    // The UI is dark only: light status/navigation bar icons, and let Capacitor expose the safe-area insets and the
    // keyboard resize to the page as env(safe-area-inset-*), which web/src/app.css already uses.
    SystemBars: {
      style: "DARK",
      insetsHandling: "css",
    },
  },
};

export default config;
