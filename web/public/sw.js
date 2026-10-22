/* global self, clients, URL */
// LilChess service worker. It exists only to receive Web Push messages and handle clicks on them;
// it caches nothing and has no fetch handler, so it can never serve a stale app.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not JSON: fall through to the generic message below.
  }
  // Browsers (Safari in particular) require every push to show a notification, so always show one.
  event.waitUntil(
    self.registration.showNotification(data.title || "LilChess", {
      body: data.body || "",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { path: typeof data.path === "string" ? data.path : "/" },
    }),
  );
});

// The path comes from our own server, but only same-origin hash routes are ever opened.
function target(path) {
  const safe = typeof path === "string" && path.startsWith("/") && !path.startsWith("//") ? path : "/";
  return new URL(`/#${safe}`, self.location.origin).href;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = target(event.notification.data && event.notification.data.path);
  event.waitUntil(
    (async () => {
      const open = await clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = open.find((c) => new URL(c.url).origin === self.location.origin);
      if (existing) {
        try {
          await existing.focus();
          // A hash-only change: the running app routes to it without reloading.
          if ("navigate" in existing) await existing.navigate(url);
          return;
        } catch {
          // Fall through and open a fresh window.
        }
      }
      await clients.openWindow(url);
    })(),
  );
});
