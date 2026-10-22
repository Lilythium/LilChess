import { api } from "./api";
import { isNativeApp } from "./platform";

// Browser side of Web Push. The server owns the VAPID keys; we only subscribe this browser with its
// public key and hand the resulting subscription to /api/me/push-subscription.

export type PushSupport =
  | "ok"
  | "native" // the Capacitor app: browser push doesn't apply, and native push isn't built yet
  | "unsupported" // no service worker / Push API / Notification in this browser
  | "needs-install"; // iOS Safari only allows push for sites added to the Home Screen

export function pushSupport(): PushSupport {
  if (isNativeApp()) return "native";
  const hasApis = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (hasApis) return "ok";
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone ? "needs-install" : "unsupported";
}

export const permission = (): NotificationPermission => ("Notification" in window ? Notification.permission : "denied");

// The applicationServerKey must be raw bytes; the server sends it base64url.
export function urlBase64ToUint8Array(b64url: string): Uint8Array<ArrayBuffer> {
  const padded = (b64url + "=".repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

/** This browser's current subscription, if it has one. Does not prompt. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "ok") return null;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  return reg ? reg.pushManager.getSubscription() : null;
}

/**
 * Asks for permission (call this from a click handler), subscribes this browser and registers it with the
 * server. Throws a message fit for the UI.
 */
export async function enablePush(publicKey: string): Promise<void> {
  if (pushSupport() !== "ok") throw new Error("This browser can't receive push notifications.");
  const result = await Notification.requestPermission();
  if (result !== "granted") {
    throw new Error("Notifications are blocked. Allow them for this site in your browser settings, then try again.");
  }
  const reg = await registration();
  // Always start fresh: an old subscription may have been made against different server keys.
  const existing = await reg.pushManager.getSubscription();
  if (existing) await existing.unsubscribe();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await api("/api/me/push-subscription", { body: sub.toJSON() });
}

/** Removes this browser's subscription from the server and the browser. Safe to call when there is none. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api("/api/me/push-subscription", { method: "DELETE", body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
