// Things the web client does differently inside the Capacitor app: which origin shared links point at, how text
// is copied, how things are shared. The browser build never installs services, so everything below falls back to
// the browser's own behaviour. The native shell installs them (web/src/native/NativeRoot.svelte); this file
// imports nothing from Capacitor, so it is safe in the ordinary web bundle.

export interface ShareRequest {
  title?: string;
  text?: string;
  url?: string;
}

export interface PlatformServices {
  /** The selected server's origin. In the app `location.origin` is the WebView's own (https://localhost). */
  publicOrigin: string;
  copyText(text: string): Promise<void>;
  share(request: ShareRequest): Promise<void>;
  /** The connected server, and the way back to the server picker (Settings shows both). */
  server?: {
    url: string;
    version: string;
    switchServer(): void;
    /** Optional features this server lacks, with the message to show instead of the feature. Empty for a current server. */
    unavailable?: { accountDeletion?: string };
  };
}

let services: PlatformServices | null = null;

export function setPlatformServices(next: PlatformServices | null): void {
  services = next;
}

export function isNativeApp(): boolean {
  return services !== null;
}

/** Where links that others will open must point. */
export function publicOrigin(): string {
  return services?.publicOrigin ?? location.origin;
}

/** `kind` is the web router's prefix: `c` for a challenge, `s` for a simul invite. */
export function inviteLink(kind: "c" | "s", token: string): string {
  return `${publicOrigin()}/#/${kind}/${token}`;
}

export function canShare(): boolean {
  return services !== null || (typeof navigator !== "undefined" && typeof navigator.share === "function");
}

/** Opens the share sheet. Dismissing it is not an error; any other failure is thrown. */
export async function shareContent(request: ShareRequest): Promise<void> {
  if (services) return services.share(request);
  try {
    await navigator.share(request);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    throw error;
  }
}

/** True if the text reached the clipboard. False (never throws) when the platform refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (services) await services.copyText(text);
    else await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false; // insecure context (plain http on a LAN) or permission denied: the caller offers the text instead
  }
}

/** The server the app is connected to, or null in the browser. */
export function connectedServer(): PlatformServices["server"] | null {
  return services?.server ?? null;
}
